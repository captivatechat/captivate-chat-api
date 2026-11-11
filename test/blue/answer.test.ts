// An answer (first-channels-library-spec §2.4, §2.5; gaps G2, G3): what an app's listeners get
// for each fixture, drafts, the one final answer, cuts read back by clientId, Stop, a 409's hold
// and resume(), on fakes and a hand-driven clock alone.
import { FakeWebSocket, appKey } from './helpers';
import { clearLogs, linesAt } from '../fakes/console';
import { FakeFetch, FakeResponse, jsonResponse } from '../fakes/fetch';
import { FakeXMLHttpRequest, installFakeXhr } from '../fakes/xhr';
import { FakeClock } from '../fakes/clock';
import { FIXTURES, jsonOf, streamNames, streamOf } from './fixtures';
import { Call, NDJSON, blueConversation, flush, handBody, lineChunks, names, record, tick } from './answers';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CaptivateChatAPI } from '../../src/api/CaptivateChatAPI';
import { Conversation } from '../../src/api/Conversation';
import { BlueTransport } from '../../src/api/blue/transport';
import { FOLLOW_MS, FOLLOW_WAITS } from '../../src/api/blue/answer';
import { IDLE_MS } from '../../src/api/blue/stream';
import { CONSOLE_WORDS, METADATA_TOO_BIG, SETUP_WORDS, WORDS } from '../../src/api/blue/words';

let fake: FakeFetch;
let api: CaptivateChatAPI;
let transport: BlueTransport;
let clock: FakeClock;
let uninstallXhr: () => void;

beforeEach(() => {
  FakeWebSocket.reset();
  FakeXMLHttpRequest.reset();
  clearLogs();
  fake = new FakeFetch().install();
  uninstallXhr = installFakeXhr();
  api = new CaptivateChatAPI(appKey(), 'prod', { blueUrl: 'https://blue.example' });
  transport = (api as any).blue;
  clock = new FakeClock();
});

afterEach(() => {
  api.dispose();
  uninstallXhr();
  fake.restore();
});

const ID = '0000000000000000000000c1';
const line = (event: unknown) => `${JSON.stringify(event)}\n`;
const CONVERSATION = line({ type: 'conversation', conversationId: ID });
const STEP = line({ type: 'step', label: 'Looking into it' });
const DONE = line({ type: 'done' });
const SOURCE = { number: 1, title: 'Delivery notes', excerpt: 'Refunds for late parcels are paid on request.' };

/** A read-back of the conversation. */
const readBack = (messages: object[], answering = false) => jsonResponse({ _id: ID, messages, answering, metadata: {}, details: [] });
const userMessage = (clientId: string, content = 'How long do refunds take?') => ({ role: 'user', content, sources: [], clientId });
const assistant = (content: string, extra: object = {}) => ({ role: 'assistant', content, sources: [], stopped: false, ...extra });

/** The clientId the n-th POST /v1/chat sent. */
const sentClientId = (n = 0) => fake.requests.filter((r) => r.method === 'POST' && r.url.endsWith('/v1/chat'))[n].json.clientId as string;

/** A fixture's read-back, with its message's clientId put back as the one the library sent. */
function fixtureReadBack(file: string, clientId: string): FakeResponse {
  const back = jsonOf(file);
  for (const m of back.messages) if (m.clientId) m.clientId = clientId;
  return jsonResponse(back);
}

const conversation = (id = ID) => blueConversation(api, clock, id);

/** The calls of one name. */
const of = (calls: Call[], listener: string) => calls.filter((c) => c.listener === listener);

// What an app sees for each fixture that ends (the two that are cut are read back below).
const ENDING = streamNames().filter((name) => name !== 'case-cut-after-text' && name !== 'case-not-json');

async function callsOf(name: string, way: 'fetch' | 'xhr' | 'whole'): Promise<Call[]> {
  const text = streamOf(name);
  const id = JSON.parse(text.split('\n').find((l) => l.trim())!).conversationId;
  transport.configure({ stream: way });
  const c = conversation(id);
  const calls = record(c);
  if (way === 'xhr') {
    const sent = c.sendMessage('Hello');
    await flush();
    const xhr = FakeXMLHttpRequest.last!;
    xhr.respond(200, NDJSON);
    for (const piece of lineChunks(text)) xhr.push(piece);
    xhr.finish();
    await sent;
  } else {
    fake.reply(new FakeResponse({ headers: NDJSON, body: way === 'fetch' ? lineChunks(text) : text }));
    await c.sendMessage('Hello');
  }
  await flush();
  assert.equal(clock.pending, 0, `${name}: nothing is left waiting`);
  return calls;
}

test('each fixture gives its callbacks file, read one line a chunk, the same by XHR, and reading whole the same without drafts', async () => {
  for (const name of ENDING) {
    const calls = await callsOf(name, 'fetch');
    const file = join(FIXTURES, `${name}.callbacks.json`);
    if (process.env.WRITE_CALLBACKS === '1') {
      const about = `What an app's listeners get for ${name}.ndjson, all seven registered, read one line a network chunk. Reading whole gives the same without onDelta.`;
      writeFileSync(file, `${JSON.stringify({ about, calls }, null, 2)}\n`);
    }
    assert.ok(existsSync(file), `${name}.callbacks.json is beside it`);
    assert.deepEqual(calls, JSON.parse(readFileSync(file, 'utf8')).calls, name);
    assert.deepEqual(await callsOf(name, 'xhr'), calls, `${name} by XHR`);
    assert.deepEqual(
      await callsOf(name, 'whole'),
      calls.filter((c) => c.listener !== 'onDelta'),
      `${name} read whole`
    );
  }
});

test('a draft [3] that is [1] in the final: drafts never show a marker, the final keeps the backend numbers', async () => {
  const calls = await callsOf('answer-cited', 'fetch');
  assert.deepEqual(of(calls, 'onDelta').map((c) => c.args), [['Refunds are paid within 14 days of a request.', { reset: false }]]);
  assert.deepEqual(of(calls, 'onMessage')[0].args, [[{ type: 'text', text: 'Refunds are paid within 14 days of a request [1].' }], 'ai_agent']);
  const answer = of(calls, 'onAnswer')[0].args[0] as any;
  assert.equal(answer.text, 'Refunds are paid within 14 days of a request [1].');
  assert.deepEqual(answer.sources.map((s: any) => s.number), [1]);
});

test('onDelta: once per network chunk with the draft after its last line; a reset first', async () => {
  const c = conversation();
  const calls = record(c, ['onDelta', 'onMessage']);
  fake.reply(
    new FakeResponse({
      headers: NDJSON,
      body: [
        CONVERSATION + STEP + line({ type: 'delta', text: 'Parcels' }),
        line({ type: 'delta', text: ' leave' }) + line({ type: 'delta', text: ' at 4pm [1' }),
        line({ type: 'delta', text: '].' }) + line({ type: 'reset' }) + line({ type: 'delta', text: 'They leave' }),
        line({ type: 'reset' }),
        line({ type: 'text', text: 'They leave at 4pm.' }) + DONE,
      ],
    })
  );
  await c.sendMessage('When do parcels leave?');
  await flush();
  assert.deepEqual(
    of(calls, 'onDelta').map((d) => d.args),
    [
      ['Parcels', { reset: false }],
      ['Parcels leave at 4pm', { reset: false }],
      ['', { reset: true }],
      ['They leave', { reset: false }],
      ['', { reset: true }],
    ]
  );
  assert.equal(of(calls, 'onMessage').length, 1);
});

test('onMessage: once, as core array; the footer only without onAnswer, an untitled source an internal document; none for an empty text', async () => {
  // Without onAnswer: the footer after a blank line (gaps G15).
  let c = conversation('0000000000000000000000a4');
  let calls = record(c, ['onMessage']);
  fake.reply(new FakeResponse({ headers: NDJSON, body: lineChunks(streamOf('case-draft-space')) }));
  await c.sendMessage('How much?');
  await flush();
  assert.deepEqual(calls.map((x) => x.args), [
    [
      [
        {
          type: 'text',
          text: '£12 a seat [1, 2]. Ask about 漢字 or 🎉 groups [1].\n\nSources:\n- [1] Prices\n- [2] Internal document',
        },
      ],
      'ai_agent',
    ],
  ]);

  // With onAnswer, registered after onMessage: no footer, the sources in onAnswer.
  c = conversation('0000000000000000000000a4');
  calls = record(c, ['onMessage', 'onAnswer']);
  fake.reply(new FakeResponse({ headers: NDJSON, body: streamOf('case-draft-space') }));
  await c.sendMessage('How much?');
  await flush();
  assert.equal((of(calls, 'onMessage')[0].args[0] as any)[0].text, '£12 a seat [1, 2]. Ask about 漢字 or 🎉 groups [1].');
  assert.equal((of(calls, 'onAnswer')[0].args[0] as any).sources.length, 2);

  // An empty text (an interview's send can end with one): no onMessage, onAnswer once.
  c = conversation();
  calls = record(c, ['onMessage', 'onAnswer']);
  fake.reply(new FakeResponse({ headers: NDJSON, body: CONVERSATION + line({ type: 'text', text: '' }) + DONE }));
  await c.sendMessage('Sam Lee');
  await flush();
  assert.deepEqual(names(calls), ['onAnswer']);
  assert.deepEqual(calls[0].args, [{ text: '', sources: [] }]);
});

test('the send: the message, the conversation and a clientId of 22 base64url characters, a new one each send', async () => {
  const c = conversation();
  fake.reply(
    new FakeResponse({ headers: NDJSON, body: CONVERSATION + line({ type: 'text', text: 'Hi.' }) + DONE }),
    new FakeResponse({ headers: NDJSON, body: CONVERSATION + line({ type: 'text', text: 'Hi.' }) + DONE })
  );
  await c.sendMessage('Hello');
  await c.sendMessage({ type: 'text', text: 'Hello again' });
  await flush();
  const [first, second] = fake.requests;
  assert.equal(first.url, 'https://blue.example/v1/chat');
  // With no onActionReceived and no user named: the customer as no one, no accepts and no details (L5).
  assert.deepEqual(Object.keys(first.json).sort(), ['clientId', 'conversationId', 'message', 'user']);
  assert.deepEqual(first.json.user, { id: null });
  assert.equal(first.json.conversationId, ID);
  assert.equal(first.json.message, 'Hello');
  assert.equal(second.json.message, 'Hello again');
  assert.match(first.json.clientId, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(first.json.clientId, second.json.clientId);
});

test('a cut read back while answering, then delivered once', async () => {
  const hand = handBody();
  fake.reply(hand.response as any);
  const c = conversation();
  const calls = record(c);
  const sent = c.sendMessage('How long do refunds take?');
  await flush();
  hand.push(CONVERSATION + STEP + line({ type: 'delta', text: 'Refunds are paid [1' }));
  await sent;
  await flush();
  hand.fail();
  await flush();
  const clientId = sentClientId();

  fake.reply(readBack([userMessage(clientId)], true));
  await tick(clock, FOLLOW_WAITS[0]);
  assert.deepEqual(calls.slice(-2), [
    { listener: 'onDelta', args: ['', { reset: true }] },
    { listener: 'onConversationUpdate', args: [{ type: 'answering', conversationId: ID }] },
  ]);
  fake.reply(readBack([userMessage(clientId)], true));
  await tick(clock, FOLLOW_WAITS[1]);
  fake.reply(readBack([userMessage(clientId), assistant('Refunds are paid within 14 days [1].', { sources: [SOURCE] })]));
  await tick(clock, FOLLOW_WAITS[2]);

  assert.deepEqual(names(calls), ['onStep', 'onDelta', 'onDelta', 'onConversationUpdate', 'onMessage', 'onAnswer']);
  assert.deepEqual(of(calls, 'onAnswer')[0].args, [{ text: 'Refunds are paid within 14 days [1].', sources: [SOURCE] }]);
  await tick(clock, 60_000);
  assert.equal(fake.requests.length, 4, 'nothing is read back after the answer');
  assert.equal(clock.pending, 0);
  assert.equal(fake.requests[1].method, 'GET');
  assert.equal(fake.requests[1].url, `https://blue.example/v1/chat/${ID}`);
  assert.equal(fake.requests[1].headers['x-blue-conversation'], 's'.repeat(43));
});

test('a cut after text gives onAnswer alone, from the read-back', async () => {
  const c = conversation('0000000000000000000000a2');
  const calls = record(c);
  fake.reply(new FakeResponse({ headers: NDJSON, body: lineChunks(streamOf('case-cut-after-text')) }));
  await c.sendMessage('How long do refunds take?');
  await flush();
  assert.deepEqual(names(calls), ['onStep', 'onDelta', 'onMessage']);
  fake.reply(fixtureReadBack('answer-cited.read-back.json', sentClientId()));
  await tick(clock, FOLLOW_WAITS[0]);
  assert.deepEqual(names(calls), ['onStep', 'onDelta', 'onMessage', 'onAnswer']);
  assert.equal((of(calls, 'onAnswer')[0].args[0] as any).text, 'Refunds are paid within 14 days of a request [1].');
});

test('late chunks after a timeout cut are dropped; the answer comes by the read-back once', async () => {
  const hand = handBody();
  fake.reply(hand.response as any);
  const c = conversation();
  const calls = record(c);
  const sent = c.sendMessage('How long do refunds take?');
  await flush();
  hand.push(CONVERSATION);
  await sent;
  await flush();
  await tick(clock, IDLE_MS);
  try {
    hand.push(line({ type: 'text', text: 'Late words.' }) + DONE);
  } catch (_) {
    // The body was cancelled at the cut.
  }
  await flush();
  assert.deepEqual(names(calls), []);
  fake.reply(readBack([userMessage(sentClientId()), assistant('Refunds take 14 days.')]));
  await tick(clock, FOLLOW_WAITS[0]);
  assert.deepEqual(of(calls, 'onMessage').map((m) => (m.args[0] as any)[0].text), ['Refunds take 14 days.']);
  assert.equal(of(calls, 'onAnswer').length, 1);
});

test('a cut before the message was stored: "didn\'t go through" only on the second read-back, 5 s after the first', async () => {
  fake.reply(new TypeError('fetch failed'));
  const c = conversation();
  const calls = record(c);
  await c.sendMessage('Hello');
  await flush();
  fake.reply(readBack([]));
  await tick(clock, FOLLOW_WAITS[0]);
  assert.deepEqual(names(calls), []);
  fake.reply(readBack([]));
  await tick(clock, FOLLOW_WAITS[1]);
  assert.deepEqual(calls, [
    { listener: 'onMessage', args: [`[Error: ${WORDS.didntGoThrough}]`, 'error'] },
    { listener: 'onError', args: [{ conversationId: ID, errorDesc: WORDS.didntGoThrough }] },
  ]);
  await tick(clock, 60_000);
  assert.equal(fake.requests.length, 3);
});

test('two identical "yes" are each matched to their own answer by clientId', async () => {
  fake.reply(new TypeError('fetch failed'), new TypeError('fetch failed'));
  const c = conversation();
  const calls = record(c, ['onMessage', 'onAnswer']);
  await c.sendMessage('yes');
  await c.sendMessage('yes');
  await flush();
  const [one, two] = [sentClientId(0), sentClientId(1)];
  assert.notEqual(one, two);
  const back = () => readBack([userMessage(one, 'yes'), assistant('First answer.'), userMessage(two, 'yes'), assistant('Second answer.')]);
  fake.reply(back(), back());
  await tick(clock, FOLLOW_WAITS[0]);
  assert.deepEqual(of(calls, 'onAnswer').map((a) => (a.args[0] as any).text), ['First answer.', 'Second answer.']);
  assert.equal(of(calls, 'onMessage').length, 2);
});

test('a stopped answer and an offer in the read-back', async () => {
  // Stopped: no onMessage, "Stopped." in onAnswer.
  fake.reply(new TypeError('fetch failed'));
  let c = conversation('000000000000000000000037');
  let calls = record(c);
  await c.sendMessage('What is new?');
  await flush();
  fake.reply(fixtureReadBack('stopped.read-back.json', sentClientId()));
  await tick(clock, FOLLOW_WAITS[0]);
  assert.deepEqual(calls, [
    { listener: 'onConversationUpdate', args: [{ type: 'stopped', conversationId: '000000000000000000000037' }] },
    { listener: 'onAnswer', args: [{ text: 'Stopped.', sources: [], stopped: true }] },
  ]);

  // An offer: the answer, the form to onActionReceived, and onAnswer with it; nothing of what came after.
  fake.reply(new TypeError('fetch failed'));
  c = conversation('000000000000000000000024');
  calls = record(c);
  await c.sendMessage('Can I get a quote?');
  await flush();
  fake.reply(fixtureReadBack('offer.read-back.json', sentClientId(1)));
  await tick(clock, FOLLOW_WAITS[0]);
  assert.deepEqual(names(calls), ['onMessage', 'onActionReceived', 'onAnswer']);
  const offer = jsonOf('offer.read-back.json').messages[1].offer;
  assert.deepEqual(of(calls, 'onActionReceived')[0].args, [[{ id: offer.id, data: offer }]]);
  assert.deepEqual(of(calls, 'onAnswer')[0].args, [{ text: 'Sure, the team can send you a quote.', sources: [], offer }]);
});

test('a read-back finding the message but no answer: the assistant couldn\'t answer', async () => {
  fake.reply(new TypeError('fetch failed'));
  const c = conversation('000000000000000000000007');
  const calls = record(c, ['onMessage', 'onError', 'onConversationUpdate']);
  await c.sendMessage('When do they arrive?');
  await flush();
  fake.reply(fixtureReadBack('error.read-back.json', sentClientId()));
  await tick(clock, FOLLOW_WAITS[0]);
  assert.deepEqual(names(calls), ['onMessage', 'onError', 'onConversationUpdate']);
  assert.deepEqual(calls[0].args, [`[Error: ${WORDS.couldntAnswer}]`, 'error']);
  assert.deepEqual(calls[2].args, [{ type: 'unavailable', conversationId: '000000000000000000000007' }]);
});

test('a follow (gaps G3): a 429 waits its Retry-After, a 5xx and no network keep the waits, a 404 ends it in its words', async () => {
  fake.reply(new TypeError('fetch failed'));
  const c = conversation();
  const calls = record(c, ['onMessage', 'onError']);
  await c.sendMessage('Hello');
  await flush();
  fake.reply(jsonResponse({ error: { code: 'rate_limited' } }, 429, { 'retry-after': '40' }));
  await tick(clock, FOLLOW_WAITS[0]);
  await tick(clock, 39_000);
  assert.equal(fake.requests.length, 2, 'no read-back before the Retry-After');
  fake.reply(jsonResponse({}, 503));
  await tick(clock, 1_000);
  assert.equal(fake.requests.length, 3);
  fake.reply(new TypeError('fetch failed'));
  await tick(clock, FOLLOW_WAITS[2]);
  assert.equal(fake.requests.length, 4);
  fake.reply(jsonResponse({ error: { code: 'not_found', message: 'The conversation is gone (410).' } }, 404));
  await tick(clock, FOLLOW_WAITS[3]);
  assert.deepEqual(calls, [
    { listener: 'onMessage', args: [`[Error: ${WORDS.conversationGone}]`, 'error'] },
    { listener: 'onError', args: [{ conversationId: ID, errorCode: 404, errorDesc: WORDS.conversationGone }] },
  ]);
  await tick(clock, 60_000);
  assert.equal(fake.requests.length, 5);
});

test('a follow stops after 10 minutes, in the couldn\'t answer words', async () => {
  fake.reply(new TypeError('fetch failed'));
  const c = conversation();
  const calls = record(c, ['onMessage', 'onConversationUpdate']);
  await c.sendMessage('Hello');
  await flush();
  for (let i = 0; i < 60; i++) fake.reply(readBack([userMessage(sentClientId())], true));
  for (let t = 0; t < FOLLOW_MS; t += 1_000) await tick(clock, 1_000);
  assert.deepEqual(names(calls), ['onConversationUpdate', 'onMessage', 'onConversationUpdate']);
  assert.deepEqual(calls[1].args, [`[Error: ${WORDS.couldntAnswer}]`, 'error']);
  const reads = fake.requests.length - 1;
  await tick(clock, 60_000);
  assert.equal(fake.requests.length - 1, reads);
  // 3, 5, 8, 12 and 15 s, then every 15 s, and one at the 10 minutes.
  assert.equal(reads, 43);
});

test('refusals reject sendMessage and reach onError: 429 with its Retry-After, 404 in its words', async () => {
  const c = conversation();
  const calls = record(c, ['onMessage', 'onError']);
  fake.reply(jsonResponse({ error: { code: 'rate_limited' } }, 429, { 'retry-after': '30' }));
  await assert.rejects(c.sendMessage('Hello'), (error: any) => {
    assert.equal(error.status, 429);
    assert.equal(error.retryAfter, 30);
    assert.equal(error.errorDesc, WORDS.tooMany);
    return true;
  });
  fake.reply(jsonResponse({ error: { code: 'not_found' } }, 404));
  await assert.rejects(c.sendMessage('Hello'), (error: any) => error.errorDesc === WORDS.conversationGone);
  assert.deepEqual(calls, [
    { listener: 'onError', args: [{ conversationId: ID, errorCode: 429, errorDesc: WORDS.tooMany, retryAfter: 30 }] },
    { listener: 'onError', args: [{ conversationId: ID, errorCode: 404, errorDesc: WORDS.conversationGone }] },
  ]);
});

test('stop() answering false before the first event is sent again at it; after it, the stream is read on', async () => {
  const hand = handBody();
  fake.reply(hand.response as any, jsonResponse({ stopped: false }), jsonResponse({ stopped: true }));
  const c = conversation();
  const calls = record(c, ['onMessage', 'onAnswer', 'onConversationUpdate']);
  const sent = c.sendMessage('Hello');
  await flush();
  assert.deepEqual(await c.stop(), { stopped: false });
  assert.equal(fake.requests[1].url, `https://blue.example/v1/chat/${ID}/stop`);
  assert.equal(fake.requests[1].method, 'POST');
  hand.push(CONVERSATION);
  await sent;
  await flush();
  assert.equal(fake.requests.length, 3, 'Stop sent once more at the first event');
  assert.equal(fake.requests[2].url, `https://blue.example/v1/chat/${ID}/stop`);
  hand.push(line({ type: 'stopped' }) + DONE);
  hand.close();
  await flush();
  assert.deepEqual(names(calls), ['onConversationUpdate', 'onAnswer']);
  assert.deepEqual(calls[1].args, [{ text: 'Stopped.', sources: [], stopped: true }]);

  // After the first event: false means keep reading.
  const later = handBody();
  fake.reply(later.response as any, jsonResponse({ stopped: false }));
  const more = record(c, ['onMessage']);
  const next = c.sendMessage('Hello again');
  await flush();
  later.push(CONVERSATION);
  await next;
  await flush();
  assert.deepEqual(await c.stop(), { stopped: false });
  later.push(line({ type: 'text', text: 'Hi.' }) + DONE);
  later.close();
  await flush();
  assert.equal(fake.requests.length, 5);
  assert.equal(more.length, 1);
});

test('stop() whose own call fails aborts the request here, and the answer is stopped for the app', async () => {
  const hand = handBody();
  fake.reply(hand.response as any, new TypeError('fetch failed'));
  const c = conversation();
  const calls = record(c, ['onMessage', 'onAnswer']);
  const sent = c.sendMessage('Hello');
  await flush();
  hand.push(CONVERSATION);
  await sent;
  await flush();
  await assert.rejects(c.stop(), (error: any) => error.errorDesc === WORDS.couldntAnswer);
  await flush();
  assert.equal(fake.requests[0].signal?.aborted, true);
  assert.deepEqual(calls, [{ listener: 'onAnswer', args: [{ text: 'Stopped.', sources: [], stopped: true }] }]);
  await tick(clock, 60_000);
  assert.equal(fake.requests.length, 2, 'nothing read back');
});

test('Stop during a follow is sent and the follow goes on; during a hold it drops the held message', async () => {
  fake.reply(new TypeError('fetch failed'), jsonResponse({ stopped: true }));
  let c = conversation();
  let calls = record(c, ['onMessage', 'onAnswer', 'onConversationUpdate']);
  await c.sendMessage('Hello');
  await flush();
  assert.deepEqual(await c.stop(), { stopped: true });
  fake.reply(readBack([userMessage(sentClientId()), assistant('Stopped.', { stopped: true })]));
  await tick(clock, FOLLOW_WAITS[0]);
  assert.deepEqual(names(calls), ['onConversationUpdate', 'onAnswer']);
  assert.equal((calls[1].args[0] as any).stopped, true);

  // Held behind busy: Stop drops it, never sent; its sendMessage rejects with a 409 and no onError.
  c = conversation();
  calls = record(c, ['onError', 'onConversationUpdate']);
  fake.reply(jsonResponse({ error: { code: 'busy' } }, 409), jsonResponse({ stopped: true }));
  const held = c.sendMessage('Hello');
  await flush();
  assert.deepEqual(calls, [{ listener: 'onConversationUpdate', args: [{ type: 'busy', conversationId: ID }] }]);
  const before = fake.requests.length;
  await c.stop();
  await assert.rejects(held, (error: any) => error.status === 409 && error.errorDesc === WORDS.busy);
  await tick(clock, 60_000);
  assert.equal(fake.requests.length, before + 1, 'Stop alone went out: nothing read back, nothing sent');
  assert.equal(of(calls, 'onError').length, 0);
});

test('a second sendMessage while the first streams waits for its stream to close', async () => {
  const hand = handBody();
  fake.reply(hand.response as any, new FakeResponse({ headers: NDJSON, body: CONVERSATION + line({ type: 'text', text: 'Two.' }) + DONE }));
  const c = conversation();
  const calls = record(c, ['onMessage']);
  const first = c.sendMessage('One');
  const second = c.sendMessage('Two');
  await flush();
  hand.push(CONVERSATION + line({ type: 'text', text: 'One.' }) + DONE);
  await first;
  await flush();
  assert.equal(fake.requests.length, 1, 'not on done: the stream is still open');
  hand.close();
  await second;
  await flush();
  assert.equal(fake.requests.length, 2);
  assert.equal(fake.requests[1].json.message, 'Two');
  assert.deepEqual(calls.map((m) => (m.args[0] as any)[0].text), ['One.', 'Two.']);
});

test('a 409 straight after done, from another tab: held, read back until free, then sent with the same clientId', async () => {
  const c = conversation();
  const calls = record(c, ['onMessage', 'onConversationUpdate', 'onError']);
  fake.reply(
    new FakeResponse({ headers: NDJSON, body: CONVERSATION + line({ type: 'text', text: 'One.' }) + DONE }),
    jsonResponse({ error: { code: 'busy' } }, 409)
  );
  await c.sendMessage('One');
  let handed = false;
  const second = c.sendMessage('Two').then(() => (handed = true));
  await flush();
  assert.equal(handed, false);
  fake.reply(readBack([], true));
  await tick(clock, FOLLOW_WAITS[0]);
  fake.reply(readBack([]), new FakeResponse({ headers: NDJSON, body: CONVERSATION + line({ type: 'text', text: 'Two.' }) + DONE }));
  await tick(clock, FOLLOW_WAITS[1]);
  await second;
  assert.deepEqual(
    fake.requests.map((r) => `${r.method} ${r.url.replace('https://blue.example', '')}`),
    ['POST /v1/chat', 'POST /v1/chat', `GET /v1/chat/${ID}`, `GET /v1/chat/${ID}`, 'POST /v1/chat']
  );
  assert.equal(sentClientId(1), sentClientId(2));
  assert.deepEqual(names(calls), ['onMessage', 'onConversationUpdate', 'onMessage']);
  assert.deepEqual(calls[1].args, [{ type: 'busy', conversationId: ID }]);
});

test('a hold past 10 minutes rejects in the busy words', async () => {
  const c = conversation();
  const calls = record(c, ['onError']);
  fake.reply(jsonResponse({ error: { code: 'busy' } }, 409));
  const held = c.sendMessage('Hello');
  const rejected = assert.rejects(held, (error: any) => error.status === 409 && error.errorDesc === WORDS.busy);
  await flush();
  for (let i = 0; i < 60; i++) fake.reply(readBack([], true));
  for (let t = 0; t < FOLLOW_MS; t += 1_000) await tick(clock, 1_000);
  await rejected;
  assert.deepEqual(calls, [{ listener: 'onError', args: [{ conversationId: ID, errorCode: 409, errorDesc: WORDS.busy }] }]);
});

test('resume(): the pending message is read back at once, with no second onMessage', async () => {
  const hand = handBody();
  fake.reply(hand.response as any);
  const c = conversation();
  const calls = record(c, ['onMessage', 'onAnswer']);
  const sent = c.sendMessage('How long do refunds take?');
  await flush();
  hand.push(CONVERSATION + line({ type: 'sources', sources: [SOURCE] }) + line({ type: 'text', text: 'Refunds take 14 days [1].' }));
  await sent;
  await flush();
  fake.reply(readBack([userMessage(sentClientId()), assistant('Refunds take 14 days [1].', { sources: [SOURCE] })]));
  c.resume();
  await flush();
  assert.equal(fake.requests[0].signal?.aborted, true);
  assert.equal(fake.requests.length, 2, 'read back at once');
  assert.deepEqual(names(calls), ['onMessage', 'onAnswer']);
  c.resume();
  await tick(clock, 60_000);
  assert.equal(fake.requests.length, 2);

  // While a follow waits, resume() reads now.
  fake.reply(new TypeError('fetch failed'));
  await c.sendMessage('Again');
  await flush();
  fake.reply(readBack([userMessage(sentClientId(1), 'Again'), assistant('Again.')]));
  c.resume();
  await flush();
  assert.equal(fake.requests.length, 4);
  assert.deepEqual(names(calls), ['onMessage', 'onAnswer', 'onMessage', 'onAnswer']);
});

test('dispose() ends a follow, and a send before its answer opens nothing more', async () => {
  fake.reply(new TypeError('fetch failed'));
  const c = conversation();
  const calls = record(c);
  await c.sendMessage('Hello');
  await flush();
  api.dispose();
  await flush();
  assert.equal(clock.pending, 0);
  await tick(clock, 60_000);
  assert.equal(fake.requests.length, 1);
  assert.deepEqual(calls, []);
  await assert.rejects(c.sendMessage('Hello'), /disposed/);
});

test('off() removes a Blue listener by the callback itself', async () => {
  const c = conversation();
  const got: string[] = [];
  const onMessage = () => got.push('message');
  const onAnswer = () => got.push('answer');
  c.onMessage(onMessage);
  c.onAnswer(onAnswer);
  c.off('bot_message', onMessage);
  c.off('answer', onAnswer);
  fake.reply(new FakeResponse({ headers: NDJSON, body: CONVERSATION + line({ type: 'text', text: 'Hi.' }) + DONE }));
  await c.sendMessage('Hello');
  await flush();
  assert.deepEqual(got, []);
});

test('with a core key: stop() warns once and resolves false, resume() does nothing, the new listeners are never kept', async () => {
  const c = new Conversation('core-1', null, {}, 'core-key', 'prod', null);
  assert.deepEqual(await c.stop(), { stopped: false });
  assert.deepEqual(await c.stop(), { stopped: false });
  assert.equal(linesAt('warn').filter((l) => l.includes('stop() works only')).length, 1);
  c.resume();
  c.onDelta(() => undefined);
  c.onAnswer(() => undefined);
  c.onStep(() => undefined);
  assert.equal((c as any).listeners.size, 0);
  assert.equal(fake.requests.length, 0);
});

test('no word an app user or developer may see says "410" or "gone"', () => {
  const words = [...Object.values(WORDS), ...Object.values(SETUP_WORDS), ...Object.values(CONSOLE_WORDS), METADATA_TOO_BIG];
  assert.ok(words.length >= 20);
  for (const word of words) assert.doesNotMatch(word, /410|gone/i, word);
});
