// Blue mode's keys (first-channels-library-spec §2.1, §1.2): each key's shape picks its path,
// the refused ones in their setup words, and an app key opens no socket.
import { FakeWebSocket, appKey, freshId, serverKey } from './helpers';
import { linesAt, clearLogs } from '../fakes/console';
import { FakeFetch } from '../fakes/fetch';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CaptivateChatAPI } from '../../src/api/CaptivateChatAPI';
import { blueKeyKind, isBlueKey } from '../../src/api/blue/keys';
import { BLUE_URLS, BlueTransport } from '../../src/api/blue/transport';
import { CONSOLE_WORDS, SETUP_WORDS } from '../../src/api/blue/words';
import * as library from '../../src/index';

let fake: FakeFetch;

beforeEach(() => {
  FakeWebSocket.reset();
  clearLogs();
  fake = new FakeFetch().install();
});

afterEach(() => {
  fake.restore();
});

const transportOf = (api: CaptivateChatAPI): BlueTransport | null => (api as any).blue;

test('isBlueKey takes every vb?_ shape and nothing else, and the package exports it', () => {
  for (const key of ['vba_x', 'vbk_x', 'vbw_x', 'vbm_x', 'vbz_']) assert.equal(isBlueKey(key), true, key);
  for (const key of ['', 'vb_x', 'vbA_x', 'abc123', 'test-key-1', 'VBA_x', ' vba_x', 'vbaa_x']) {
    assert.equal(isBlueKey(key), false, key);
  }
  assert.equal(isBlueKey(undefined), false);
  assert.equal(library.isBlueKey, isBlueKey);
});

test('blueKeyKind tells each shape apart', () => {
  const id = freshId();
  assert.equal(blueKeyKind(`vba_${id}`), 'app');
  assert.equal(blueKeyKind(`vbk_${id}_${'0f'.repeat(32)}`), 'server');
  assert.equal(blueKeyKind(`vbk_${id}`), 'server-partial');
  assert.equal(blueKeyKind(`vbk_${id}_${'0f'.repeat(31)}`), 'server-partial');
  assert.equal(blueKeyKind(`vbw_${id}`), 'website');
  assert.equal(blueKeyKind(`vbm_${id}`), 'other');
  assert.equal(blueKeyKind(`vbm_${id}_${'0f'.repeat(32)}`), 'other');
  // A vba_ key of the wrong form isn't an app key.
  assert.equal(blueKeyKind(`vba_${id.toUpperCase()}A`), 'other');
  assert.equal(blueKeyKind(`vba_${id.slice(1)}`), 'other');
  assert.equal(blueKeyKind(`vba_${id}0`), 'other');
  assert.equal(blueKeyKind('abc123'), null);
});

test('a website key, another vb?_ key and a server key cut short are refused in their words, and never registered', () => {
  const id = freshId();
  const cases: [string, string][] = [
    [`vbw_${id}`, "Website keys work only in Blue's own chat window. Make a key for your app on the Channels page."],
    [`vbm_${id}`, "This key isn't for apps. Make a key for your app on the Channels page."],
    [`vbx_${id}`, "This key isn't for apps. Make a key for your app on the Channels page."],
    [`vba_${id}x`, "This key isn't for apps. Make a key for your app on the Channels page."],
    [`vbk_${id}`, "This server key isn't whole. Copy it again from the Channels page."],
  ];
  for (const [key, words] of cases) {
    assert.throws(() => new CaptivateChatAPI(key, 'prod'), { message: words }, key);
    assert.equal(CaptivateChatAPI.hasInstance(key, 'prod'), false, key);
  }
  assert.equal(SETUP_WORDS.websiteKey, cases[0][1]);
  assert.equal(SETUP_WORDS.notForApps, cases[1][1]);
  assert.equal(SETUP_WORDS.serverKeyNotWhole, cases[4][1]);
  assert.equal(FakeWebSocket.instances.length, 0);
});

test('create() refuses a refused key before connecting anything', async () => {
  await assert.rejects(CaptivateChatAPI.create(`vbw_${freshId()}`, 'prod'), { message: SETUP_WORDS.websiteKey });
  assert.equal(FakeWebSocket.instances.length, 0);
  assert.equal(fake.requests.length, 0);
});

test('a whole server key opens no socket and is refused until server mode is built (step K4)', () => {
  const key = serverKey();
  assert.throws(() => new CaptivateChatAPI(key, 'prod'));
  assert.equal(CaptivateChatAPI.hasInstance(key, 'prod'), false);
  assert.equal(FakeWebSocket.instances.length, 0);
});

test('core keys keep core path: no Blue transport, the socket address as today', async () => {
  const api = new CaptivateChatAPI('core-key-for-blue-tests', 'prod');
  assert.equal(transportOf(api), null);
  const connecting = api.connect();
  assert.equal(FakeWebSocket.last!.url, 'wss://channel.wss.captivatechat.ai/dev?apiKey=core-key-for-blue-tests');
  FakeWebSocket.last!.open();
  await connecting;
  api.dispose();
});

test('an app key opens no socket: connect and reconnect resolve at once, the socket accessors are null', async () => {
  const api = new CaptivateChatAPI(appKey(), 'prod');
  assert.ok(transportOf(api));
  assert.equal(api.isSocketActive(), true);
  await api.connect();
  await api.reconnect();
  await api.reconnect();
  assert.equal(api.getSocket(), null);
  assert.equal(api.getSocketId(), null);
  assert.equal(FakeWebSocket.instances.length, 0);
  assert.equal(fake.requests.length, 0);
  api.dispose();
});

test('create() with an app key returns a guarded instance with no socket and no request', async () => {
  const key = appKey();
  const api = await CaptivateChatAPI.create(key, 'dev');
  assert.equal(api.isSocketActive(), true);
  assert.equal(FakeWebSocket.instances.length, 0);
  assert.equal(fake.requests.length, 0);
  // The same key and mode give the same instance, as core's do.
  const again = await CaptivateChatAPI.create(key, 'dev');
  assert.equal(transportOf(api), transportOf(again));
  assert.equal(transportOf(CaptivateChatAPI.getInstance(key, 'dev')!), transportOf(api));
  api.dispose();
});

test('isSocketActive stays true through the guard, so a guarded call never reconnects, until dispose()', async () => {
  const api = await CaptivateChatAPI.create(appKey(), 'prod');
  const inner = CaptivateChatAPI.getInstance((transportOf(api) as BlueTransport).apiKey, 'prod')!;
  let reconnects = 0;
  const reconnect = inner.reconnect.bind(inner);
  (inner as any).reconnect = async () => {
    reconnects += 1;
    return reconnect();
  };
  // getUserConversations goes through the guard (it isn't in UNGUARDED_METHODS); its Blue
  // branch is a later step's, so only the guard's part is looked at here.
  await (api as any).getUserConversations('user-1').catch(() => undefined);
  assert.equal(reconnects, 0);
  assert.equal(FakeWebSocket.instances.length, 0);

  api.dispose();
  assert.equal(api.isSocketActive(), false);
  await assert.rejects((api as any).getUserConversations('user-1'), /disposed/);
  assert.equal(FakeWebSocket.instances.length, 0);
  // After dispose(), a new instance can be made for the same key.
  const key = (transportOf(api) as BlueTransport).apiKey;
  assert.equal(CaptivateChatAPI.hasInstance(key, 'prod'), false);
  const fresh = new CaptivateChatAPI(key, 'prod');
  assert.equal(fresh.isSocketActive(), true);
  fresh.dispose();
});

test("Blue mode's new listener methods and local calls stay synchronous through the guard", async () => {
  const api = await CaptivateChatAPI.create(appKey(), 'prod');
  const marks: Record<string, unknown> = {};
  const inner = CaptivateChatAPI.getInstance((transportOf(api) as BlueTransport).apiKey, 'prod') as any;
  for (const name of ['onDelta', 'onAnswer', 'onStep', 'resume', 'forgetUser']) {
    inner[name] = () => (marks[name] = 'called');
    const result = (api as any)[name]();
    assert.equal(result, 'called', name);
  }
  // stop stays guarded: a Conversation's method, which returns a Promise anyway.
  inner.stop = () => 'called';
  assert.ok((api as any).stop() instanceof Promise);
  api.dispose();
});

test('dispose() connects nothing in Blue mode and ends the transport', async () => {
  const api = new CaptivateChatAPI(appKey(), 'prod');
  const transport = transportOf(api)!;
  api.dispose();
  assert.equal(transport.isDisposed, true);
  await assert.rejects(api.connect(), /disposed/);
  assert.equal(FakeWebSocket.instances.length, 0);
});

test('the new options are taken when made, by configure() and by create()', async () => {
  const fetchOption = async () => undefined;
  const storage = { get: () => null, set: () => undefined, remove: () => undefined };
  const api = new CaptivateChatAPI(appKey(), 'prod', { blueUrl: 'https://blue.example/', stream: 'xhr', connectTimeoutMs: 5 });
  const transport = transportOf(api)!;
  assert.equal(transport.baseUrl, 'https://blue.example');
  assert.equal(transport.settings.stream, 'xhr');

  api.configure({ fetch: fetchOption, storage, stream: 'whole' });
  assert.equal(transport.settings.fetch, fetchOption);
  assert.equal(transport.settings.storage, storage);
  assert.equal(transport.settings.stream, 'whole');
  // Left out, an option keeps its value.
  assert.equal(transport.baseUrl, 'https://blue.example');
  api.dispose();

  const key = appKey();
  const created = await CaptivateChatAPI.create(key, 'dev', { userSecret: () => 's'.repeat(43) });
  assert.equal(typeof transportOf(created)!.settings.userSecret, 'function');
  assert.equal(transportOf(created)!.baseUrl, BLUE_URLS.dev);
  created.dispose();
});

test("blueUrl's defaults are Blue's BLUE_BACKEND_PUBLIC_URL for each mode", () => {
  assert.equal(BLUE_URLS.prod, 'https://vienna-blue-backend.prod.captivat.io');
  assert.equal(BLUE_URLS.dev, 'https://vienna-blue-backend.dev.captivat.io');
  const prod = new CaptivateChatAPI(appKey(), 'prod');
  const dev = new CaptivateChatAPI(appKey(), 'dev');
  assert.equal(transportOf(prod)!.baseUrl, BLUE_URLS.prod);
  assert.equal(transportOf(dev)!.baseUrl, BLUE_URLS.dev);
  prod.dispose();
  dev.dispose();
});

test('no secure random source is refused in its words; options.randomValues stands in', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
  try {
    const key = appKey();
    assert.throws(() => new CaptivateChatAPI(key, 'prod'), {
      message: 'Blue mode needs a secure random source here. Add one, or pass options.randomValues.',
    });
    assert.equal(CaptivateChatAPI.hasInstance(key, 'prod'), false);

    const randomValues = (bytes: Uint8Array) => bytes.fill(7);
    const api = new CaptivateChatAPI(appKey(), 'prod', { randomValues });
    assert.deepEqual([...transportOf(api)!.randomBytes(3)], [7, 7, 7]);
    api.dispose();
    // A core key needs none.
    const core = new CaptivateChatAPI('core-key-without-crypto', 'prod');
    core.dispose();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
  }
  const api = new CaptivateChatAPI(appKey(), 'prod');
  assert.equal(transportOf(api)!.randomBytes(32).length, 32);
  api.dispose();
});

test('a page with no web address is warned about once, in its words', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { value: { protocol: 'file:', origin: 'null' }, configurable: true });
  try {
    const api = new CaptivateChatAPI(appKey(), 'prod');
    api.dispose();
    assert.deepEqual(linesAt('warn'), [`[CaptivateChatAPI] ${CONSOLE_WORDS.noWebAddress}`]);
    assert.equal(
      CONSOLE_WORDS.noWebAddress,
      "This app's pages aren't on a web address, so the key can't check where they are. Use the library from the app's main process, or register the app's own scheme and list its address on the key."
    );
  } finally {
    if (had) Object.defineProperty(globalThis, 'location', had);
    else delete (globalThis as any).location;
  }
  clearLogs();
  Object.defineProperty(globalThis, 'location', { value: { protocol: 'https:', origin: 'https://app.example' }, configurable: true });
  try {
    new CaptivateChatAPI(appKey(), 'prod').dispose();
    assert.deepEqual(linesAt('warn'), []);
  } finally {
    delete (globalThis as any).location;
  }
});
