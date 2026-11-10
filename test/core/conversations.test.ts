// Core's path for conversations: creating one, a user's list (v1 and v2) and deleting a
// user's conversations.
import { FakeWebSocket, connectedApi, until } from './helpers';
import { clearLogs, linesAt } from '../fakes/console';
import { FakeFetch, jsonResponse, textResponse } from '../fakes/fetch';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { CaptivateChatAPI } from '../../src/api/CaptivateChatAPI';
import { CaptivateChatManager } from '../../src/api/CaptivateChatManager';

let fake: FakeFetch;

beforeEach(() => {
  FakeWebSocket.reset();
  clearLogs();
  fake = new FakeFetch().install();
});

afterEach(() => {
  fake.restore();
});

const started = (conversationId?: string) => ({
  event: { event_type: 'conversation_start_success', event_payload: { conversation_id: conversationId } },
});

test('getUserConversations v1: the user alone, and the conversations it lists', async () => {
  const api = await connectedApi();
  fake.reply(
    jsonResponse({
      event: {
        event_payload: {
          conversations: [
            { conversation_id: 'c1', metadata: { topic: 'billing' } },
            { metadata: { no: 'id' } },
            { conversation_id: 'c2', metadata: {}, apiKey: 'other-key' },
          ],
        },
      },
    })
  );
  const { conversations, pagination } = await api.getUserConversations('user-1');

  assert.deepEqual(fake.last!.json.event, {
    event_type: 'get_user_conversations',
    event_payload: { userId: 'user-1' },
    socket_id: 'socket-1',
  });
  assert.deepEqual(
    conversations.map((c) => c.getConversationId()),
    ['c1', 'c2']
  );
  // The full app reads these runtime fields as public.
  assert.equal((conversations[0] as any).conversationId, 'c1');
  assert.deepEqual((conversations[0] as any).metadata, { topic: 'billing' });
  assert.equal(conversations[0].apiKey, (api as any).apiKey);
  assert.equal(conversations[1].apiKey, 'other-key');
  assert.equal(pagination, undefined);
  assert.equal(api.getConversation('c1'), conversations[0]);
  api.dispose();
});

test('getUserConversations v1 reads a list sent at the top level, and the options form', async () => {
  const api = await connectedApi();
  fake.reply(jsonResponse({ conversations: [{ conversation_id: 'c1' }] }));
  const { conversations } = await api.getUserConversations({ userId: 'user-1', filter: {}, apiKeys: [] });
  assert.equal(fake.last!.json.event.event_type, 'get_user_conversations');
  assert.deepEqual(fake.last!.json.event.event_payload, { userId: 'user-1' });
  assert.equal(conversations.length, 1);
  api.dispose();
});

test('getUserConversations v2: filter, search, pages and keys, each only when given', async () => {
  const api = await connectedApi();
  const pagination = { hasNextPage: true, hasPrevPage: false, page: 1, pageSize: 2, total: 3, totalPages: 2 };
  fake.reply(
    jsonResponse({ event: { event_payload: { conversations: [{ conversation_id: 'c1' }], pagination } } }),
    jsonResponse({ conversations: [] }),
    jsonResponse({ conversations: [] }),
    jsonResponse({ conversations: [] })
  );

  const first = await api.getUserConversations({
    userId: 'user-1',
    filter: { status: 'open' },
    pagination: { page: 1, limit: 2 },
  });
  assert.deepEqual(fake.requests[0].json.event, {
    event_type: 'get_user_conversations_v2',
    event_payload: { userId: 'user-1', filter: { status: 'open' }, pagination: { page: 1, limit: 2 } },
    socket_id: 'socket-1',
  });
  assert.deepEqual(first.pagination, pagination);
  assert.equal(first.conversations.length, 1);

  await api.getUserConversations({ userId: 'user-1', search: { text: 'refund' } });
  assert.deepEqual(fake.requests[1].json.event.event_payload, { userId: 'user-1', search: { text: 'refund' } });
  await api.getUserConversations({ userId: 'user-1', pagination: { page: '2' } });
  assert.deepEqual(fake.requests[2].json.event.event_payload, { userId: 'user-1', pagination: { page: '2' } });
  await api.getUserConversations({ userId: 'user-1', apiKeys: ['k1', 'k2'] });
  assert.deepEqual(fake.requests[3].json.event.event_payload, { userId: 'user-1', apiKeys: ['k1', 'k2'] });
  for (const request of fake.requests) assert.equal(request.json.event.event_type, 'get_user_conversations_v2');
  api.dispose();
});

test('getUserConversations keeps the handle an app already has, with its listeners', async () => {
  const api = await connectedApi();
  const mine = api.getConversation('c1');
  const heard: unknown[] = [];
  mine.onMessage((content) => heard.push(content));

  fake.reply(jsonResponse({ conversations: [{ conversation_id: 'c1', metadata: { new: true } }] }));
  const { conversations } = await api.getUserConversations('user-1');
  assert.equal(conversations[0], mine);
  FakeWebSocket.last!.receive({ event: { event_type: 'bot_message', event_payload: { content: 'hi' } } });
  assert.deepEqual(heard, ['hi']);
  api.dispose();
});

test('createConversation sends conversation_start and resolves on its success', async () => {
  const api = await connectedApi();
  fake.reply(textResponse('OK'), textResponse('OK'));
  const creating = api.createConversation('user-1', { name: 'Ana' }, { plan: 'pro' }, 'bot-first', { crm: 7 });
  await until(() => fake.requests.length === 1);

  assert.deepEqual(fake.requests[0].json, {
    action: 'sendMessage',
    event: {
      event_type: 'conversation_start',
      event_payload: { userId: 'user-1', userBasicInfo: { name: 'Ana' }, metadata: { plan: 'pro', private: { crm: 7 } } },
      socket_id: 'socket-1',
    },
  });
  FakeWebSocket.last!.receive(started('conv-9'));
  const conversation = await creating;
  assert.equal(conversation.getConversationId(), 'conv-9');
  assert.equal(api.getConversation('conv-9'), conversation);

  // Bot-first: the opener is an empty text message, sent after the conversation resolves.
  await until(() => fake.requests.length === 2);
  assert.equal(fake.requests[1].json.event.event_type, 'user_message');
  assert.deepEqual(fake.requests[1].json.event.event_payload.content, { type: 'text', text: '' });
  assert.equal(fake.requests[1].json.event.event_payload.conversation_id, 'conv-9');
  api.dispose();
});

test('createConversation connects first when the socket is closed', async () => {
  const api = new CaptivateChatAPI('create-connects');
  fake.reply(textResponse('OK'));
  const creating = api.createConversation('user-1', {}, {}, 'user-first');
  assert.equal(FakeWebSocket.instances.length, 1);
  FakeWebSocket.last!.open('socket-5');
  await until(() => fake.requests.length === 1);
  assert.equal(fake.last!.json.event.socket_id, 'socket-5');
  assert.deepEqual(fake.last!.json.event.event_payload.metadata, { private: {} });
  FakeWebSocket.last!.receive(started('conv-1'));
  await creating;
  // User-first sends no opener.
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(fake.requests.length, 1);
  api.dispose();
});

test("createConversation's failures", async () => {
  const api = await connectedApi({ conversationStartTimeoutMs: 20 });

  fake.reply(textResponse('OK'));
  await assert.rejects(api.createConversation('user-1'), {
    message: 'Timeout: No conversation_start_success received from WebSocket within 20ms',
  });

  fake.reply(textResponse('OK'));
  const noId = api.createConversation('user-1', {}, {}, 'user-first', {}, { timeoutMs: 1000 });
  await until(() => fake.requests.length === 2);
  FakeWebSocket.last!.receive(started(undefined));
  await assert.rejects(noId, { message: 'No conversation_id received in WebSocket response' });

  fake.reply(textResponse('busy', 503));
  await assert.rejects(api.createConversation('user-1'), {
    message: 'HTTP request failed: 503 Service Unavailable: busy',
  });

  // A success that comes after the timeout makes no conversation.
  FakeWebSocket.last!.receive(started('late'));
  assert.equal((api as any).conversations.size, 0);
  api.dispose();
});

test("a failed bot-first opener is logged, and the conversation still resolves", async () => {
  const api = await connectedApi();
  fake.reply(textResponse('OK'), textResponse('down', 500));
  const creating = api.createConversation('user-1');
  await until(() => fake.requests.length === 1);
  FakeWebSocket.last!.receive(started('conv-2'));
  const conversation = await creating;
  assert.equal(conversation.getConversationId(), 'conv-2');
  await until(() => linesAt('error').some((l) => l.includes('bot-first opening message failed to send:')));
  api.dispose();
});

test('deleteUserConversations sends the user and drops every local handle', async () => {
  const api = await connectedApi();
  const conversation = api.getConversation('c1');

  fake.reply(textResponse('OK'), textResponse('OK'));
  await api.deleteUserConversations('user-1');
  assert.deepEqual(fake.requests[0].json.event, {
    event_type: 'delete_user_conversations',
    event_payload: { userId: 'user-1', softdelete: true },
    socket_id: 'socket-1',
  });
  assert.notEqual(api.getConversation('c1'), conversation);

  await api.deleteUserConversations('user-1', { softDelete: false });
  assert.equal(fake.requests[1].json.event.event_payload.softdelete, false);
  await assert.rejects(api.deleteUserConversations(''), { message: 'User ID must be provided.' });
  api.dispose();
});

test("JSON.stringify and console.log of a manager, however made, never hold the core keys it files its instances under", async () => {
  const keys = ['manager-json-key-0001-abcdef', 'manager-json-key-0002-abcdef'];
  const built = new CaptivateChatManager(keys);
  const connecting = CaptivateChatManager.create(keys, 'dev');
  // create() connects one key after the other.
  for (let i = 0; i < keys.length; i++) {
    await until(() => FakeWebSocket.instances.length > i);
    FakeWebSocket.instances[i].open(`socket-m${i}`);
  }
  const created = await connecting;
  for (const manager of [built, created]) {
    for (const text of [JSON.stringify(manager), JSON.stringify([manager]), inspect(manager, { depth: 6 })]) {
      for (const key of keys) assert.ok(!text.includes(key), `a key in ${text.slice(0, 120)}`);
    }
    // Still there for the library's own use.
    for (const key of keys) assert.ok(manager.getApiInstance(key));
  }
  for (const manager of [built, created]) for (const key of keys) manager.getApiInstance(key)!.dispose();
});

test("the manager's error for a conversation of a key it doesn't hold names the key by its last 4 characters", async () => {
  const held = 'manager-held-key-0001';
  const other = 'manager-other-key-WXYZ';
  const manager = new CaptivateChatManager([held]);
  const api = manager.getApiInstance(held)!;
  (api as any).getUserConversations = async () => ({
    conversations: [{ apiKey: other, getConversationId: () => 'c1' }],
  });
  await assert.rejects(manager.getUserConversations({ userId: 'user-1' }), (error: Error) => {
    assert.equal(error.message, 'No CaptivateChatAPI instance for apiKey: …WXYZ');
    assert.ok(!error.message.includes(other));
    return true;
  });
  api.dispose();
});

test('JSON.stringify of a core handle, of the instance and of a created conversation never holds the key', async () => {
  const key = 'core-json-secret-0123456789abcdef';
  const api = new CaptivateChatAPI(key, 'dev');
  const connecting = api.connect();
  FakeWebSocket.last!.open('socket-1');
  await connecting;
  assert.ok(FakeWebSocket.last!.url.includes(key), 'the socket address carries the key, as core wants');

  fake.reply(textResponse('OK'));
  const creating = api.createConversation('user-1', {}, {}, 'user-first');
  await until(() => fake.requests.length === 1);
  FakeWebSocket.last!.receive(started('conv-json'));
  const created = await creating;
  const handle = api.getConversation('conv-other');

  for (const value of [created, handle, api, [created, handle]]) {
    const text = JSON.stringify(value);
    assert.ok(!text.includes(key), `the key in ${text.split(key).join('<key>').slice(0, 120)}`);
    assert.ok(!text.includes('apiKey='), 'nor the socket address that carries it');
  }
  // Still there for the library's own use.
  assert.equal((created as any).apiKey, key);
  assert.equal((api as any).apiKey, key);
  api.dispose();
});
