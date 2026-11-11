// The customer, forms and quick replies (first-channels-library-spec §2.7, §2.8; gaps G4, G5,
// G11, G12): who's signed in and the details the bot reads, sent with every send and press and
// kept nowhere; `accepts` only for an app that draws forms; a press and its answer, a look-up's
// rows, its refusals in §1.2's words, link offers, and quick replies.
import { FakeWebSocket, appKey } from './helpers';
import { clearLogs, linesAt } from '../fakes/console';
import { FakeFetch, FakeResponse, RecordedRequest, jsonResponse } from '../fakes/fetch';
import { FakeStorage } from '../fakes/storage';
import { FakeClock } from '../fakes/clock';
import { Call, NDJSON, flush, record, names } from './answers';
import { jsonOf, streamOf } from './fixtures';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CaptivateChatAPI } from '../../src/api/CaptivateChatAPI';
import { Conversation } from '../../src/api/Conversation';
import { BlueError } from '../../src/api/blue/transport';
import { TOKEN_MAX_CHARS } from '../../src/api/blue/identity';
import { rowsText } from '../../src/api/blue/offers';
import { CONSOLE_WORDS, SETUP_WORDS, WORDS } from '../../src/api/blue/words';

const BASE = 'https://vienna-blue-backend.prod.captivat.io';
const ID = '0000000000000000000000c1';
const OFFER = 'of-000000000000000000000025';
const LOOKUP = 'of-000000000000000000000020';

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
  api = await CaptivateChatAPI.create(appKey(), 'prod', { storage, stream: 'fetch' });
  (api as any).blueClock = clock;
});

afterEach(() => {
  api.dispose();
  fake.restore();
});

const line = (event: unknown) => `${JSON.stringify(event)}\n`;
const answer = (text = 'Hi.') =>
  new FakeResponse({ headers: NDJSON, body: [line({ type: 'conversation', conversationId: ID }), line({ type: 'text', text }), line({ type: 'done' })] });
/** A fixture's stream, its conversation's id put back as this test's. */
const fixture = (name: string) => new FakeResponse({ headers: NDJSON, body: streamOf(name).replace(/"conversationId":"[0-9a-f]{24}"/, `"conversationId":"${ID}"`) });
const start = (details: string[] = []) => jsonResponse({ conversationId: ID, greeting: null, details }, 201);
const sends = () => fake.requests.filter((r) => r.method === 'POST' && r.url === `${BASE}/v1/chat`);
const presses = () => fake.requests.filter((r) => r.method === 'POST' && r.url.includes('/offers/'));
const warned = (words: string) => linesAt('warn').filter((l) => l.includes(words)).length;

async function created(metadata: Record<string, unknown> = {}, details: string[] = []): Promise<Conversation> {
  fake.reply(start(details));
  return api.createConversation('user-1', {}, metadata, 'user-first');
}

async function send(conversation: Conversation, reply: FakeResponse = answer(), text = 'Hello'): Promise<RecordedRequest> {
  fake.reply(reply);
  await conversation.sendMessage(text);
  await flush();
  return sends()[sends().length - 1];
}

/** A conversation whose stream has offered `name`'s form, with every listener recorded. */
async function offered(name: 'offer' | 'lookup-offer'): Promise<{ conversation: Conversation; calls: Call[] }> {
  const conversation = await created({ user_id: 'C-1042', user_token: 'token-value' }, ['order_number']);
  const calls = record(conversation);
  await send(conversation, fixture(name));
  calls.length = 0;
  return { conversation, calls };
}

test('user goes with every send and press: the ID and token from the metadata, as the website sends them', async () => {
  const conversation = await created({ user_id: 'C-1042', user_token: 'token-value', plan: 'gold' });
  const first = await send(conversation);
  assert.deepEqual(first.json.user, { id: 'C-1042', token: 'token-value' });
  const second = await send(conversation, answer(), 'Again');
  assert.deepEqual(second.json.user, { id: 'C-1042', token: 'token-value' });
  fake.reply(jsonResponse(jsonOf('offer.press.json')));
  await conversation.sendAction(OFFER, { values: { name: 'Sam Lee' } });
  assert.deepEqual(presses()[0].json.user, { id: 'C-1042', token: 'token-value' });
  // A plain ID, no token: the ID alone.
  const plain = await created({ user_id: 'C-7' });
  assert.deepEqual((await send(plain)).json.user, { id: 'C-7' });
  // None named: no one, never the createConversation's userId.
  const none = await created();
  const body = (await send(none)).json;
  assert.deepEqual(body.user, { id: null });
  assert.ok(!JSON.stringify(body).includes('user-1'));
});

test('setMetadata names the customer anew: user_id null is no one, a new ID drops the old token, other keys leave them', async () => {
  const conversation = await created({ user_id: 'C-1042', user_token: 'token-value' });
  await conversation.setMetadata({ user_id: null });
  // Only user_id: nothing is PATCHed (gaps G10), and the next send names no one.
  assert.equal(fake.requests.filter((r) => r.method === 'PATCH').length, 0);
  assert.deepEqual((await send(conversation)).json.user, { id: null });
  await conversation.setMetadata({ user_id: 'C-2', user_token: 'second' });
  await conversation.setMetadata({ user_id: 'C-3' });
  assert.deepEqual((await send(conversation)).json.user, { id: 'C-3' });
  fake.reply(jsonResponse({ metadata: { plan: 'gold' } }));
  await conversation.setMetadata({ plan: 'gold' });
  assert.deepEqual((await send(conversation)).json.user, { id: 'C-3' });
});

test('an ID outside the form or a token the chat can\'t use is no one, with one warning each in the loader\'s words', async () => {
  const email = await created({ user_id: 'sam@example.com' });
  assert.deepEqual((await send(email)).json.user, { id: null });
  await email.setMetadata({ user_id: 'x'.repeat(65) });
  assert.deepEqual((await send(email)).json.user, { id: null });
  assert.equal(warned(CONSOLE_WORDS.userId), 1);
  assert.equal(CONSOLE_WORDS.userId, "user_id must be letters, digits and - _ . : (at most 64), so the chat goes on without knowing who's signed in.");

  for (const token of ['', 42, null, 't'.repeat(TOKEN_MAX_CHARS + 1)]) {
    await email.setMetadata({ user_id: 'C-1', user_token: token });
    assert.deepEqual((await send(email)).json.user, { id: null }, String(token).slice(0, 10));
  }
  assert.equal(warned(CONSOLE_WORDS.userToken), 1);
  await email.setMetadata({ user_id: 'C-1', user_token: 't'.repeat(TOKEN_MAX_CHARS) });
  assert.deepEqual((await send(email)).json.user, { id: 'C-1', token: 't'.repeat(TOKEN_MAX_CHARS) });
  assert.equal(TOKEN_MAX_CHARS, 2048);
  // The warnings never hold the ID or the token.
  for (const lineText of linesAt('warn')) assert.ok(!lineText.includes('sam@example.com') && !lineText.includes('ttt'), lineText);
});

test('only the details the bot lists go with a message and a press: text and numbers, never an unlisted name, user_id or user_token', async () => {
  const metadata = {
    user_id: 'C-1042',
    user_token: 'token-value',
    order_number: 'A-1001',
    seats: 12,
    email: 'sam@example.com',
    nested: { order_number: 'no' },
    flag: true,
    infinite: Infinity,
  };
  const conversation = await created(metadata, ['order_number', 'seats', 'flag', 'infinite', 'missing', 'user_id', 'user_token']);
  const body = (await send(conversation)).json;
  assert.deepEqual(body.details, { order_number: 'A-1001', seats: '12' });
  assert.ok(!JSON.stringify(body).includes('sam@example.com'));
  fake.reply(jsonResponse(jsonOf('offer.press.json')));
  await conversation.sendAction(OFFER, { values: {} });
  assert.deepEqual(presses()[0].json.details, { order_number: 'A-1001', seats: '12' });
  // setMetadata's values are read at the next send; one the bot doesn't list stays out of it.
  fake.reply(jsonResponse({ metadata: {} }));
  await conversation.setMetadata({ order_number: 'B-2', other: 'kept' });
  assert.deepEqual((await send(conversation)).json.details, { order_number: 'B-2', seats: '12' });
  // A bot that reads no details gets none: no `details` at all.
  const plain = await created({ order_number: 'A-1' });
  assert.ok(!('details' in (await send(plain)).json));
});

test('a detail over 200 characters is dropped, with one warning that names no value', async () => {
  const conversation = await created({ order_number: 'x'.repeat(201), seats: 'y'.repeat(200) }, ['order_number', 'seats']);
  assert.deepEqual((await send(conversation)).json.details, { seats: 'y'.repeat(200) });
  await send(conversation);
  assert.equal(warned(CONSOLE_WORDS.detailTooLong), 1);
  assert.ok(!linesAt('warn').some((l) => l.includes('xxx')));
});

test('user_id and user_token never reach the start\'s metadata, a PATCH or the device\'s storage', async () => {
  const conversation = await created({ user_id: 'C-1042', user_token: 'token-value', plan: 'gold' });
  fake.reply(jsonResponse({ metadata: { plan: 'silver' } }));
  await conversation.setMetadata({ user_id: 'C-2048', user_token: 'second-token', plan: 'silver' });
  const started = fake.requests.find((r) => r.url === `${BASE}/v1/chat/conversations`)!;
  const patch = fake.requests.find((r) => r.method === 'PATCH')!;
  assert.deepEqual(started.json.metadata, { plan: 'gold' });
  assert.deepEqual(patch.json, { metadata: { plan: 'silver' } });
  await send(conversation);
  const stored = JSON.stringify([storage.entries(), storage.writes]);
  for (const word of ['C-1042', 'C-2048', 'token-value', 'second-token']) {
    assert.ok(!stored.includes(word), word);
    assert.ok(!JSON.stringify(started.json).includes(word) && !JSON.stringify(patch.json).includes(word), word);
  }
});

test('accepts goes with a send only while an onActionReceived listener is registered', async () => {
  const conversation = await created();
  assert.ok(!('accepts' in (await send(conversation)).json));
  const listener = () => undefined;
  conversation.onActionReceived(listener);
  assert.deepEqual((await send(conversation)).json.accepts, ['offers']);
  conversation.off('action', listener);
  assert.ok(!('accepts' in (await send(conversation)).json));
});

test('an offer goes to onActionReceived as it came; a press sends choice, values, user and details, and its answer comes once', async () => {
  const { conversation, calls } = await offered('offer');
  fake.reply(jsonResponse(jsonOf('offer.press.json')));
  await conversation.sendAction(OFFER, { values: { name: 'Sam Lee', email: 'sam@example.com' } });
  const press = presses()[0];
  assert.equal(press.url, `${BASE}/v1/chat/${ID}/offers/${OFFER}`);
  assert.equal(press.headers['content-type'], 'application/json');
  assert.match(press.headers['x-blue-conversation'], /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(press.json, {
    choice: 'send',
    values: { name: 'Sam Lee', email: 'sam@example.com' },
    user: { id: 'C-1042', token: 'token-value' },
  });
  const text = "Thanks, Sam Lee! I've passed this on to the team.";
  assert.deepEqual(names(calls), ['onMessage', 'onAnswer']);
  assert.deepEqual(calls[0].args, [[{ type: 'text', text }], 'ai_agent']);
  const pressed = jsonOf('offer.press.json');
  assert.deepEqual(calls[1].args, [{ text, sources: [], offer: pressed }]);
  // Cancelling: the choice as given, no values, and an answer with no words gives onAnswer alone.
  fake.reply(jsonResponse({ offer: { id: OFFER, status: 'cancelled' } }));
  await conversation.sendAction(OFFER, { choice: 'cancel' });
  assert.deepEqual(presses()[1].json, { choice: 'cancel', values: {}, user: { id: 'C-1042', token: 'token-value' } });
  assert.deepEqual(names(calls), ['onMessage', 'onAnswer', 'onAnswer']);
  assert.deepEqual(calls[2].args, [{ text: '', sources: [], offer: { offer: { id: OFFER, status: 'cancelled' }, messages: [] } }]);
});

test('a look-up\'s rows and the bot\'s words go to onMessage as one message; a miss gives its own words as the text', async () => {
  const { conversation, calls } = await offered('lookup-offer');
  fake.reply(jsonResponse(jsonOf('lookup-offer.press.json')));
  await conversation.sendAction(LOOKUP, { values: { number: 'A-1001' } });
  const text = "Status: Shipped\nDelivery date: 5 Nov\n\nHere's what I found. Ask me if you have a question about it.";
  assert.deepEqual(names(calls), ['onMessage', 'onAnswer']);
  assert.deepEqual(calls[0].args, [[{ type: 'text', text }], 'ai_agent']);
  assert.deepEqual(calls[1].args, [{ text, sources: [], offer: jsonOf('lookup-offer.press.json') }]);

  // Several records, more than shown: numbered lines, and the line that names the form's first field.
  const rows = [
    [{ label: 'Status', value: 'Shipped' }, { label: 'Total', value: '£12' }],
    [{ label: 'Status', value: 'Packed *today*' }, { label: 'Total', value: 'www.example.com' }],
  ];
  fake.reply(jsonResponse({ offer: { id: LOOKUP, status: 'sent' }, lookup: { state: 'found', rows, more: 5 }, messages: [] }));
  await conversation.sendAction(LOOKUP, { values: { number: 'A' } });
  const several =
    '1. Status: Shipped · Total: £12\n2. Status: Packed \\*today\\* · Total: www⁠.example.com\n\nShowing 2 of 5. To check one, give its Order number.';
  assert.deepEqual(calls[2].args, [[{ type: 'text', text: several }], 'ai_agent']);
  assert.equal(rowsText(rows, 5, 'Order number'), several);
  // No more than shown, or no label: no line about the rest.
  assert.equal(rowsText(rows.slice(0, 1), 1, 'Order number'), 'Status: Shipped\nTotal: £12');

  // Nothing found: the backend's words for the customer are the press's text, never an error.
  const missed = "I couldn't find that. Check the details and press Check again. Please contact the business directly.";
  fake.reply(jsonResponse({ offer: { id: LOOKUP, status: 'open' }, lookup: { state: 'not_found', message: missed }, messages: [] }));
  await conversation.sendAction(LOOKUP, { values: { number: 'B' } });
  assert.deepEqual(calls[4].args, [[{ type: 'text', text: missed }], 'ai_agent']);
  assert.equal((calls[5].args[0] as any).text, missed);
  assert.ok(!names(calls).includes('onError'));
});

test('a refused press reads by its code: needs_sign_in, another 409, a form\'s fields and a 429, each to onError and the rejection', async () => {
  const { conversation, calls } = await offered('lookup-offer');
  const refused = async (reply: FakeResponse) => {
    fake.reply(reply);
    return (await conversation.sendAction(LOOKUP, { values: { number: 'A' } }).catch((e) => e)) as BlueError;
  };
  const signIn = await refused(jsonResponse({ error: { code: 'needs_sign_in', message: 'Please sign in on this website again, then press Check.' } }, 409));
  assert.equal(signIn.errorDesc, WORDS.signInAgain);
  assert.equal(signIn.status, 409);
  assert.equal(WORDS.signInAgain, 'Sign in again in the app, then try once more.');
  const closed = await refused(jsonResponse({ error: { code: 'offer_closed', message: 'x' } }, 409));
  assert.equal(closed.errorDesc, WORDS.notAnyMore);
  const off = await refused(jsonResponse({ error: { code: 'switched_off', message: 'x' } }, 409));
  assert.equal(off.errorDesc, "This can't be done any more. Ask again in the chat.");
  const fields = await refused(jsonResponse({ error: { code: 'invalid', message: 'x', fields: { number: 'Use only letters…' } } }, 400));
  assert.equal(fields.errorDesc, WORDS.formRefused);
  assert.deepEqual(fields.fields, ['number']);
  const often = await refused(jsonResponse({ error: { code: 'rate_limited', message: 'x' } }, 429, { 'retry-after': '120' }));
  assert.equal(often.errorDesc, WORDS.sentTooOften);
  assert.equal(often.retryAfter, 120);
  const errors = calls.filter((c) => c.listener === 'onError').map((c) => c.args[0]);
  assert.deepEqual(errors, [
    { conversationId: ID, errorCode: 409, errorDesc: WORDS.signInAgain },
    { conversationId: ID, errorCode: 409, errorDesc: WORDS.notAnyMore },
    { conversationId: ID, errorCode: 409, errorDesc: WORDS.notAnyMore },
    { conversationId: ID, errorCode: 400, errorDesc: WORDS.formRefused },
    { conversationId: ID, errorCode: 429, errorDesc: WORDS.sentTooOften, retryAfter: 120 },
  ]);
  // The backend's own words never pass through.
  assert.ok(!JSON.stringify(calls).includes('Please sign in on this website'));
  assert.ok(!names(calls).includes('onMessage'));
});

test('values go as text: numbers as digits, true and false as yes and no; anything else is refused before sending', async () => {
  const { conversation } = await offered('offer');
  fake.reply(jsonResponse(jsonOf('offer.press.json')));
  await conversation.sendAction(OFFER, { values: { name: 'Sam', seats: 3, agree: true, newsletter: false } });
  assert.deepEqual(presses()[0].json.values, { name: 'Sam', seats: '3', agree: 'yes', newsletter: 'no' });
  const refused = (await conversation.sendAction(OFFER, { values: { name: { first: 'Sam' }, seats: NaN } }).catch((e) => e)) as BlueError;
  assert.equal(refused.errorDesc, WORDS.formRefused);
  assert.deepEqual(refused.fields, ['name', 'seats']);
  assert.equal(presses().length, 1);
});

test('a link offer comes to onActionReceived like a form; pressing send on it is refused before sending, cancel goes', async () => {
  const conversation = await created();
  const actions: unknown[] = [];
  conversation.onActionReceived((a) => actions.push(a));
  const link = {
    id: 'of-0000000000000000000000aa',
    actionId: 'act_book',
    version: 1,
    kind: 'link',
    title: 'Book a call',
    fields: [],
    link: { url: 'https://cal.example.com/acme', params: [] },
    sendLabel: 'Open',
    status: 'open',
    expiresAt: '2026-01-05T09:00:32.000Z',
  };
  await send(
    conversation,
    new FakeResponse({
      headers: NDJSON,
      body: [line({ type: 'conversation', conversationId: ID }), line({ type: 'text', text: 'Book here.' }), line({ type: 'offer', offer: link }), line({ type: 'done' })],
    })
  );
  assert.deepEqual(actions, [[{ id: link.id, data: link }]]);
  await assert.rejects(conversation.sendAction(link.id, {}), { message: SETUP_WORDS.linkOffer });
  assert.equal(presses().length, 0);
  fake.reply(jsonResponse({ offer: { id: link.id, status: 'cancelled' } }));
  await conversation.sendAction(link.id, { choice: 'cancel' });
  assert.equal(presses().length, 1);
});

test('an offer read back is known to a press: a link from the transcript is refused before sending too', async () => {
  const conversation = await created();
  const link = { id: 'of-0000000000000000000000ab', kind: 'link', title: 'Book', fields: [], link: { url: 'https://cal.example.com', params: [] }, sendLabel: 'Open', status: 'open' };
  fake.reply(
    jsonResponse({ _id: ID, messages: [{ _id: 'm1', role: 'assistant', content: 'Book here.', sources: [], at: '2026-01-05T09:00:00.000Z', offer: link }], answering: false, metadata: {}, details: [] })
  );
  await conversation.getTranscript();
  await assert.rejects(conversation.sendAction(link.id, {}), { message: SETUP_WORDS.linkOffer });
  assert.equal(presses().length, 0);
});

test('sendAction with an id that isn\'t an offer\'s warns once and sends nothing', async () => {
  const conversation = await created();
  await conversation.sendAction('action-1', { choice: 'send' });
  await conversation.sendAction('of-short', {});
  assert.equal(presses().length, 0);
  assert.equal(fake.requests.length, 1);
  assert.equal(warned(CONSOLE_WORDS.notAnOffer), 1);
  assert.equal(CONSOLE_WORDS.notAnOffer, "That action isn't one of the bot's forms, so nothing was sent.");
});

test('quick replies come as onAnswer\'s choices, and a press of one is its text sent as a message', async () => {
  const conversation = await created();
  const calls = record(conversation, ['onMessage', 'onAnswer']);
  await send(conversation, fixture('interview-choices'));
  assert.deepEqual(names(calls), ['onMessage', 'onAnswer']);
  assert.deepEqual((calls[1].args[0] as any).choices, ['Yes, send it', 'No, cancel']);
  const reply = await send(conversation, answer('Sent.'), 'Yes, send it');
  assert.equal(reply.json.message, 'Yes, send it');
});
