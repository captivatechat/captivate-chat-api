// Core's path over HTTP: the API's _send and each conversation's sendPayloadViaHttp, their
// envelopes, the socket id they carry and their errors.
import { FakeWebSocket, connectedApi } from './helpers';
import { linesAt, clearLogs } from '../fakes/console';
import { FakeFetch, FakeResponse, jsonResponse, textResponse } from '../fakes/fetch';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CaptivateChatAPI } from '../../src/api/CaptivateChatAPI';
import { Conversation } from '../../src/api/Conversation';

const PROD_SEND = 'https://channel.prod.captivat.io/api/custom-channel/sockets/message';
const DEV_SEND = 'https://channel.dev.captivat.io/api/custom-channel/sockets/message';

let fake: FakeFetch;

beforeEach(() => {
  FakeWebSocket.reset();
  clearLogs();
  fake = new FakeFetch().install();
});

afterEach(() => {
  fake.restore();
});

const send = (api: CaptivateChatAPI, message: object) => (api as any)._send(message);

test('_send posts to the gateway with the key and the live socket id', async () => {
  const api = await connectedApi();
  fake.reply(jsonResponse({ ok: true }));
  const answer = await send(api, { action: 'sendMessage', event: { event_type: 'ping', event_payload: { a: 1 } } });

  assert.deepEqual(answer, { ok: true });
  const request = fake.last!;
  assert.equal(request.url, PROD_SEND);
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['x-api-key'], (api as any).apiKey);
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(request.headers['accept'], 'application/json');
  assert.deepEqual(request.json, {
    action: 'sendMessage',
    event: { event_type: 'ping', event_payload: { a: 1 }, socket_id: 'socket-1' },
  });
  api.dispose();
});

test("_send uses dev's gateway in dev mode", async () => {
  const api = await connectedApi({}, 'dev');
  fake.reply(jsonResponse({}));
  await send(api, { action: 'sendMessage', event: { event_type: 'ping' } });
  assert.equal(fake.last!.url, DEV_SEND);
  api.dispose();
});

test('_send turns a plain-text answer into a success with no conversation id', async () => {
  const api = await connectedApi();
  fake.reply(textResponse('OK'));
  const answer = await send(api, { action: 'sendMessage', event: { event_type: 'ping' } });
  assert.deepEqual(answer, {
    status: 'success',
    message: 'OK',
    event: { event_payload: { conversation_id: null } },
  });
  api.dispose();
});

test('_send treats an answer with no content type as plain text', async () => {
  const api = await connectedApi();
  fake.reply(new FakeResponse({ body: 'accepted' }));
  const answer = await send(api, { action: 'sendMessage', event: { event_type: 'ping' } });
  assert.equal(answer.message, 'accepted');
  api.dispose();
});

test('_send carries the status and the body on a refusal', async () => {
  const api = await connectedApi();
  fake.reply(textResponse('slow down', 429));
  await assert.rejects(send(api, { action: 'sendMessage', event: { event_type: 'ping' } }), (error: any) => {
    // 7.0.0's words, never the server's body: apps show or match them.
    assert.equal(error.message, 'Failed to send message via HTTP: HTTP request failed: 429 Too Many Requests');
    assert.equal(error.status, 429);
    assert.equal(error.body, 'slow down');
    return true;
  });

  const long = 'x'.repeat(500);
  fake.reply(textResponse(long, 500));
  await assert.rejects(send(api, { action: 'sendMessage', event: { event_type: 'ping' } }), (error: any) => {
    assert.equal(error.message, 'Failed to send message via HTTP: HTTP request failed: 500 Internal Server Error');
    assert.equal(error.body, long);
    return true;
  });

  fake.reply(textResponse('', 401));
  await assert.rejects(send(api, { action: 'sendMessage', event: { event_type: 'ping' } }), {
    message: 'Failed to send message via HTTP: HTTP request failed: 401 Unauthorized',
  });
  api.dispose();
});

test('_send says when the request itself failed', async () => {
  const api = await connectedApi();
  fake.reply(new TypeError('Failed to fetch'));
  await assert.rejects(send(api, { action: 'sendMessage', event: { event_type: 'ping' } }), {
    message: 'Failed to send message via HTTP: Failed to fetch',
  });
  assert.ok(linesAt('error').some((l) => l.startsWith('[CaptivateChatAPI] HTTP request failed:')));
  api.dispose();
});

test('_send needs a key', async () => {
  const api = new CaptivateChatAPI('');
  await assert.rejects(send(api, { action: 'sendMessage', event: {} }), {
    message: 'API key is required for HTTP communication',
  });
  assert.equal(fake.requests.length, 0);
  api.dispose();
});

test("a conversation's message goes in core's envelope", async () => {
  const api = await connectedApi();
  const conversation = api.getConversation('conv-1');
  fake.reply(textResponse('OK'), textResponse('OK'));

  await conversation.sendMessage('hello');
  const request = fake.requests[0];
  assert.equal(request.url, PROD_SEND);
  assert.equal(request.headers['x-api-key'], (api as any).apiKey);
  assert.equal(request.json.action, 'sendMessage');
  assert.equal(request.json.event.event_type, 'user_message');
  assert.equal(request.json.event.socket_id, 'socket-1');
  const payload = request.json.event.event_payload;
  assert.match(payload.client_msg_id, /^unique-message-id-\d+$/);
  assert.deepEqual(
    { ...payload, client_msg_id: undefined },
    { type: 'message_create', client_msg_id: undefined, conversation_id: 'conv-1', content: { type: 'text', text: 'hello' } }
  );

  const content = { type: 'text', text: 'with files', files: [{ filename: 'a.pdf' }] };
  await conversation.sendMessage(content);
  assert.deepEqual(fake.requests[1].json.event.event_payload.content, content);
  api.dispose();
});

test('a conversation sends the socket id of the connection that is live now', async () => {
  const api = await connectedApi({ reconnectDelay: 1 });
  const conversation = api.getConversation('conv-1');
  FakeWebSocket.last!.drop(1006);
  FakeWebSocket.last!.open('socket-2');
  await new Promise((resolve) => setImmediate(resolve));

  fake.reply(textResponse('OK'));
  await conversation.sendMessage('after the reconnect');
  assert.equal(fake.last!.json.event.socket_id, 'socket-2');
  api.dispose();
});

test('a conversation with no socket id still sends, and warns', async () => {
  const api = new CaptivateChatAPI('no-socket-key');
  const conversation = api.getConversation('conv-1');
  fake.reply(textResponse('OK'));
  await conversation.sendMessage('hi');
  assert.equal(fake.last!.json.event.socket_id, null);
  assert.ok(
    linesAt('warn').includes(
      '[CaptivateChatAPI] No socket_id available for conversation conv-1; the server may be unable to deliver the reply.'
    )
  );
  api.dispose();
});

test("sendPayloadViaHttp's answers and errors", async () => {
  const api = await connectedApi();
  const conversation = api.getConversation('conv-1');
  const sendRaw = (message: object) => (conversation as any).sendPayloadViaHttp(message);

  fake.reply(jsonResponse({ status: 'ok', n: 1 }));
  assert.deepEqual(await sendRaw({ action: 'sendMessage', event: { event_type: 'x' } }), { status: 'ok', n: 1 });

  fake.reply(textResponse('OK'));
  assert.deepEqual(await sendRaw({ action: 'sendMessage', event: { event_type: 'x' } }), {
    status: 'success',
    message: 'OK',
  });

  fake.reply(textResponse('nope', 500));
  await assert.rejects(sendRaw({ action: 'sendMessage', event: { event_type: 'x' } }), (error: any) => {
    assert.equal(error.message, 'Failed to send payload via HTTP: HTTP request failed: 500 Internal Server Error');
    assert.equal(error.status, 500);
    assert.equal(error.body, 'nope');
    return true;
  });

  fake.reply(new TypeError('Failed to fetch'));
  await assert.rejects(sendRaw({ action: 'sendMessage', event: { event_type: 'x' } }), {
    message: 'Failed to send payload via HTTP: Failed to fetch',
  });
  assert.ok(linesAt('error').some((l) => l.startsWith('HTTP request failed:')));

  const keyless = new Conversation('conv-2', null, {}, '', 'prod', null) as any;
  assert.ok(linesAt('warn').includes('API key is required for HTTP communication. Some features may not work properly.'));
  await assert.rejects(keyless.sendPayloadViaHttp({ event: {} }), {
    message: 'API key is required for HTTP communication',
  });
  api.dispose();
});

test("each conversation call's event", async () => {
  const api = await connectedApi();
  const conversation = api.getConversation('conv-1');
  const events = () => fake.requests.map((r) => r.json.event);

  fake.reply(textResponse('OK'));
  await conversation.sendAction('act-1', { pick: 'b' });
  assert.deepEqual(events()[0], {
    event_type: 'action',
    event_payload: { type: 'normal', id: 'act-1', data: { pick: 'b' }, conversation_id: 'conv-1' },
    socket_id: 'socket-1',
  });

  fake.reply(textResponse('OK'));
  await conversation.setMetadata({ plan: 'pro' });
  const metadata = events()[1];
  assert.equal(metadata.event_type, 'metadata');
  assert.deepEqual(metadata.event_payload.metadata, { plan: 'pro' });
  assert.match(metadata.event_payload.client_msg_id, /^metadata-\d+$/);
  assert.equal(metadata.event_payload.conversation_id, 'conv-1');

  fake.reply(textResponse('OK'));
  await conversation.setPrivateMetadata({ secret: 1 });
  assert.deepEqual(events()[2].event_payload.metadata, { private: { secret: 1 } });

  await assert.rejects(conversation.setMetadata(null as any), { message: 'Metadata must be a non-null object.' });
  await assert.rejects(conversation.setPrivateMetadata(null as any), {
    message: 'Private metadata must be a non-null object.',
  });

  fake.reply(jsonResponse({ metadata: { plan: 'pro' } }), jsonResponse({ other: true }));
  assert.deepEqual(await conversation.getMetadata(), { plan: 'pro' });
  assert.deepEqual(events()[3], {
    event_type: 'metadata_request',
    event_payload: { conversation_id: 'conv-1' },
    socket_id: 'socket-1',
  });
  assert.deepEqual(await conversation.getMetadata(), { other: true });

  fake.reply(textResponse('OK'), textResponse('OK'));
  await conversation.delete();
  await conversation.delete({ softDelete: false });
  assert.deepEqual(events()[5].event_payload, { conversation_id: 'conv-1', softdelete: true });
  assert.deepEqual(events()[6].event_payload, { conversation_id: 'conv-1', softdelete: false });
  assert.equal(events()[5].event_type, 'delete_conversation');

  fake.reply(textResponse('OK'));
  await conversation.editMessage('msg-7', 'fixed');
  const edit = events()[7];
  assert.equal(edit.event_type, 'edit_message');
  assert.match(edit.event_payload.client_msg_id, /^edit-message-id-\d+$/);
  assert.deepEqual(
    { ...edit.event_payload, client_msg_id: undefined },
    {
      type: 'message_create',
      client_msg_id: undefined,
      conversation_id: 'conv-1',
      message_id: 'msg-7',
      content: { type: 'text', text: 'fixed' },
    }
  );

  fake.reply(textResponse('OK'));
  await conversation.setTimeToLive(7);
  assert.deepEqual(events()[8].event_payload.metadata, { timeToLive: 7 });
  await conversation.setTimeToLive(5);
  assert.equal(fake.requests.length, 9);
  api.dispose();
});

test("getTranscript reads core's transcript route", async () => {
  const api = await connectedApi({}, 'dev');
  const conversation = api.getConversation('conv 1');
  fake.reply(jsonResponse({ transcript: [{ id: 'm1', text: 'hi' }] }));
  assert.deepEqual(await conversation.getTranscript(), [{ id: 'm1', text: 'hi' }]);
  assert.equal(fake.last!.url, 'https://channel.dev.captivat.io/api/transcript?conversation_id=conv%201');
  assert.equal(fake.last!.method, 'GET');
  assert.equal(fake.last!.headers['x-api-key'], (api as any).apiKey);

  fake.reply(textResponse('missing', 404));
  await assert.rejects(conversation.getTranscript(), (error: any) => {
    assert.equal(error.message, 'Failed to fetch transcript: 404 Not Found');
    assert.equal(error.body, 'missing');
    assert.equal(error.status, 404);
    return true;
  });
  api.dispose();
});
