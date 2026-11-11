// Replies that name no conversation. Core's gateway sends bot_message and livechat_message with
// only type, bot and content (a live check on core dev, 11 Nov), so since 7.1.0, when every held
// conversation kept its own listener, every open conversation heard every reply. From 7.1.1 such
// a reply goes to the conversation that last sent a message or an action, or was just started,
// on that connection; while none has, every handle hears it, as before. Tests 1, 2, 3, 6, 7 and
// 8 failed on f16ae19 (the other conversations heard the reply too); 4 and 5 passed there.
import { FakeWebSocket, connectedApi, createdApi, until } from './helpers';
import { clearLogs } from '../fakes/console';
import { FakeFetch, jsonResponse, textResponse } from '../fakes/fetch';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CaptivateChatManager } from '../../src/api/CaptivateChatManager';
import type { Conversation } from '../../src/api/Conversation';

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
/** A reply as core's gateway sends it: no conversation_id. */
const reply = (text: string) => frame('bot_message', { type: 'message', bot: 'bot-1', content: [{ type: 'text', text }] });
const listed = (...conversations: object[]) => jsonResponse({ event: { event_payload: { conversations } } });
const started = (conversationId: string) => frame('conversation_start_success', { conversation_id: conversationId });

/** What each conversation's onMessage heard, by the reply's text. */
function listen(...conversations: Conversation[]): Record<string, string[]> {
  const heard: Record<string, string[]> = {};
  for (const conversation of conversations) {
    const id = conversation.getConversationId();
    heard[id] = [];
    conversation.onMessage((content) => {
      heard[id].push(typeof content === 'string' ? content : content.map((part) => part.text ?? '').join(''));
    });
  }
  return heard;
}

async function send(conversation: Conversation, text: string): Promise<void> {
  fake.reply(textResponse('OK'));
  await conversation.sendMessage(text);
}

test('1. one chat at a time, as on 7.0.0: the open chat hears its replies while others are listed or opened', async () => {
  const api = await createdApi();
  const socket = FakeWebSocket.last!;
  fake.reply(listed({ conversation_id: 'A', metadata: {} }, { conversation_id: 'B', metadata: {} }));
  const { conversations } = await api.getUserConversations('user-1');
  const a = conversations.find((c) => c.getConversationId() === 'A')!;
  const heard = listen(a);
  await send(a, 'hello');
  socket.receive(reply('first'));
  assert.deepEqual(heard.A, ['first']);

  // The app lists again and opens B in the background; A is still the chat being shown.
  fake.reply(listed({ conversation_id: 'A', metadata: {} }, { conversation_id: 'B', metadata: {} }));
  await api.getUserConversations('user-1');
  const b = api.getConversation('B');
  Object.assign(heard, listen(b));
  socket.receive(reply('second'));
  assert.deepEqual(heard.A, ['first', 'second']);
  assert.deepEqual(heard.B, []);
  api.dispose();
});

test('2. two chats: a reply goes to the one that sent last', async () => {
  const api = await connectedApi();
  const socket = FakeWebSocket.last!;
  const a = api.getConversation('A');
  const b = api.getConversation('B');
  const heard = listen(a, b);

  await send(a, 'from A');
  socket.receive(reply('to A'));
  assert.deepEqual(heard, { A: ['to A'], B: [] });

  await send(b, 'from B');
  socket.receive(reply('to B'));
  socket.receive(frame('livechat_message', { content: [{ type: 'text', text: 'agent to B' }] }));
  assert.deepEqual(heard, { A: ['to A'], B: ['to B', 'agent to B'] });

  // An action is answered as a message is; so are an action, an update and an error that name none.
  fake.reply(textResponse('OK'));
  await a.sendAction('act-1', { pick: 'x' });
  const others: string[] = [];
  for (const conversation of [a, b]) {
    const id = conversation.getConversationId();
    conversation.onActionReceived(() => others.push(`${id} action`));
    conversation.onConversationUpdate(() => others.push(`${id} update`));
    conversation.onError(() => others.push(`${id} error`));
  }
  socket.receive(frame('action', { actions: [{ id: 'form-1', data: {} }] }));
  socket.receive(frame('conversation_update', { type: 'title', data: {} }));
  socket.receive(frame('general_error', { conversation_id: '', error_code: 500, error_desc: 'Oops' }));
  assert.deepEqual(others, ['A action', 'A update', 'A error']);
  assert.deepEqual(heard.B, ['to B', 'agent to B']);
  api.dispose();
});

test("3. createConversation: the bot-first greeting reaches the new conversation only", async () => {
  const api = await connectedApi();
  const socket = FakeWebSocket.last!;
  const old = api.getConversation('old');
  const heard = listen(old);
  await send(old, 'earlier');

  // conversation_start, then the bot-first opener.
  fake.reply(textResponse('OK'), textResponse('OK'));
  const creating = api.createConversation('user-1');
  await until(() => fake.requests.length === 2);
  socket.receive(started('new'));
  const created = await creating;
  Object.assign(heard, listen(created));
  socket.receive(reply('greeting'));
  assert.deepEqual(heard, { old: [], new: ['greeting'] });
  api.dispose();
});

test('4. a reply that names its conversation goes to that one, whichever sent last', async () => {
  const api = await connectedApi();
  const socket = FakeWebSocket.last!;
  const a = api.getConversation('A');
  const b = api.getConversation('B');
  const heard = listen(a, b);
  await send(b, 'from B');

  socket.receive(frame('bot_message', { content: [{ type: 'text', text: 'named A' }], conversation_id: 'A' }));
  assert.deepEqual(heard, { A: ['named A'], B: [] });
  api.dispose();
});

test('5. before any conversation has sent or been started, every handle hears a reply that names none', async () => {
  const api = await connectedApi();
  const heard = listen(api.getConversation('A'), api.getConversation('B'));
  FakeWebSocket.last!.receive(reply('nobody sent'));
  assert.deepEqual(heard, { A: ['nobody sent'], B: ['nobody sent'] });
  api.dispose();
});

test('6. releasing the conversation that sent last lets every held handle hear again', async () => {
  const api = await connectedApi();
  const socket = FakeWebSocket.last!;
  const a = api.getConversation('A');
  const b = api.getConversation('B');
  const c = api.getConversation('C');
  const heard = listen(a, b, c);
  await send(a, 'from A');
  // Releasing another conversation leaves A as the one replies go to.
  api.releaseConversation('C');
  socket.receive(reply('still A'));
  assert.deepEqual(heard, { A: ['still A'], B: [], C: [] });

  api.releaseConversation('A');
  socket.receive(reply('after release'));
  assert.deepEqual(heard, { A: ['still A'], B: ['after release'], C: [] });
  api.dispose();
});

test('7. a reconnect keeps the conversation replies go to', async () => {
  const api = await connectedApi({ reconnectDelay: 1 });
  const a = api.getConversation('A');
  const b = api.getConversation('B');
  const heard = listen(a, b);
  await send(a, 'from A');

  FakeWebSocket.last!.drop(1006);
  const fresh = FakeWebSocket.last!;
  fresh.open('socket-2');
  // The conversations move to the new socket once connect() has settled.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(api.isSocketActive(), true);
  fresh.receive(reply('after reconnect'));
  assert.deepEqual(heard, { A: ['after reconnect'], B: [] });
  api.dispose();
});

test("8. the manager: each key's connection sends a reply that names none to its own last sender", async () => {
  const keys = ['unaddressed-key-0001-abcdef', 'unaddressed-key-0002-abcdef'];
  const creating = CaptivateChatManager.create(keys);
  for (let i = 0; i < keys.length; i++) {
    await until(() => FakeWebSocket.instances.length > i);
    FakeWebSocket.instances[i].open(`socket-m${i}`);
  }
  const manager = await creating;
  const [socketOne, socketTwo] = FakeWebSocket.instances;
  const [one, two] = keys.map((key) => manager.getApiInstance(key)!);
  const heard = listen(one.getConversation('one-A'), one.getConversation('one-B'), two.getConversation('two-A'), two.getConversation('two-B'));

  await send(one.getConversation('one-A'), 'from one-A');
  await send(two.getConversation('two-B'), 'from two-B');
  socketOne.receive(reply('on one'));
  socketTwo.receive(reply('on two'));
  assert.deepEqual(heard, { 'one-A': ['on one'], 'one-B': [], 'two-A': [], 'two-B': ['on two'] });
  manager.disposeAll();
});
