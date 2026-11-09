// The app's users and their secrets (first-channels-library-spec §2.6): a secret per key and
// user, kept under a name holding the ID's sha256 and never the ID, in options.storage (sync or
// async), localStorage or memory; or the app's own server's, checked for its form alone.
import { FakeWebSocket, appKey } from './helpers';
import { clearLogs } from '../fakes/console';
import { FakeFetch, RecordedRequest, jsonResponse } from '../fakes/fetch';
import { FakeAsyncStorage, FakeStorage, ThrowingStorage } from '../fakes/storage';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CaptivateChatAPI } from '../../src/api/CaptivateChatAPI';
import { BlueUsers, base64url, sha256, userHash, utf8Bytes } from '../../src/api/blue/secrets';
import { SETUP_WORDS } from '../../src/api/blue/words';
import { flush } from './answers';

let fake: FakeFetch;
const made: CaptivateChatAPI[] = [];

beforeEach(() => {
  FakeWebSocket.reset();
  clearLogs();
  fake = new FakeFetch().install();
});

afterEach(() => {
  for (const api of made.splice(0)) api.dispose();
  fake.restore();
});

async function blueApi(key = appKey(), options: Record<string, unknown> = {}): Promise<CaptivateChatAPI> {
  const api = await CaptivateChatAPI.create(key, 'prod', options);
  made.push(api);
  return api;
}

let started = 0;
/** The start's answer, with a new conversation id each time. */
function started201() {
  started += 1;
  return jsonResponse({ conversationId: `c${started.toString().padStart(23, '0')}`, greeting: null, details: [] }, 201);
}

const secretOf = (request: RecordedRequest | undefined) => request?.headers['x-blue-conversation'];

const nodeHash = (text: string) => createHash('sha256').update(text, 'utf8').digest('base64url');

test('sha256 and base64url match Node\'s own, on ASCII, UTF-8 and every padding length', () => {
  const texts = ['', 'abc', 'ann@example.com', 'é漢😀', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(1000)];
  for (const text of texts) assert.equal(userHash(text), nodeHash(text), text);
  assert.equal(
    Buffer.from(sha256(utf8Bytes('abc'))).toString('hex'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  for (let n = 0; n < 8; n++) {
    const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 250) & 255);
    assert.equal(base64url(bytes), Buffer.from(bytes).toString('base64url'), String(n));
  }
});

test('a secret for each key and user: the same user gets theirs again, another user and another key their own', async () => {
  const storage = new FakeStorage();
  const api = await blueApi(appKey(), { storage });
  fake.reply(started201(), started201(), started201(), started201());
  await api.createConversation('user-1', {}, {}, 'user-first');
  await api.createConversation('user-1', {}, {}, 'user-first');
  await api.createConversation('user-2', {}, {}, 'user-first');
  const other = await blueApi(appKey(), { storage });
  await other.createConversation('user-1', {}, {}, 'user-first');
  const [a, b, c, d] = fake.requests.map(secretOf);
  assert.match(a!, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.notEqual(c, d);
});

test('the storage name holds the sha256 of the user\'s ID, never the ID, and nothing stored holds it', async () => {
  const storage = new FakeStorage();
  const key = appKey();
  const api = await blueApi(key, { storage });
  fake.reply(started201());
  await api.createConversation('ann@example.com', {}, { user_id: 'C-1042', user_token: 'token-value' }, 'user-first');
  const names = storage.entries().map(([name]) => name);
  assert.ok(names.includes(`vb:${key}:${nodeHash('ann@example.com')}`), names.join(', '));
  assert.equal(storage.getItem(`vb:${key}:${nodeHash('ann@example.com')}`), secretOf(fake.last));
  for (const [name, value] of storage.entries()) {
    assert.ok(name.startsWith(`vb:${key}:`), name);
    for (const word of ['ann@example.com', 'C-1042', 'token-value']) {
      assert.ok(!name.includes(word) && !value.includes(word), `${name} = ${value}`);
    }
  }
});

test('an async store (AsyncStorage\'s names, or get, set and remove) keeps the secret across a restart', async () => {
  const asyncStorage = new FakeAsyncStorage();
  const map = new Map<string, string>();
  const ownNames = {
    get: async (name: string) => map.get(name) ?? null,
    set: async (name: string, value: string) => void map.set(name, value),
    remove: async (name: string) => void map.delete(name),
  };
  for (const storage of [asyncStorage, ownNames]) {
    const key = appKey();
    const api = await blueApi(key, { storage });
    fake.reply(started201());
    const first = await api.createConversation('user-1', {}, {}, 'user-first');
    const sent = secretOf(fake.last);
    api.dispose();
    // The app opens again: the same key and store, a new instance.
    const again = await blueApi(key, { storage });
    fake.reply(started201());
    await again.createConversation('user-1', {}, {}, 'user-first');
    assert.equal(secretOf(fake.last), sent);
    // And a conversation's user is found by its id alone, with nobody named.
    again.dispose();
    const third = await blueApi(key, { storage });
    fake.reply(jsonResponse({ messages: [], answering: false, metadata: {}, details: [] }));
    await third.getConversation(first.getConversationId()).getTranscript();
    assert.equal(secretOf(fake.last), sent);
  }
});

test('localStorage when no store is given, and memory when none can be used', async () => {
  const local = new FakeStorage();
  (globalThis as any).localStorage = local;
  try {
    const key = appKey();
    const api = await blueApi(key);
    fake.reply(started201());
    await api.createConversation('user-1', {}, {}, 'user-first');
    assert.equal(local.getItem(`vb:${key}:${nodeHash('user-1')}`), secretOf(fake.last));
  } finally {
    delete (globalThis as any).localStorage;
  }
  for (const storage of [new ThrowingStorage(), undefined]) {
    const api = await blueApi(appKey(), storage ? { storage } : {});
    fake.reply(started201(), started201());
    await api.createConversation('user-1', {}, {}, 'user-first');
    await api.createConversation('user-1', {}, {}, 'user-first');
    const [a, b] = fake.requests.slice(-2).map(secretOf);
    assert.match(a!, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(a, b);
  }
});

test('two conversations started at once for a new user make one secret', async () => {
  const storage = new FakeAsyncStorage();
  const api = await blueApi(appKey(), { storage });
  fake.reply(started201(), started201());
  await Promise.all([
    api.createConversation('user-1', {}, {}, 'user-first'),
    api.createConversation('user-1', {}, {}, 'user-first'),
  ]);
  assert.equal(secretOf(fake.requests[0]), secretOf(fake.requests[1]));
  assert.equal(storage.store.writes.filter((w) => w.key.endsWith(nodeHash('user-1'))).length, 1);
});

test('options.userSecret: the app server\'s secret is sent as given and never stored; one not of its form is refused', async () => {
  const good = 'A'.repeat(20) + '-_' + 'z9'.repeat(10) + 'q';
  assert.equal(good.length, 43);
  const storage = new FakeStorage();
  const asked: string[] = [];
  const api = await blueApi(appKey(), {
    storage,
    userSecret: async (userId: string) => {
      asked.push(userId);
      return good;
    },
  });
  fake.reply(started201(), started201());
  await api.createConversation('user-1', {}, {}, 'user-first');
  await api.createConversation('user-1', {}, {}, 'user-first');
  assert.equal(secretOf(fake.requests[0]), good);
  assert.equal(secretOf(fake.requests[1]), good);
  assert.deepEqual(asked, ['user-1']);
  for (const [, value] of storage.entries()) assert.ok(!value.includes(good));

  const bad = ['A'.repeat(42), 'A'.repeat(42) + '+', 'A'.repeat(42) + '/', 'A'.repeat(42) + '=', 'A'.repeat(129), ''];
  for (const secret of bad) {
    const refused = await blueApi(appKey(), { userSecret: () => secret });
    const before = fake.requests.length;
    await assert.rejects(refused.createConversation('user-1', {}, {}, 'user-first'), { message: SETUP_WORDS.userSecretForm }, secret);
    assert.equal(fake.requests.length, before);
  }
  assert.equal(SETUP_WORDS.userSecretForm, 'options.userSecret must give a secret of 43 to 128 letters, digits, - or _ (base64url).');
  const longest = await blueApi(appKey(), { userSecret: () => 'b'.repeat(128) });
  fake.reply(started201());
  await longest.createConversation('user-1', {}, {}, 'user-first');
  assert.equal(secretOf(fake.last), 'b'.repeat(128));
});

test('forgetUser removes the stored secret and the user\'s handles, and the user gets a new secret after', async () => {
  const storage = new FakeStorage();
  const key = appKey();
  const api = await blueApi(key, { storage });
  fake.reply(started201(), started201());
  const conversation = await api.createConversation('user-1', {}, {}, 'user-first');
  const id = conversation.getConversationId();
  const before = secretOf(fake.last);
  const returned = api.forgetUser('user-1');
  assert.equal(returned, undefined);
  await flush();
  assert.equal(storage.getItem(`vb:${key}:${nodeHash('user-1')}`), null);
  assert.ok(!(storage.getItem(`vb:${key}:conversations`) ?? '').includes(id));
  assert.notEqual(api.getConversation(id), conversation);
  await api.createConversation('user-1', {}, {}, 'user-first');
  assert.notEqual(secretOf(fake.last), before);
});

test('a forgetUser during a lookup still in flight leaves the user neither known nor the last user', async () => {
  const storage = new FakeAsyncStorage();
  const api = await blueApi(appKey(), { storage });
  const users = (api as any).blueUsers as BlueUsers;
  const lookup = users.secretFor('user-1', true);
  const forgetting = users.forget('user-1');
  assert.match((await lookup)!, /^[A-Za-z0-9_-]{43}$/);
  await forgetting;
  assert.equal(users.lastUser, null);
  // Not held in memory, and removed from the device: no secret until one is made again.
  assert.equal(await users.secretFor('user-1', false), null);
  assert.equal(users.lastUser, null);
  assert.match((await users.secretFor('user-1', true))!, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(users.lastUser, 'user-1');
});

test("getConversation(id, userId) with an app key opens a conversation this instance does not know with that user's secret, not the last user's", async () => {
  const storage = new FakeStorage();
  const api = await blueApi(appKey(), { storage });
  fake.reply(started201(), started201());
  await api.createConversation('user-a', {}, {}, 'user-first');
  const secretA = secretOf(fake.last);
  await api.createConversation('user-b', {}, {}, 'user-first');
  assert.notEqual(secretOf(fake.last), secretA);
  // A conversation no handle and no kept binding knows: the last user named is B, so the id alone would use B's secret.
  const other = 'f'.repeat(24);
  fake.reply(jsonResponse({ _id: other, messages: [], answering: false, metadata: {}, details: [] }));
  await api.getConversation(other, 'user-a').getTranscript();
  assert.equal(secretOf(fake.last), secretA);
});
