// Core's path: the socket's address, connecting, the guard that reconnects, and dispose.
import { FakeWebSocket, connectedApi, createdApi, freshKey } from './helpers';
import { linesAt, clearLogs } from '../fakes/console';
import { FakeFetch, textResponse } from '../fakes/fetch';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CaptivateChatAPI } from '../../src/api/CaptivateChatAPI';
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

test('the socket address is core gateway with the key, for prod and dev', async () => {
  const prod = new CaptivateChatAPI('abc123', 'prod');
  const prodConnecting = prod.connect();
  assert.equal(FakeWebSocket.last!.url, 'wss://channel.wss.captivatechat.ai/dev?apiKey=abc123');
  FakeWebSocket.last!.open();
  await prodConnecting;

  const dev = new CaptivateChatAPI('abc123', 'dev');
  const devConnecting = dev.connect();
  assert.equal(FakeWebSocket.last!.url, 'wss://channel-dev.wss.captivatechat.ai/dev?apiKey=abc123');
  FakeWebSocket.last!.open();
  await devConnecting;

  assert.notEqual(prod, dev);
  prod.dispose();
  dev.dispose();
});

test('the mode defaults to prod', async () => {
  const api = new CaptivateChatAPI('default-mode');
  const connecting = api.connect();
  assert.equal(FakeWebSocket.last!.url, 'wss://channel.wss.captivatechat.ai/dev?apiKey=default-mode');
  FakeWebSocket.last!.open();
  await connecting;
  api.dispose();
});

test('one instance per key and mode', () => {
  const key = freshKey();
  const a = new CaptivateChatAPI(key, 'prod');
  const b = new CaptivateChatAPI(key, 'prod', { connectTimeoutMs: 1 });
  const c = new CaptivateChatAPI(key, 'dev');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(CaptivateChatAPI.getInstance(key, 'prod'), a);
  assert.equal(CaptivateChatAPI.hasInstance(key, 'dev'), true);
  a.dispose();
  c.dispose();
});

test('connect resolves on socket_connected and keeps its socket id', async () => {
  const api = new CaptivateChatAPI(freshKey());
  const connecting = api.connect();
  const socket = FakeWebSocket.last!;
  socket.readyState = FakeWebSocket.OPEN;
  socket.receive('not json');
  socket.receive({ event: { event_type: 'something_else' } });
  let done = false;
  void connecting.then(() => (done = true));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(done, false);

  socket.receive({ event: { event_type: 'socket_connected', event_payload: { socket_id: 'abc' } } });
  await connecting;
  assert.equal(api.getSocketId(), 'abc');
  assert.equal(api.getSocket(), socket as unknown as WebSocket);
  assert.equal(api.isSocketActive(), true);
  api.dispose();
});

test('a later socket_connected refreshes the socket id', async () => {
  const api = await connectedApi();
  FakeWebSocket.last!.receive({ event: { event_type: 'socket_connected', event_payload: { socket_id: 'socket-9' } } });
  assert.equal(api.getSocketId(), 'socket-9');
  api.dispose();
});

test('concurrent connects share one handshake', async () => {
  const api = new CaptivateChatAPI(freshKey());
  const first = api.connect();
  const second = api.connect();
  assert.equal(FakeWebSocket.instances.length, 1);
  FakeWebSocket.last!.open();
  await Promise.all([first, second]);
  api.dispose();
});

test('connect times out without socket_connected', async () => {
  const api = new CaptivateChatAPI(freshKey(), 'prod', { connectTimeoutMs: 20 });
  const connecting = api.connect();
  FakeWebSocket.last!.readyState = FakeWebSocket.OPEN;
  await assert.rejects(connecting, { message: 'Connection timeout: socket_connected not received within 20ms' });
  api.dispose();
});

test('a socket error during the handshake rejects connect', async () => {
  const api = new CaptivateChatAPI(freshKey());
  const connecting = api.connect();
  FakeWebSocket.last!.fail('refused');
  await assert.rejects(connecting, { message: 'refused' });
  api.dispose();
});

test('a close during the handshake rejects connect', async () => {
  const api = new CaptivateChatAPI(freshKey());
  const connecting = api.connect();
  FakeWebSocket.last!.drop(1006);
  await assert.rejects(connecting, { message: 'WebSocket closed during handshake (code 1006)' });
  assert.equal(api.getSocket(), null);
  api.dispose();
});

test('an unexpected close reconnects and moves every conversation to the new socket', async () => {
  const api = await connectedApi({ reconnectDelay: 1 });
  const conversation = api.getConversation('conv-1');
  const heard: unknown[] = [];
  conversation.onMessage((content) => heard.push(content));
  const old = FakeWebSocket.last!;

  old.drop(1006);
  assert.equal(api.isSocketActive(), false);
  assert.equal(api.getSocketId(), null);
  assert.equal(FakeWebSocket.instances.length, 2);
  const fresh = FakeWebSocket.last!;
  fresh.open('socket-2');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(api.isSocketActive(), true);
  assert.equal(api.getSocketId(), 'socket-2');
  old.receive({ event: { event_type: 'bot_message', event_payload: { content: 'old' } } });
  fresh.receive({ event: { event_type: 'bot_message', event_payload: { content: 'new' } } });
  assert.deepEqual(heard, ['new']);
  assert.ok(linesAt('warn').some((l) => l.includes('WebSocket closed unexpectedly (code 1006); reconnecting.')));
  api.dispose();
});

test('a close with code 1000 does not reconnect', async () => {
  const api = await connectedApi();
  FakeWebSocket.last!.drop(1000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(FakeWebSocket.instances.length, 1);
  assert.equal(api.isSocketActive(), false);
  api.dispose();
});

test('reconnect stops after the most attempts allowed', async () => {
  const api = new CaptivateChatAPI(freshKey(), 'prod', { maxReconnectAttempts: 2, reconnectDelay: 1 });
  const reconnecting = api.reconnect();
  FakeWebSocket.last!.fail('first');
  // The second try opens its socket after the delay.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(FakeWebSocket.instances.length, 2);
  FakeWebSocket.last!.fail('second');
  await assert.rejects(reconnecting, { message: 'second' });
  await assert.rejects(api.reconnect(), { message: 'Max reconnection attempts (2) reached' });
  api.dispose();
});

test('the guard reconnects a closed instance before a call that needs the network', async () => {
  const api = await createdApi();
  FakeWebSocket.last!.drop(1000);
  assert.equal(api.isSocketActive(), false);

  fake.reply(textResponse('OK'));
  const listing = api.getUserConversations('user-1');
  assert.equal(FakeWebSocket.instances.length, 2);
  FakeWebSocket.last!.open('socket-2');
  const result = await listing;

  assert.deepEqual(result.conversations, []);
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.last!.json.event.socket_id, 'socket-2');
  api.dispose();
});

test('the guard says which call failed when it cannot reconnect', async () => {
  const api = await createdApi({ maxReconnectAttempts: 1 });
  FakeWebSocket.last!.drop(1000);
  const listing = api.getUserConversations('user-1');
  FakeWebSocket.last!.fail('no network');
  await assert.rejects(listing, {
    message: 'Socket reconnection failed. Cannot execute getUserConversations: no network',
  });
  assert.equal(fake.requests.length, 0);
  // Disposed unguarded: see the todo at the end of this file.
  CaptivateChatAPI.getInstance((api as any).apiKey)!.dispose();
});

test('the guard leaves accessors and local calls synchronous', async () => {
  const api = await createdApi();
  assert.equal(api.isSocketActive(), true);
  assert.equal(api.getSocketId(), 'socket-1');
  assert.equal(api.getSocket(), FakeWebSocket.last as unknown as WebSocket);
  const conversation = api.getConversation('conv-1');
  assert.ok(conversation instanceof Conversation);
  assert.equal(conversation.getConversationId(), 'conv-1');
  assert.equal(api.getConversation('conv-1'), conversation);

  // A call that sends comes back as a promise, on the API and on each conversation.
  fake.reply(textResponse('OK'), textResponse('OK'));
  const listed = api.getUserConversations('user-1');
  const sent = conversation.sendMessage('hi');
  assert.ok(listed instanceof Promise);
  assert.ok(sent instanceof Promise);
  await Promise.all([listed, sent]);

  // dispose itself is not guarded, so it never reconnects first.
  const before = FakeWebSocket.instances.length;
  api.dispose();
  assert.equal(FakeWebSocket.instances.length, before);
  assert.equal(api.isSocketActive(), false);
});

test('isSocketActive and getSocket after the socket goes', async () => {
  const api = await connectedApi();
  FakeWebSocket.last!.drop(1000);
  assert.equal(api.isSocketActive(), false);
  assert.equal(api.getSocket(), null);
  assert.equal(api.getSocketId(), null);
  api.dispose();
});

test('dispose closes the socket, drops its conversations and frees the key', async () => {
  const api = await connectedApi({ reconnectDelay: 1 });
  const key = (api as any).apiKey as string;
  const socket = FakeWebSocket.last!;
  const conversation = api.getConversation('conv-1');
  conversation.onMessage(() => {});

  api.dispose();

  // Detaching a guarded handle's listener is test/core/messages.test.ts' todo.
  assert.deepEqual(socket.closedWith, { code: 1000, reason: 'Instance disposed' });
  assert.equal((api as any).conversations.size, 0);
  assert.equal(api.isSocketActive(), false);
  assert.equal(api.getSocketId(), null);
  assert.equal(CaptivateChatAPI.hasInstance(key, 'prod'), false);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(FakeWebSocket.instances.length, 1);

  await assert.rejects(api.connect(), { message: 'This CaptivateChatAPI instance has been disposed. Create a new one.' });
  await assert.rejects(api.reconnect(), {
    message: 'This CaptivateChatAPI instance has been disposed. Create a new one.',
  });
  const again = new CaptivateChatAPI(key, 'prod');
  assert.notEqual(again, api);
  again.dispose();
});

test('a guarded call on a disposed instance fails in the guard', async () => {
  const api = await createdApi();
  api.dispose();
  await assert.rejects(api.getUserConversations('user-1'), {
    message:
      'Socket reconnection failed. Cannot execute getUserConversations: This CaptivateChatAPI instance has been disposed. Create a new one.',
  });
  assert.equal(fake.requests.length, 0);
});

// Core's own bug, found by L0 and left as it is (core's path never changes): dispose calls
// this.teardownSocket, and on create()'s guarded instance that is a guarded call. With the
// socket already closed, the guard tries to reconnect the instance dispose just marked
// disposed, and its rejection is never handled (Node ends a process on one by default).
test('dispose on a guarded instance whose socket closed rejects nothing', { todo: 'core bug: teardownSocket is guarded' }, async () => {
  const api = await createdApi();
  FakeWebSocket.last!.drop(1000);
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  const listeners = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', onUnhandled);
  try {
    api.dispose();
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    process.off('unhandledRejection', onUnhandled);
    for (const listener of listeners) process.on('unhandledRejection', listener);
  }
  assert.equal(FakeWebSocket.instances.length, 1);
  assert.deepEqual(unhandled, []);
});
