// Core's path from the socket: handleMessage's dispatch, the listeners apps register, and
// onMessage's general_error branch, which fetches a reply too big for the socket (413).
import { FakeWebSocket, connectedApi, until } from './helpers';
import { linesAt, clearLogs } from '../fakes/console';
import { FakeFetch, jsonResponse, textResponse } from '../fakes/fetch';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Conversation } from '../../src/api/Conversation';

let fake: FakeFetch;

beforeEach(() => {
  FakeWebSocket.reset();
  clearLogs();
  fake = new FakeFetch().install();
});

afterEach(() => {
  fake.restore();
});

const frame = (eventType: string, payload: object) => ({ event: { event_type: eventType, event_payload: payload } });

test("onMessage gives the bot's content as core sends it, and live chat's as a human agent's", async () => {
  const api = await connectedApi();
  const conversation = api.getConversation('conv-1');
  const heard: [unknown, string][] = [];
  conversation.onMessage((content, type) => heard.push([content, type]));

  const content = [{ type: 'text', text: 'Hello there' }];
  FakeWebSocket.last!.receive(frame('bot_message', { content, conversation_id: 'conv-1' }));
  FakeWebSocket.last!.receive(frame('livechat_message', { content: [{ type: 'text', text: 'Agent here' }] }));

  assert.deepEqual(heard, [
    [content, 'ai_agent'],
    [[{ type: 'text', text: 'Agent here' }], 'human_agent'],
  ]);
  // The full app walks the content with for...of.
  const texts: string[] = [];
  for (const item of heard[0][0] as { text: string }[]) texts.push(item.text);
  assert.deepEqual(texts, ['Hello there']);
  api.dispose();
});

test('handleMessage ignores frames that are not JSON, have no type or have no listener', async () => {
  const api = await connectedApi();
  const conversation = api.getConversation('conv-1');
  const heard: unknown[] = [];
  conversation.onMessage((content) => heard.push(content));
  const socket = FakeWebSocket.last!;

  assert.doesNotThrow(() => socket.receive('not json {'));
  socket.receive({ nothing: true });
  socket.receive(frame('typing', { on: true }));
  socket.receive(frame('bot_message', { content: 'only this' }));
  assert.deepEqual(heard, ['only this']);
  api.dispose();
});

test('a listener that throws is logged and the others still run', async () => {
  const api = await connectedApi();
  const conversation = api.getConversation('conv-1');
  const heard: unknown[] = [];
  conversation.onMessage(() => {
    throw new Error('app bug');
  });
  conversation.onMessage((content) => heard.push(content));

  FakeWebSocket.last!.receive(frame('bot_message', { content: 'still here' }));
  assert.deepEqual(heard, ['still here']);
  assert.ok(linesAt('error').includes('[CaptivateChatAPI] Listener for "bot_message" threw: app bug'));
  api.dispose();
});

test('actions, updates and errors reach their listeners in their shapes', async () => {
  const api = await connectedApi();
  const conversation = api.getConversation('conv-1');
  const actions: unknown[] = [];
  const updates: unknown[] = [];
  const errors: unknown[] = [];
  conversation.onActionReceived((a) => actions.push(a));
  conversation.onConversationUpdate((u) => updates.push(u));
  conversation.onError((e) => errors.push(e));
  const socket = FakeWebSocket.last!;

  socket.receive(frame('action', { actions: [{ id: 'form-1', data: { fields: [] } }] }));
  socket.receive(frame('conversation_update', { type: 'title', conversation_id: 'conv-1', data: { title: 'Hi' } }));
  socket.receive(frame('general_error', { conversation_id: 'conv-1', error_code: 500, error_desc: 'Oops' }));

  assert.deepEqual(actions, [[{ id: 'form-1', data: { fields: [] } }]]);
  assert.deepEqual(updates, [{ type: 'title', conversationId: 'conv-1', data: { title: 'Hi' } }]);
  assert.deepEqual(errors, [{ conversationId: 'conv-1', errorCode: 500, errorDesc: 'Oops' }]);
  api.dispose();
});

test('removeAllListeners and off stop the calls', async () => {
  const api = await connectedApi();
  const conversation = api.getConversation('conv-1');
  const actions: unknown[] = [];
  const own = (payload: any) => actions.push(payload);
  // off removes by the function registered, so it is tried on a listener added under its type.
  (conversation as any).addListener('action', own);
  conversation.off('action', own);
  FakeWebSocket.last!.receive(frame('action', { actions: [] }));
  assert.deepEqual(actions, []);

  const heard: unknown[] = [];
  conversation.onMessage((content) => heard.push(content));
  conversation.removeAllListeners();
  FakeWebSocket.last!.receive(frame('bot_message', { content: 'nobody' }));
  assert.deepEqual(heard, []);
  api.dispose();
});

test('a conversation listens on its socket once, however many listeners it has', async () => {
  const api = await connectedApi();
  const socket = FakeWebSocket.last!;
  const before = socket.listenerCount('message');
  const conversation = api.getConversation('conv-1');
  conversation.onMessage(() => {});
  conversation.onError(() => {});
  conversation.onActionReceived(() => {});
  conversation.restartListeners();
  api.getConversation('conv-1');
  assert.equal(socket.listenerCount('message'), before + 1);
  api.dispose();
});

test("detachListeners takes a conversation's handler off its socket", async () => {
  const api = await connectedApi();
  const socket = FakeWebSocket.last!;
  const before = socket.listenerCount('message');
  // Built as getConversation builds it, without the guard around it.
  const conversation = new Conversation('conv-1', null, {}, 'key', 'prod', null, api);
  assert.equal(socket.listenerCount('message'), before + 1);
  conversation.detachListeners();
  assert.equal(socket.listenerCount('message'), before);
  api.dispose();
});

// Core's own bug, found by L0 and fixed for 7.1.0: the guard wraps every function property, so
// a guarded handle's detachListeners read a wrapper in place of its bound handler and
// removeEventListener missed. releaseConversation, deleteUserConversations and dispose all
// detach that way, so a dropped handle kept hearing the live socket.
test('a guarded handle detaches from its socket when released', async () => {
  const api = await connectedApi();
  const socket = FakeWebSocket.last!;
  const before = socket.listenerCount('message');
  const conversation = api.getConversation('conv-1');
  const heard: unknown[] = [];
  conversation.onMessage((content) => heard.push(content));
  api.releaseConversation('conv-1');
  socket.receive(frame('bot_message', { content: 'after release' }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  try {
    assert.equal(socket.listenerCount('message'), before);
    assert.deepEqual(heard, []);
  } finally {
    api.dispose();
  }
});

test('a guarded handle hears nothing after deleteUserConversations or dispose', async () => {
  const api = await connectedApi();
  const socket = FakeWebSocket.last!;
  const before = socket.listenerCount('message');
  const heard: unknown[] = [];
  api.getConversation('conv-1').onMessage((content) => heard.push(content));
  fake.reply(textResponse('OK'));
  await api.deleteUserConversations('user-1');
  socket.receive(frame('bot_message', { content: 'after delete' }));
  assert.equal(socket.listenerCount('message'), before);

  api.getConversation('conv-2').onMessage((content) => heard.push(content));
  api.dispose();
  socket.receive(frame('bot_message', { content: 'after dispose' }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(socket.listenerCount('message'), before);
  assert.deepEqual(heard, []);
});

test('a 413 general_error fetches the whole reply from its link and gives it as the bot', async () => {
  const api = await connectedApi();
  const conversation = api.getConversation('conv-1');
  const heard: [unknown, string][] = [];
  conversation.onMessage((content, type) => heard.push([content, type]));

  const content = [{ type: 'text', text: 'A very long answer' }];
  fake.reply(jsonResponse({ botMessage: { content } }));
  FakeWebSocket.last!.receive(
    frame('general_error', { error_code: 413, message_link: 'https://files.example/big-1', error_desc: 'Too big' })
  );
  await until(() => heard.length > 0);

  assert.deepEqual(heard, [[content, 'ai_agent']]);
  assert.equal(fake.last!.url, 'https://files.example/big-1');
  assert.equal(fake.last!.method, 'GET');
  assert.equal(fake.last!.headers['x-api-key'], (api as any).apiKey);
  assert.equal(fake.last!.headers['accept'], 'application/json');
  api.dispose();
});

test("a 413 whose link can't be read gives an error message", async () => {
  const api = await connectedApi();
  const conversation = api.getConversation('conv-1');
  const heard: [unknown, string][] = [];
  conversation.onMessage((content, type) => heard.push([content, type]));

  fake.reply(textResponse('gone', 500));
  FakeWebSocket.last!.receive(frame('general_error', { error_code: 413, message_link: 'https://files.example/big-2' }));
  await until(() => heard.length > 0);
  assert.deepEqual(heard[0], ['[Error fetching large message: Failed to fetch large message: 500 Internal Server Error]', 'error']);

  fake.reply(new TypeError('Failed to fetch'));
  FakeWebSocket.last!.receive(frame('general_error', { error_code: 413, message_link: 'https://files.example/big-3' }));
  await until(() => heard.length > 1);
  assert.deepEqual(heard[1], ['[Error fetching large message: Failed to fetch]', 'error']);
  assert.equal(linesAt('error').filter((l) => l.startsWith('Error fetching large message:')).length, 2);
  api.dispose();
});

test('other general errors reach onMessage as error text, beside onError', async () => {
  const api = await connectedApi();
  const conversation = api.getConversation('conv-1');
  const heard: [unknown, string][] = [];
  const errors: unknown[] = [];
  conversation.onMessage((content, type) => heard.push([content, type]));
  conversation.onError((e) => errors.push(e));

  FakeWebSocket.last!.receive(frame('general_error', { error_code: 500, error_desc: 'Bot unavailable' }));
  FakeWebSocket.last!.receive(frame('general_error', { error_code: 500 }));
  FakeWebSocket.last!.receive(frame('general_error', { error_code: 413, error_desc: 'No link' }));
  await until(() => heard.length === 3);

  assert.deepEqual(heard, [
    ['[Error: Bot unavailable]', 'error'],
    ['[Error: Unknown error]', 'error'],
    ['[Error: No link]', 'error'],
  ]);
  assert.equal(errors.length, 3);
  assert.equal(fake.requests.length, 0);
  api.dispose();
});
