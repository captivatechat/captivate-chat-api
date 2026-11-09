// Conversations by user (first-channels-library-spec §2.2; gaps G1, G7, G10, G13, G16): the start
// with its metadata and greeting, a handle's user, the list and its pages, the deletes, the
// metadata in the shapes apps on 7.0 read, the transcript, and what Blue mode doesn't do.
import { FakeWebSocket, appKey } from './helpers';
import { clearLogs, linesAt } from '../fakes/console';
import { FakeFetch, RecordedRequest, jsonResponse } from '../fakes/fetch';
import { FakeStorage } from '../fakes/storage';
import { FakeClock } from '../fakes/clock';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CaptivateChatAPI } from '../../src/api/CaptivateChatAPI';
import { CaptivateChatManager } from '../../src/api/CaptivateChatManager';
import { Conversation, blueStateOf } from '../../src/api/Conversation';
import { BlueError } from '../../src/api/blue/transport';
import { CONSOLE_WORDS, METADATA_TOO_BIG, NOT_HERE, SETUP_WORDS, WORDS } from '../../src/api/blue/words';
import { jsonOf } from './fixtures';

const BASE = 'https://vienna-blue-backend.prod.captivat.io';
const ID = '0000000000000000000000c1';

let fake: FakeFetch;
let clock: FakeClock;
let storage: FakeStorage;
let api: CaptivateChatAPI;

beforeEach(async () => {
  FakeWebSocket.reset();
  clearLogs();
  fake = new FakeFetch().install();
  clock = new FakeClock();
  storage = new FakeStorage();
  api = await blueApi();
});

afterEach(() => {
  api.dispose();
  fake.restore();
});

async function blueApi(key = appKey(), options: Record<string, unknown> = {}): Promise<CaptivateChatAPI> {
  const made = await CaptivateChatAPI.create(key, 'prod', { storage, ...options });
  (made as any).blueClock = clock;
  return made;
}

function start(body: Record<string, unknown> = {}) {
  return jsonResponse({ conversationId: ID, greeting: null, details: [], ...body }, 201);
}

const readBack = (body: Record<string, unknown> = {}) =>
  jsonResponse({ _id: ID, createdAt: '2026-01-05T09:00:00.000Z', updatedAt: '2026-01-05T09:00:02.000Z', messages: [], answering: false, metadata: {}, details: [], ...body });

const secretOf = (request: RecordedRequest | undefined) => request?.headers['x-blue-conversation'];

async function created(metadata: Record<string, unknown> = {}, reply = start(), privateMetadata: object = {}): Promise<Conversation> {
  fake.reply(reply);
  return api.createConversation('user-1', { name: 'never sent' }, metadata, 'user-first', privateMetadata);
}

test('createConversation sends the metadata as given but user_id and user_token, which stay in memory, and nothing else', async () => {
  const metadata = { user_id: 'C-1042', user_token: 'token-value', plan: 'gold', conversation_title: 'Orders', nested: { a: [1, 2] } };
  const conversation = await created(metadata, start(), { secret: 'never sent' });
  const request = fake.last!;
  assert.equal(request.method, 'POST');
  assert.equal(request.url, `${BASE}/v1/chat/conversations`);
  assert.deepEqual(request.json, { metadata: { plan: 'gold', conversation_title: 'Orders', nested: { a: [1, 2] } }, greeting: false });
  assert.match(secretOf(request)!, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(conversation.getConversationId(), ID);
  assert.equal((conversation as any).conversationId, ID);
  const state = blueStateOf(conversation)!;
  assert.equal(state.given.user_id, 'C-1042');
  assert.equal(state.given.user_token, 'token-value');
  assert.deepEqual((conversation as any).metadata.channelMetadata.custom, request.json.metadata);
  for (const word of ['never sent', 'token-value', 'C-1042']) assert.ok(!String(request.body).includes(word), word);
  // The user's metadata isn't passed by reference: a later change in the app's object isn't Blue's.
  metadata.plan = 'changed';
  assert.equal(state.given.plan, 'gold');
});

test('metadata over 4 KB once user_id and user_token are out is refused before sending, counted in UTF-8 bytes', async () => {
  // {"a":"…"} is 8 bytes around its value.
  const token = 't'.repeat(5000);
  await created({ a: 'x'.repeat(4088), user_token: token });
  assert.equal(fake.requests.length, 1);
  await assert.rejects(api.createConversation('user-1', {}, { a: 'x'.repeat(4089) }, 'user-first'), { message: METADATA_TOO_BIG });
  fake.reply(start());
  await api.createConversation('user-1', {}, { a: '😀'.repeat(1022) }, 'user-first');
  await assert.rejects(api.createConversation('user-1', {}, { a: '😀'.repeat(1023) }, 'user-first'), { message: METADATA_TOO_BIG });
  assert.equal(fake.requests.length, 2);
  assert.equal(METADATA_TOO_BIG, 'Blue keeps at most 4 KB of metadata with a conversation. Keep less in it.');
});

test('the start waits createConversation\'s own time, and its 429 for too many empty conversations reads in its words', async () => {
  const realSetTimeout = setTimeout;
  const asked: number[] = [];
  (globalThis as any).setTimeout = (run: () => void, ms: number) => {
    asked.push(ms);
    return realSetTimeout(run, 0);
  };
  try {
    fake.reply(() => new Promise(() => undefined));
    await assert.rejects(api.createConversation('user-1', {}, {}, 'user-first', {}, { timeoutMs: 1234 }), { message: /couldn't answer/ });
  } finally {
    (globalThis as any).setTimeout = realSetTimeout;
  }
  assert.ok(asked.includes(1234), String(asked));
  fake.reply(jsonResponse({ error: { code: 'too_many_empty', message: 'x' } }, 429, { 'retry-after': '3600' }));
  const error = (await api.createConversation('user-1', {}, {}, 'user-first').catch((e) => e)) as BlueError;
  assert.equal(error.errorDesc, WORDS.tooManyNew);
  assert.equal(error.retryAfter, 3600);
});

test('bot-first: the greeting comes to onMessage on the next tick, then onAnswer with its starters, and leads the transcript until the first message', async () => {
  fake.reply(start({ greeting: { text: 'Hi, I can help with orders.', starters: ['Where is my order?', 'Opening hours'] } }));
  const conversation = await api.createConversation('user-1', {}, {}, 'bot-first');
  assert.equal(fake.last!.json.greeting, true);
  const messages: unknown[][] = [];
  const answers: unknown[] = [];
  conversation.onMessage((content, type) => messages.push([content, type]));
  conversation.onAnswer((answer) => answers.push(answer));
  assert.equal(messages.length, 0);
  clock.tick(0);
  assert.deepEqual(messages, [[[{ type: 'text', text: 'Hi, I can help with orders.' }], 'ai_agent']]);
  // The full app reads onMessage's content with for…of.
  const texts: string[] = [];
  for (const item of messages[0][0] as any) texts.push(item.text);
  assert.deepEqual(texts, ['Hi, I can help with orders.']);
  assert.deepEqual(answers, [{ text: 'Hi, I can help with orders.', sources: [], choices: ['Where is my order?', 'Opening hours'] }]);
  clock.tick(1000);
  assert.equal(messages.length, 1);

  fake.reply(readBack());
  const [first, ...rest] = (await conversation.getTranscript()) as any[];
  assert.equal(rest.length, 0);
  assert.equal(first.sender, 'bot');
  assert.equal(first.from, 'bot');
  assert.equal(first.text, 'Hi, I can help with orders.');
  assert.deepEqual(first.content, [{ type: 'text', text: 'Hi, I can help with orders.' }]);
  fake.reply(jsonResponse(jsonOf('answer-cited.read-back.json')));
  const transcript = (await conversation.getTranscript()) as any[];
  assert.deepEqual(transcript.map((m) => m.sender), ['user', 'bot']);
});

test('bot-first with a store that answers on a later turn still gives the greeting to listeners added after createConversation resolves', async () => {
  const slow = new Map<string, string>();
  const later = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
  const asyncStorage = {
    async getItem(key: string) {
      await later();
      return slow.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      await later();
      slow.set(key, value);
    },
    async removeItem(key: string) {
      await later();
      slow.delete(key);
    },
  };
  // The real clock: a timer set when the handle was built would fire while the store was still working.
  const real = await CaptivateChatAPI.create(appKey(), 'prod', { storage: asyncStorage });
  try {
    fake.reply(start({ greeting: { text: 'Hi, I can help with orders.', starters: ['Opening hours'] } }));
    const conversation = await real.createConversation('user-1', {}, {}, 'bot-first');
    const messages: unknown[] = [];
    const answers: unknown[] = [];
    conversation.onMessage((content) => messages.push(content));
    conversation.onAnswer((answer) => answers.push(answer));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(messages, [[{ type: 'text', text: 'Hi, I can help with orders.' }]]);
    assert.deepEqual(answers, [{ text: 'Hi, I can help with orders.', sources: [], choices: ['Opening hours'] }]);
    // Once only, however many listeners come after.
    conversation.onAnswer(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(messages.length, 1);
  } finally {
    real.dispose();
  }
});

test('user-first asks for no greeting and gives none', async () => {
  const conversation = await created();
  const messages: unknown[] = [];
  conversation.onMessage((content) => messages.push(content));
  clock.tick(1000);
  assert.equal(fake.last!.json.greeting, false);
  assert.equal(messages.length, 0);
});

test('getTranscript reads the conversation back in core\'s shape and never writes', async () => {
  const conversation = await created();
  fake.reply(jsonResponse(jsonOf('answer-cited.read-back.json')));
  const transcript = (await conversation.getTranscript()) as any[];
  assert.equal(fake.last!.method, 'GET');
  assert.equal(fake.last!.url, `${BASE}/v1/chat/${ID}`);
  assert.deepEqual(transcript[0], {
    message_id: '000000000000000000000002',
    sender: 'user',
    from: 'user',
    content: [{ type: 'text', text: 'How long do refunds take?' }],
    text: 'How long do refunds take?',
    sources: [],
    timestamp: Date.parse('2026-01-05T09:00:01.000Z'),
    createdAt: '2026-01-05T09:00:01.000Z',
  });
  assert.equal(transcript[1].sources[0].number, 1);
  fake.reply(jsonResponse(jsonOf('stopped.read-back.json')));
  const stopped = (await conversation.getTranscript()) as any[];
  assert.equal(stopped[1].stopped, true);
  assert.equal(stopped[0].stopped, undefined);
  fake.reply(
    readBack({
      messages: [{ _id: 'm1', role: 'user', content: '', sources: [], attachments: [{ name: 'a.pdf', type: 'application/pdf', size: 12, url: 'https://files.example/a' }], at: '2026-01-05T09:00:01.000Z' }],
    })
  );
  const [withFile] = (await conversation.getTranscript()) as any[];
  assert.deepEqual(withFile.files, [{ filename: 'a.pdf', type: 'application/pdf', size: 12, url: 'https://files.example/a' }]);
  assert.equal(fake.requests.filter((r) => r.method !== 'GET').length, 1);
});

test('a handle from getConversation(id) takes the user kept with it, else the last one named, else each call refuses', async () => {
  // Nobody named on this instance, nothing kept: refused before any request.
  const unknown = api.getConversation('0000000000000000000000f1');
  await assert.rejects(unknown.getTranscript(), { message: SETUP_WORDS.userUnknown });
  await assert.rejects(unknown.sendMessage('hello'), { message: SETUP_WORDS.userUnknown });
  await assert.rejects(unknown.getMetadata(), { message: SETUP_WORDS.userUnknown });
  assert.equal(fake.requests.length, 0);
  assert.equal(SETUP_WORDS.userUnknown, "This conversation's user isn't known on this device. List the user's conversations first.");

  const conversation = await created();
  const secret = secretOf(fake.last);
  // The last user named.
  fake.reply(readBack());
  await api.getConversation('0000000000000000000000f2').getTranscript();
  assert.equal(secretOf(fake.last), secret);
  // The same handle comes back for the same id.
  assert.equal(api.getConversation(ID), conversation);

  // The app opens again: the conversation's user is the one kept with it on the device.
  const key = (api as any).apiKey;
  api.dispose();
  api = await blueApi(key);
  fake.reply(readBack());
  await api.getConversation(ID).getTranscript();
  assert.equal(secretOf(fake.last), secret);
  await assert.rejects(api.getConversation('0000000000000000000000f3').getTranscript(), { message: SETUP_WORDS.userUnknown });
});

test('getMetadata gives core\'s wrapper with channelMetadata in each place Engage reads, read back once when the handle has no copy', async () => {
  const conversation = await created({ conversation_title: 'Orders' });
  const meta = (await conversation.getMetadata()) as any;
  assert.equal(fake.requests.length, 1);
  assert.equal(meta.conversationId, ID);
  for (const place of [
    meta.metadata.event.event_payload.content.channelMetadata,
    meta.metadata.channelMetadata,
    meta.channelMetadata,
    meta.event.event_payload.content.channelMetadata,
  ]) {
    assert.deepEqual(place.custom, { conversation_title: 'Orders' });
  }

  const key = (api as any).apiKey;
  api.dispose();
  api = await blueApi(key);
  const handle = api.getConversation(ID);
  fake.reply(
    readBack({
      metadata: { conversation_title: 'Orders' },
      messages: [{ _id: 'm1', role: 'assistant', content: 'Your parcel left today.', sources: [], attachments: [], at: '2026-01-05T09:00:02.000Z' }],
      details: ['order_number'],
    })
  );
  const read = (await handle.getMetadata()) as any;
  assert.deepEqual(read.metadata.event.event_payload.content.channelMetadata, {
    conversationCreatedAt: '2026-01-05T09:00:00.000Z',
    conversationUpdatedAt: '2026-01-05T09:00:02.000Z',
    lastChatMessage: 'Your parcel left today.',
    custom: { conversation_title: 'Orders' },
  });
  assert.deepEqual(blueStateOf(handle)!.details, ['order_number']);
  await handle.getMetadata();
  assert.equal(fake.requests.length, 2);
});

test('the list: its query and page, each item a handle with its channelMetadata, and core\'s pagination', async () => {
  const mine = await created();
  const secret = secretOf(fake.last);
  const item = (id: string, extra: Record<string, unknown> = {}) => ({
    conversationId: id,
    createdAt: '2026-01-05T09:00:00.000Z',
    updatedAt: '2026-01-06T10:00:00.000Z',
    preview: 'Where is my order?',
    lastMessage: 'It left today.',
    metadata: { conversation_title: 'Orders' },
    ...extra,
  });
  fake.reply(jsonResponse({ total: 120, page: 2, pageSize: 50, items: [item(ID), item('0000000000000000000000c2'), { nope: true }] }));
  const listed = await api.getUserConversations({ userId: 'user-1', pagination: { page: '2', limit: 80 } });
  assert.equal(fake.last!.url, `${BASE}/v1/chat/conversations?page=2&limit=50`);
  assert.equal(fake.last!.method, 'GET');
  assert.equal(secretOf(fake.last), secret);
  assert.deepEqual(listed.pagination, { hasNextPage: true, hasPrevPage: true, page: 2, pageSize: 50, total: 120, totalPages: 3 });
  assert.equal(listed.conversations.length, 2);
  assert.equal(listed.conversations[0], mine);
  const second = listed.conversations[1];
  assert.equal(second.getConversationId(), '0000000000000000000000c2');
  assert.deepEqual((second as any).metadata.channelMetadata, {
    conversationCreatedAt: '2026-01-05T09:00:00.000Z',
    conversationUpdatedAt: '2026-01-06T10:00:00.000Z',
    lastChatMessage: 'It left today.',
    preview: 'Where is my order?',
    custom: { conversation_title: 'Orders' },
  });
  // Engage asks each listed conversation for its metadata: the list's copy answers, with no request.
  const meta = (await second.getMetadata()) as any;
  assert.equal(meta.metadata.event.event_payload.content.channelMetadata.custom.conversation_title, 'Orders');
  assert.equal(fake.requests.length, 2);

  fake.reply(jsonResponse({ total: 0, page: 1, pageSize: 10, items: [] }));
  const page = await api.getUserConversations({ userId: 'user-1', pagination: { limit: '10' } });
  assert.equal(fake.last!.url, `${BASE}/v1/chat/conversations?page=1&limit=10`);
  assert.deepEqual(page.pagination, { hasNextPage: false, hasPrevPage: false, page: 1, pageSize: 10, total: 0, totalPages: 0 });
  fake.reply(jsonResponse({ total: 1, page: 1, pageSize: 50, items: [item(ID)] }));
  await api.getUserConversations('user-1');
  assert.equal(fake.last!.url, `${BASE}/v1/chat/conversations?page=1&limit=50`);
});

test('the list warns once about v2\'s filters and searches, and gives none for a user with no secret here', async () => {
  await created();
  fake.reply(jsonResponse({ total: 0, page: 1, pageSize: 50, items: [] }), jsonResponse({ total: 0, page: 1, pageSize: 50, items: [] }));
  await api.getUserConversations({ userId: 'user-1', filter: { status: 'open' } });
  await api.getUserConversations({ userId: 'user-1', search: { text: 'order' }, apiKeys: ['x'] });
  assert.deepEqual(linesAt('warn').filter((l) => l.includes(CONSOLE_WORDS.listFilters)).length, 1);
  const before = fake.requests.length;
  const none = await api.getUserConversations('someone-else');
  assert.equal(fake.requests.length, before);
  assert.deepEqual(none.conversations, []);
  assert.equal(none.pagination!.total, 0);
});

test('a listed conversation\'s user is kept, so its handle finds it after the app opens again', async () => {
  await created();
  const secret = secretOf(fake.last);
  fake.reply(jsonResponse({ total: 1, page: 1, pageSize: 50, items: [{ conversationId: '0000000000000000000000c9', metadata: {} }] }));
  await api.getUserConversations('user-1');
  const key = (api as any).apiKey;
  api.dispose();
  api = await blueApi(key);
  fake.reply(readBack());
  await api.getConversation('0000000000000000000000c9').getTranscript();
  assert.equal(secretOf(fake.last), secret);
});

test('deleteUserConversations deletes the user\'s own, gives back deleted and busy, and lets their handles go', async () => {
  const conversation = await created();
  const secret = secretOf(fake.last);
  fake.reply(jsonResponse({ deleted: 3, busy: 1 }));
  const done = await api.deleteUserConversations('user-1', { softDelete: true });
  assert.equal(fake.last!.method, 'DELETE');
  assert.equal(fake.last!.url, `${BASE}/v1/chat/conversations`);
  assert.equal(secretOf(fake.last), secret);
  assert.equal(fake.last!.body, undefined);
  assert.deepEqual(done, { deleted: 3, busy: 1 });
  assert.notEqual(api.getConversation(ID), conversation);
  const before = fake.requests.length;
  assert.deepEqual(await api.deleteUserConversations('someone-else'), { deleted: 0, busy: 0 });
  assert.equal(fake.requests.length, before);
});

test('setMetadata merges all but user_id and user_token by PATCH, sends nothing for those and the details alone, and refuses past 4 KB', async () => {
  const conversation = await created({ conversation_title: 'Orders' }, start({ details: ['order_number'] }));
  fake.reply(jsonResponse({ metadata: { conversation_title: 'Refunds', plan: 'gold' } }));
  await conversation.setMetadata({ conversation_title: 'Refunds', plan: 'gold', user_id: 'C-1', user_token: 'token-value' });
  assert.equal(fake.last!.method, 'PATCH');
  assert.equal(fake.last!.url, `${BASE}/v1/chat/${ID}/metadata`);
  assert.deepEqual(fake.last!.json, { metadata: { conversation_title: 'Refunds', plan: 'gold' } });
  const meta = (await conversation.getMetadata()) as any;
  assert.deepEqual(meta.channelMetadata.custom, { conversation_title: 'Refunds', plan: 'gold' });
  assert.equal(blueStateOf(conversation)!.given.user_token, 'token-value');

  const before = fake.requests.length;
  await conversation.setMetadata({ user_id: null });
  await conversation.setMetadata({ user_id: 'C-2', user_token: 'next-token' });
  await conversation.setMetadata({ order_number: 'A-1' });
  assert.equal(fake.requests.length, before);
  assert.equal(blueStateOf(conversation)!.given.order_number, 'A-1');
  // What's kept and what's sent count together.
  await assert.rejects(conversation.setMetadata({ big: 'x'.repeat(4096) }), { message: METADATA_TOO_BIG });
  assert.equal(fake.requests.length, before);
  // A 413 from Blue reads the same.
  fake.reply(jsonResponse({ error: { code: 'too_large', message: 'x' } }, 413));
  const error = (await conversation.setMetadata({ other: 'y' }).catch((e) => e)) as BlueError;
  assert.equal(error.errorDesc, METADATA_TOO_BIG);
  assert.equal(error.status, 413);
});

test('setPrivateMetadata warns once and sends nothing; a time to live is 90 days; editing isn\'t available', async () => {
  const conversation = await created();
  const before = fake.requests.length;
  await conversation.setPrivateMetadata({ crm: 1 });
  await conversation.setPrivateMetadata({ crm: 2 });
  assert.equal(linesAt('warn').filter((l) => l.includes(CONSOLE_WORDS.privateMetadata)).length, 1);
  assert.equal(CONSOLE_WORDS.privateMetadata, "Blue mode doesn't keep private metadata, so it wasn't sent.");
  await conversation.setTimeToLive(90);
  for (const [days, words] of [
    [30, NOT_HERE.shorterTimeToLive],
    [1, NOT_HERE.shorterTimeToLive],
    [365, NOT_HERE.longerTimeToLive],
  ] as const) {
    const error = (await conversation.setTimeToLive(days).catch((e) => e)) as BlueError;
    assert.equal(error.status, 501);
    assert.equal(error.message, words);
  }
  assert.equal(NOT_HERE.shorterTimeToLive, "Files sent in a chat are kept with it for 90 days here. A shorter time isn't available.");
  const edit = (await conversation.editMessage('m1', 'new words').catch((e) => e)) as BlueError;
  assert.equal(edit.status, 501);
  assert.equal(edit.message, "Editing a message isn't available here.");
  assert.equal(fake.requests.length, before);
});

test('createConversation never sends private metadata, and warns once when there is some', async () => {
  await created({}, start(), { crm: 'never sent' });
  assert.ok(!String(fake.last!.body).includes('never sent'));
  assert.equal(linesAt('warn').filter((l) => l.includes(CONSOLE_WORDS.privateMetadata)).length, 1);
  fake.reply(start());
  await api.createConversation('user-1', {}, {}, 'user-first', {});
  assert.equal(linesAt('warn').filter((l) => l.includes(CONSOLE_WORDS.privateMetadata)).length, 1);
});

test('delete() deletes the conversation with its user\'s secret; one still answering reads in the busy words', async () => {
  const conversation = await created();
  const secret = secretOf(fake.last);
  fake.reply(jsonResponse({ deleted: true }));
  await conversation.delete({ softDelete: true });
  assert.equal(fake.last!.method, 'DELETE');
  assert.equal(fake.last!.url, `${BASE}/v1/chat/${ID}`);
  assert.equal(secretOf(fake.last), secret);
  fake.reply(jsonResponse({ error: { code: 'busy', message: 'x' } }, 409));
  const error = (await conversation.delete().catch((e) => e)) as BlueError;
  assert.equal(error.errorDesc, WORDS.busy);
});

test('CaptivateChatManager refuses Blue keys in its words', async () => {
  const words = "Use one CaptivateChatAPI for each app key. CaptivateChatManager is for Captivate's own keys.";
  assert.equal(SETUP_WORDS.managerBlueKey, words);
  assert.throws(() => new CaptivateChatManager([appKey()]), { message: words });
  assert.throws(() => new CaptivateChatManager(['core-key-1', appKey()]), { message: words });
  await assert.rejects(CaptivateChatManager.create([appKey()]), { message: words });
  assert.equal(FakeWebSocket.instances.length, 0);
});

test('no new word says "410" or "gone"', () => {
  for (const word of [...Object.values(NOT_HERE), ...Object.values(SETUP_WORDS), ...Object.values(CONSOLE_WORDS)]) {
    assert.doesNotMatch(word, /410|gone/i, word);
  }
});

test('forgetUser does nothing, and stays synchronous, with a core key', () => {
  const core = new CaptivateChatAPI('core-key-forget', 'prod');
  assert.equal(core.forgetUser('user-1'), undefined);
  core.dispose();
});
