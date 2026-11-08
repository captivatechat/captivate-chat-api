// Server mode (first-channels-server-key-spec §3.1, §3.3; library spec §2.1 to §2.3, §2.6, §2.7): a
// whole vbk_ key on the app's own server. Refused where the library can tell it runs in an app, a
// page or a browser worker; every call names its user by X-Blue-User; no handle is kept between
// requests; nothing is stored; no key, Authorization or X-Blue-User value is ever logged.
import { FakeWebSocket, appKey, freshId } from './helpers';
import { clearLogs, linesAt, logged } from '../fakes/console';
import { FakeFetch, FakeResponse, RecordedRequest, jsonResponse } from '../fakes/fetch';
import { FakeClock } from '../fakes/clock';
import { Call, NDJSON, flush, lineChunks, record } from './answers';
import { FIXTURES, jsonOf, streamNames, streamOf } from './fixtures';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, IncomingHttpHeaders } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CaptivateChatAPI } from '../../src/api/CaptivateChatAPI';
import { Conversation } from '../../src/api/Conversation';
import { SERVER_USER_FORM, keyIdOf, serverModeRefused } from '../../src/api/blue/keys';
import { BlueError, BlueTransport } from '../../src/api/blue/transport';
import { CONSOLE_WORDS, SETUP_WORDS, WORDS } from '../../src/api/blue/words';

const BASE = 'https://vienna-blue-backend.prod.captivat.io';
const ID = '0000000000000000000000c1';
const OFFER = 'of-000000000000000000000025';
/** A user's ID nothing else in a request holds, so a scan of the logs finds it only if it leaked. */
const USER_A = 'usr_Qm4v-Z7pK.a';
const USER_B = 'usr_Hx2w-T9rL.b';

let fake: FakeFetch;
let clock: FakeClock;
let key: string;
let secretPart: string;
let api: CaptivateChatAPI;

/** A whole server key with a random secret, so its secret part can be looked for in the logs. */
function wholeServerKey(): { key: string; secret: string } {
  const secret = randomBytes(32).toString('hex');
  return { key: `vbk_${freshId()}_${secret}`, secret };
}

beforeEach(async () => {
  FakeWebSocket.reset();
  clearLogs();
  fake = new FakeFetch().install();
  clock = new FakeClock();
  ({ key, secret: secretPart } = wholeServerKey());
  api = await CaptivateChatAPI.create(key, 'prod', { stream: 'fetch' });
  (api as any).blueClock = clock;
});

afterEach(() => {
  CaptivateChatAPI.setDebugMode(false);
  api.dispose();
  fake.restore();
});

const transportOf = (made: CaptivateChatAPI): BlueTransport => (made as any).blue;
const line = (event: unknown) => `${JSON.stringify(event)}\n`;
const answer = (text = 'Hi.', id = ID) =>
  new FakeResponse({ headers: NDJSON, body: [line({ type: 'conversation', conversationId: id }), line({ type: 'text', text }), line({ type: 'done' })] });
const start = (id = ID, body: Record<string, unknown> = {}) => jsonResponse({ conversationId: id, greeting: null, details: [], ...body }, 201);
const readBack = (body: Record<string, unknown> = {}) =>
  jsonResponse({ _id: ID, createdAt: '2026-01-05T09:00:00.000Z', updatedAt: '2026-01-05T09:00:02.000Z', messages: [], answering: false, metadata: {}, details: [], ...body });
const listed = (ids: string[]) =>
  jsonResponse({
    total: ids.length,
    page: 1,
    pageSize: 20,
    items: ids.map((conversationId) => ({ conversationId, createdAt: '2026-01-05T09:00:00.000Z', updatedAt: '2026-01-05T09:00:02.000Z', metadata: {} })),
  });
const gone = () => jsonResponse({ error: { code: 'not_found', message: 'Conversation not found.' } }, 404);
const sends = () => fake.requests.filter((r) => r.method === 'POST' && r.url === `${BASE}/v1/chat`);
const warned = (words: string) => linesAt('warn').filter((l) => l.includes(words)).length;
const conversationsKept = (made: CaptivateChatAPI) => ((made as any).conversations as Map<string, Conversation>).size;

async function send(conversation: Conversation, reply: FakeResponse = answer(), text = 'Hello'): Promise<RecordedRequest> {
  fake.reply(reply);
  await conversation.sendMessage(text);
  await flush();
  return sends()[sends().length - 1];
}

async function refusal(run: () => unknown): Promise<BlueError> {
  try {
    await run();
  } catch (error) {
    return error as BlueError;
  }
  assert.fail('expected a refusal');
}

test('a whole vbk_ key on a server is server mode: no socket, no users kept, its registry entry a hash and its lines the key id alone', async () => {
  CaptivateChatAPI.setDebugMode(true);
  const { key: other, secret } = wholeServerKey();
  const made = await CaptivateChatAPI.create(other, 'dev');
  const again = await CaptivateChatAPI.create(other, 'dev');
  assert.equal(transportOf(made), transportOf(again));
  assert.equal(transportOf(made).serverMode, true);
  assert.equal((made as any).blueUsers, null);
  assert.equal(made.isSocketActive(), true);
  assert.equal(made.getSocket(), null);
  assert.equal(FakeWebSocket.instances.length, 0);
  assert.equal(CaptivateChatAPI.hasInstance(other, 'dev'), true);
  const registry = [...((CaptivateChatAPI as any).instances as Map<string, unknown>).keys()];
  assert.ok(registry.length > 0);
  for (const name of registry) {
    assert.ok(!name.includes(secret), 'no key secret in the registry');
    assert.ok(!name.includes(key.slice(29)), 'nor the other server key');
  }
  made.dispose();
  assert.equal(CaptivateChatAPI.hasInstance(other, 'dev'), false);
  const id = keyIdOf(other);
  assert.equal(id, other.slice(0, 28));
  for (const words of ['Created new', 'Reusing existing', 'Disposed']) {
    assert.ok(linesAt('log').some((l) => l.includes(`${words} CaptivateChatAPI instance for ${id}-dev`)), words);
  }
  assert.ok(logged.every((l) => !l.text.includes(secret)));
  // An app key is registered by its hash too, and named by itself, its whole id.
  const app = appKey();
  new CaptivateChatAPI(app, 'prod').dispose();
  assert.ok(linesAt('log').some((l) => l.includes(`Created new CaptivateChatAPI instance for ${app}-prod`)));
  // Core's keys keep today's registry entry, which Engage reads.
  const core = new CaptivateChatAPI('core-key-for-server-tests', 'prod');
  assert.ok(((CaptivateChatAPI as any).instances as Map<string, unknown>).has('core-key-for-server-tests-prod'));
  core.dispose();
});

test('server mode is refused in a page, a browser worker, React Native and Electron; Node, Deno, Bun and Workers pass', () => {
  assert.equal(serverModeRefused({ document: {} }), true, 'a page');
  assert.equal(serverModeRefused({ importScripts: () => undefined }), true, 'a browser worker');
  assert.equal(serverModeRefused({ navigator: { product: 'ReactNative' } }), true, 'React Native');
  assert.equal(serverModeRefused({ process: { versions: { node: '20.15.1', electron: '33.0.0' } } }), true, 'Electron');
  assert.equal(serverModeRefused({ process: { versions: { node: '24.2.0' } }, navigator: { userAgent: 'Node.js/24' } }), false, 'Node');
  assert.equal(serverModeRefused({ Deno: {}, navigator: { userAgent: 'Deno/2' } }), false, 'Deno');
  assert.equal(serverModeRefused({ Bun: {}, process: { versions: { bun: '1.1.0' } } }), false, 'Bun');
  // Workers define WorkerGlobalScope but not importScripts; without nodejs_compat there is no process.
  assert.equal(serverModeRefused({ WorkerGlobalScope: function () {}, navigator: { userAgent: 'Cloudflare-Workers' } }), false, 'Workers');
  assert.equal(serverModeRefused({}), false, 'no process at all');
  assert.equal(serverModeRefused(), false, 'this Node');

  for (const [name, value] of [['document', {}], ['importScripts', () => undefined]] as const) {
    const { key: refusedKey } = wholeServerKey();
    (globalThis as any)[name] = value;
    try {
      assert.throws(() => new CaptivateChatAPI(refusedKey, 'prod'), { message: SETUP_WORDS.serverKeyInApp }, name);
    } finally {
      delete (globalThis as any)[name];
    }
    assert.equal(CaptivateChatAPI.hasInstance(refusedKey, 'prod'), false, name);
  }
  assert.equal(
    SETUP_WORDS.serverKeyInApp,
    'Server keys work only on your own server, never in an app or a web page. Make a key for your app on the Channels page, and if this key was ever in an app or a page, get a new one there.'
  );
  assert.equal(FakeWebSocket.instances.length, 0);
  assert.equal(fake.requests.length, 0);
});

test("a user's ID outside X-Blue-User's form is refused before anything is sent, on every call that names one", async () => {
  assert.equal(SETUP_WORDS.serverUserForm, "On a server, each user's ID must be 1 to 128 visible characters, without spaces.");
  const bad: unknown[] = ['', 'two words', 'tab\there', 'café', 'x'.repeat(129), 'a\nb', undefined, null, 42];
  for (const userId of bad) {
    const label = JSON.stringify(userId) ?? String(userId);
    if (userId !== undefined) assert.throws(() => api.getConversation(ID, userId as string), { message: SETUP_WORDS.serverUserForm }, label);
    await assert.rejects(api.createConversation(userId as string, {}, {}, 'user-first'), { message: SETUP_WORDS.serverUserForm }, label);
    await assert.rejects(api.getUserConversations(userId as string), { message: SETUP_WORDS.serverUserForm }, label);
    await assert.rejects(api.deleteUserConversations(userId as string), { message: SETUP_WORDS.serverUserForm }, label);
  }
  assert.equal(fake.requests.length, 0);
  for (const good of ['a', 'x'.repeat(128), '!~', 'auth0|5f7c8ec7c33c6c004bbafe82', USER_A]) assert.match(good, SERVER_USER_FORM);
});

test('getConversation(id) throws in its words; getConversation(id, userId) is a fresh handle each time, kept nowhere', () => {
  assert.throws(() => api.getConversation(ID), { message: SETUP_WORDS.nameTheUser });
  assert.equal(SETUP_WORDS.nameTheUser, 'On a server, name the user on every call: getConversation(id, userId).');
  const first = api.getConversation(ID, USER_A);
  const second = api.getConversation(ID, USER_A);
  assert.notEqual(first, second);
  assert.equal(first.getConversationId(), ID);
  assert.equal(conversationsKept(api), 0);
  // An app key's getConversation(id) is as before: one handle, kept.
  const app = new CaptivateChatAPI(appKey(), 'prod');
  assert.equal(app.getConversation(ID), app.getConversation(ID));
  app.dispose();
});

test('every call sends Authorization and X-Blue-User, never X-Blue-Conversation, Origin or credentials', async () => {
  fake.reply(start());
  const conversation = await api.createConversation(USER_A, {}, { plan: 'gold' }, 'user-first');
  await send(conversation, new FakeResponse({ headers: NDJSON, body: streamOf('offer').replace(/"conversationId":"[0-9a-f]{24}"/, `"conversationId":"${ID}"`) }));
  fake.reply(jsonResponse(jsonOf('offer.press.json')));
  await conversation.sendAction(OFFER, { values: { name: 'Sam Lee' } });
  fake.reply(jsonResponse({ stopped: false }));
  await conversation.stop();
  fake.reply(readBack());
  await conversation.getTranscript();
  fake.reply(jsonResponse({ metadata: { plan: 'gold', size: 'M' } }));
  await conversation.setMetadata({ size: 'M' });
  fake.reply(jsonResponse({ uploadId: '0'.repeat(31) + '1', url: 'https://files.example.test/u?sig=made-up', headers: {}, expiresAt: '2099-01-01T00:00:00.000Z' }, 201));
  fake.reply(new FakeResponse({ status: 200, body: '' }));
  await conversation.fileManager.create({ file: new File(['%PDF-1.4'], 'order.pdf', { type: 'application/pdf' }) });
  fake.reply(listed([ID]));
  await api.getUserConversations(USER_A);
  fake.reply(new FakeResponse({ status: 204 }));
  await conversation.delete();
  fake.reply(jsonResponse({ deleted: 1, busy: 0 }));
  await api.deleteUserConversations(USER_A);

  const blue = fake.requests.filter((r) => r.url.startsWith(BASE));
  assert.deepEqual(
    blue.map((r) => `${r.method} ${r.url.slice(BASE.length)}`),
    [
      'POST /v1/chat/conversations',
      'POST /v1/chat',
      `POST /v1/chat/${ID}/offers/${OFFER}`,
      `POST /v1/chat/${ID}/stop`,
      `GET /v1/chat/${ID}`,
      `PATCH /v1/chat/${ID}/metadata`,
      'POST /v1/chat/uploads',
      'GET /v1/chat/conversations?page=1&limit=50',
      `DELETE /v1/chat/${ID}`,
      'DELETE /v1/chat/conversations',
    ]
  );
  for (const request of blue) {
    const label = `${request.method} ${request.url}`;
    assert.equal(request.headers.authorization, `Bearer ${key}`, label);
    assert.equal(request.headers['x-blue-user'], USER_A, label);
    assert.equal(request.headers['x-blue-conversation'], undefined, label);
    assert.equal(request.headers.origin, undefined, label);
    const names = Object.keys(request.headers).sort();
    assert.deepEqual(names, request.body === undefined ? ['authorization', 'x-blue-user'] : ['authorization', 'content-type', 'x-blue-user'], label);
  }
  // The file's own PUT goes to its place with the place's headers alone: no key, no user.
  const put = fake.requests.find((r) => r.method === 'PUT')!;
  assert.deepEqual(put.headers, {});
  assert.equal(conversationsKept(api), 0);
});

test("two users through one instance: their lists apart, B can't reach A's conversation, A's customer never on B's send", async () => {
  fake.reply(start());
  const a = await api.createConversation(USER_A, {}, { user_id: 'C-1042' }, 'user-first');
  const fromA = await send(a);
  assert.deepEqual(fromA.json.user, { id: 'C-1042' });

  // B names A's conversation: the backend binds it to A, so B gets 404 on every route, in its words.
  const b = api.getConversation(ID, USER_B);
  fake.reply(gone());
  const read = await refusal(() => b.getTranscript());
  assert.equal(read.status, 404);
  assert.equal(read.errorDesc, WORDS.conversationGone);
  fake.reply(gone());
  const sent = await refusal(() => b.sendMessage('Show me my orders'));
  assert.equal(sent.errorDesc, WORDS.conversationGone);
  const fromB = sends()[sends().length - 1];
  assert.equal(fromB.headers['x-blue-user'], USER_B);
  assert.deepEqual(fromB.json.user, { id: null });
  assert.ok(!String(fromB.body).includes('C-1042'));

  // Each list is asked as its own user, and its handles carry that user alone.
  fake.reply(listed(['0000000000000000000000a1']), listed(['0000000000000000000000b1', '0000000000000000000000b2']));
  const listA = await api.getUserConversations(USER_A);
  const listB = await api.getUserConversations({ userId: USER_B });
  const lists = fake.requests.filter((r) => r.method === 'GET' && r.url.includes('/v1/chat/conversations'));
  assert.deepEqual(lists.map((r) => r.headers['x-blue-user']), [USER_A, USER_B]);
  assert.deepEqual(listA.conversations.map((c) => c.getConversationId()), ['0000000000000000000000a1']);
  assert.equal(listB.conversations.length, 2);
  fake.reply(readBack({ _id: '0000000000000000000000b2' }));
  await listB.conversations[1].getTranscript();
  assert.equal(fake.last!.headers['x-blue-user'], USER_B);
  // A second list gives fresh handles too.
  fake.reply(listed(['0000000000000000000000a1']));
  const listAgain = await api.getUserConversations(USER_A);
  assert.notEqual(listAgain.conversations[0], listA.conversations[0]);
  assert.equal(conversationsKept(api), 0);
});

test('two requests on one conversation: each handle gets its own answer and nothing of the other', async () => {
  const first = api.getConversation(ID, USER_A);
  const second = api.getConversation(ID, USER_A);
  const firstCalls = record(first, ['onMessage', 'onAnswer']);
  const secondCalls = record(second, ['onMessage', 'onAnswer']);
  await send(first, answer('First answer.'));
  await send(second, answer('Second answer.'));
  assert.deepEqual(
    firstCalls.map((c) => c.listener),
    ['onMessage', 'onAnswer']
  );
  assert.deepEqual(firstCalls[1].args, [{ text: 'First answer.', sources: [] }]);
  assert.deepEqual(secondCalls[1].args, [{ text: 'Second answer.', sources: [] }]);
});

test('no handle is left after many users; forgetUser and releaseConversation do nothing', async () => {
  for (let n = 0; n < 300; n++) {
    const user = `user-${n}`;
    api.getConversation(ID, user).onAnswer(() => undefined);
    if (n % 10 === 0) {
      fake.reply(start(`${n.toString(16).padStart(24, '0')}`));
      await api.createConversation(user, {}, {}, 'user-first');
    }
  }
  assert.equal(conversationsKept(api), 0);
  api.forgetUser(USER_A);
  api.releaseConversation(ID);
  assert.equal(conversationsKept(api), 0);
  assert.equal(fake.requests.length, 30);
});

test('storage and userSecret go unused with one warning; user_token is never sent, with one warning', async () => {
  const stored: string[] = [];
  const storage = { get: () => null, set: (name: string) => void stored.push(name), remove: () => undefined };
  const { key: other } = wholeServerKey();
  const made = await CaptivateChatAPI.create(other, 'prod', { storage, userSecret: () => 's'.repeat(43), stream: 'fetch' });
  made.configure({ storage });
  assert.equal(warned(CONSOLE_WORDS.serverKeepsNothing), 1);
  assert.equal(CONSOLE_WORDS.serverKeepsNothing, "Server mode keeps nothing on this machine, so storage and userSecret aren't used.");

  fake.reply(start());
  const conversation = await made.createConversation(USER_A, {}, { user_id: 'C-1042', user_token: 'token-value', plan: 'gold' }, 'user-first');
  const created = fake.last!;
  assert.deepEqual(created.json.metadata, { plan: 'gold' });
  const first = await send(conversation);
  assert.deepEqual(first.json.user, { id: 'C-1042' });
  await conversation.setMetadata({ user_id: 'C-2000', user_token: 'another-token' });
  const second = await send(conversation);
  assert.deepEqual(second.json.user, { id: 'C-2000' });
  for (const request of fake.requests) assert.ok(!String(request.body ?? '').includes('token-value') && !String(request.body ?? '').includes('another-token'));
  assert.equal(warned(CONSOLE_WORDS.serverNoUserToken), 1);
  assert.equal(CONSOLE_WORDS.serverNoUserToken, "Blue takes the customer your server names from user_id, so user_token isn't sent.");
  assert.deepEqual(stored, []);
  made.dispose();
  // An app key with the same options warns of neither.
  clearLogs();
  new CaptivateChatAPI(appKey(), 'prod', { storage, userSecret: () => 's'.repeat(43) }).dispose();
  assert.equal(warned(CONSOLE_WORDS.serverKeepsNothing), 0);
});

test("refusals: server_only and any other 401 or 403 in the developer's words, the app user's as app mode's; a delete past its day", async () => {
  const conversation = api.getConversation(ID, USER_A);
  fake.reply(jsonResponse({ error: { code: 'server_only', message: 'x' } }, 403));
  const fromPage = await refusal(() => conversation.getTranscript());
  assert.equal(fromPage.errorDesc, WORDS.cantReach);
  assert.equal(fromPage.code, 'server_only');
  assert.equal(warned(CONSOLE_WORDS.serverOnly), 1);
  assert.equal(CONSOLE_WORDS.serverOnly, 'This server key was refused because the request came from a web page. Use it only on your own server.');
  for (const status of [401, 403]) {
    fake.reply(jsonResponse({ error: { code: status === 401 ? 'unauthorized' : 'hidden', message: 'x' } }, status));
    const refused = await refusal(() => conversation.getTranscript());
    assert.equal(refused.errorDesc, WORDS.cantReach);
  }
  assert.equal(warned(CONSOLE_WORDS.serverKeyRefused), 1);
  assert.equal(CONSOLE_WORDS.serverKeyRefused, 'The server key was refused. Check it is the newest key from the Channels page and that it is turned on.');
  assert.equal(warned(CONSOLE_WORDS.keyRefused), 0, "never the app key's line");

  const dayCap = () => jsonResponse({ error: { code: 'day_limit', message: 'x' } }, 429, { 'retry-after': '40000' });
  fake.reply(dayCap());
  const one = await refusal(() => conversation.delete());
  assert.equal(one.errorDesc, WORDS.deletesDay);
  assert.equal(one.retryAfter, 40000);
  fake.reply(dayCap());
  const all = await refusal(() => api.deleteUserConversations(USER_A));
  assert.equal(all.errorDesc, WORDS.deletesDay);
  assert.equal(WORDS.deletesDay, 'No more conversations can be deleted today. Please try again tomorrow.');
  // A minute's 429 on a delete stays the minute's words.
  fake.reply(jsonResponse({ error: { code: 'rate_limited', message: 'x' } }, 429, { 'retry-after': '30' }));
  assert.equal((await refusal(() => conversation.delete())).errorDesc, WORDS.tooMany);
});

test('with debug on, no log line or error carries the key, its secret, Authorization or a user ID', async () => {
  CaptivateChatAPI.setDebugMode(true);
  const errors: string[] = [];
  const keep = (error: unknown) => errors.push(String((error as Error)?.message ?? error));
  fake.reply(start(ID, { greeting: { text: 'Hello there.', starters: [] } }));
  const conversation = await api.createConversation(USER_A, {}, { user_id: 'C-1042' }, 'bot-first');
  conversation.onError(keep);
  await send(conversation, new FakeResponse({ headers: NDJSON, body: lineChunks(streamOf('answer-cited').replace(/"conversationId":"[0-9a-f]{24}"/, `"conversationId":"${ID}"`)) }));
  await send(conversation, new FakeResponse({ headers: NDJSON, body: streamOf('offer').replace(/"conversationId":"[0-9a-f]{24}"/, `"conversationId":"${ID}"`) }));
  fake.reply(jsonResponse(jsonOf('offer.press.json')));
  await conversation.sendAction(OFFER, { values: { name: 'Sam Lee' } });
  fake.reply(jsonResponse({ stopped: false }));
  await conversation.stop();
  fake.reply(readBack());
  await conversation.getTranscript();
  // The start's copy answers it: no call.
  await conversation.getMetadata();
  fake.reply(jsonResponse({ metadata: { plan: 'gold' } }));
  await conversation.setMetadata({ plan: 'gold' });
  fake.reply(jsonResponse({ uploadId: '0'.repeat(31) + '2', url: 'https://files.example.test/u?sig=made-up', headers: {}, expiresAt: '2099-01-01T00:00:00.000Z' }, 201));
  fake.reply(new FakeResponse({ status: 500, body: '' }));
  await conversation.fileManager.create({ file: new File(['%PDF-1.4'], 'order.pdf', { type: 'application/pdf' }) }).catch(keep);
  fake.reply(listed([ID]));
  await api.getUserConversations(USER_A);
  fake.reply(jsonResponse({ error: { code: 'server_only', message: 'x' } }, 403));
  await api.getConversation(ID, USER_B).getTranscript().catch(keep);
  fake.reply(jsonResponse({ error: { code: 'unauthorized', message: 'x' } }, 401));
  await api.getConversation(ID, USER_B).sendMessage('Hi').catch(keep);
  fake.reply(new Error('network down'));
  await conversation.delete().catch(keep);
  fake.reply(jsonResponse({ deleted: 1, busy: 0 }));
  await api.deleteUserConversations(USER_A);
  api.getConversation(ID, USER_A).resume();
  await flush();
  api.dispose();
  assert.equal(fake.pending, 0, 'every reply was taken by the call it was for');

  assert.ok(linesAt('log').length > 10, 'debug mode logged the calls');
  const text = [...logged.map((l) => l.text), ...errors].join('\n');
  for (const secret of [key, secretPart, `Bearer`, USER_A, USER_B]) assert.ok(!text.includes(secret), `no ${secret === key ? 'key' : secret}`);
  assert.ok(text.includes(keyIdOf(key)), 'the key named by its id');
});

test("each fixture gives the same callbacks in server mode as app mode's, with the user named on the send", async () => {
  const ending = streamNames().filter((name) => name !== 'case-cut-after-text' && name !== 'case-not-json');
  assert.ok(ending.length > 5);
  for (const name of ending) {
    const text = streamOf(name);
    const id = JSON.parse(text.split('\n').find((l) => l.trim())!).conversationId;
    const conversation = api.getConversation(id, USER_A);
    const calls: Call[] = record(conversation);
    fake.reply(new FakeResponse({ headers: NDJSON, body: lineChunks(text) }));
    await conversation.sendMessage('Hello');
    await flush();
    assert.equal(clock.pending, 0, `${name}: nothing is left waiting`);
    assert.deepEqual(calls, JSON.parse(readFileSync(join(FIXTURES, `${name}.callbacks.json`), 'utf8')).calls, name);
    assert.equal(fake.last!.headers['x-blue-user'], USER_A, name);
  }
});

test("Node's own fetch to a real server: the headers a backend sees, and no Origin", async () => {
  const seen: { method?: string; url?: string; headers: IncomingHttpHeaders }[] = [];
  const server = createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, headers: request.headers });
    request.resume();
    request.on('end', () => {
      if (request.url === '/v1/chat/conversations' && request.method === 'POST') {
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ conversationId: ID, greeting: null, details: [] }));
      } else if (request.url === '/v1/chat') {
        response.writeHead(200, NDJSON);
        response.end(line({ type: 'conversation', conversationId: ID }) + line({ type: 'text', text: 'Hi.' }) + line({ type: 'done' }));
      } else {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ total: 0, page: 1, pageSize: 20, items: [] }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.restore();
  try {
    const { key: other } = wholeServerKey();
    const made = await CaptivateChatAPI.create(other, 'prod', { blueUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    const conversation = await made.createConversation(USER_A, {}, {}, 'user-first');
    const answered = new Promise((resolve) => conversation.onAnswer(resolve));
    await conversation.sendMessage('Hello');
    assert.deepEqual(await answered, { text: 'Hi.', sources: [] });
    await made.getUserConversations(USER_A);
    made.dispose();
    assert.deepEqual(seen.map((s) => `${s.method} ${s.url}`), ['POST /v1/chat/conversations', 'POST /v1/chat', 'GET /v1/chat/conversations?page=1&limit=50']);
    for (const { headers } of seen) {
      assert.equal(headers.origin, undefined, `no Origin on Node ${process.versions.node}`);
      assert.equal(headers.authorization, `Bearer ${other}`);
      assert.equal(headers['x-blue-user'], USER_A);
      assert.equal(headers['x-blue-conversation'], undefined);
      assert.equal(headers.cookie, undefined);
    }
  } finally {
    fake.install();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
