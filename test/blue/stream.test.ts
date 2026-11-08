// An answer's stream (first-channels-library-spec §2.3, §2.5): the same events whichever way it
// is read, the pick per runtime, and every way's cuts, caps and refusals, on fakes alone.
import { FakeWebSocket, appKey } from './helpers';
import { clearLogs } from '../fakes/console';
import { FakeFetch, FakeResponse, jsonResponse } from '../fakes/fetch';
import { FakeXMLHttpRequest, installFakeXhr } from '../fakes/xhr';
import { FakeClock } from '../fakes/clock';
import { recordedNames, streamNames, streamOf } from './fixtures';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CaptivateChatAPI } from '../../src/api/CaptivateChatAPI';
import { BlueStreamEvent } from '../../src/api/blue/ndjson';
import { BlueTransport, DISPOSED } from '../../src/api/blue/transport';
import {
  BlueReadWay,
  BlueStream,
  HEADERS_MS,
  IDLE_MS,
  StreamEnd,
  WHOLE_MS,
  XHR_BODY_MAX_BYTES,
  openStream,
  pickWay,
} from '../../src/api/blue/stream';
import { WORDS } from '../../src/api/blue/words';

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

const SECRET = 's'.repeat(43);
const NDJSON = { 'content-type': 'application/x-ndjson; charset=utf-8' };

/** Lets promise chains (fetch's, a ReadableStream's reads) run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}

interface Opened {
  stream: BlueStream;
  batches: BlueStreamEvent[][];
  opens: number;
}

function open(way: BlueReadWay, extra: { withFiles?: boolean } = {}): Opened {
  const out: Opened = { stream: undefined as any, batches: [], opens: 0 };
  out.stream = openStream(transport, {
    path: '/v1/chat',
    body: { message: 'Hello', clientId: 'c'.repeat(22) },
    secret: SECRET,
    way,
    clock,
    onOpen: () => {
      assert.equal(out.batches.length, 0, 'onOpen comes before any events');
      out.opens += 1;
    },
    onEvents: (events) => out.batches.push(events),
    ...extra,
  });
  return out;
}

const flat = (batches: BlueStreamEvent[][]) => batches.flat();

/** The bytes in pieces of `size`, splitting characters wherever they fall. */
function bytePieces(text: string, size: number): Uint8Array[] {
  const bytes = new Uint8Array(Buffer.from(text, 'utf8'));
  const pieces: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) pieces.push(bytes.subarray(i, i + size));
  return pieces;
}

/** The text in pieces of `size` characters, as a responseText grows (never half a character). */
function textPieces(text: string, size: number): string[] {
  const points = Array.from(text);
  const pieces: string[] = [];
  for (let i = 0; i < points.length; i += size) pieces.push(points.slice(i, i + size).join(''));
  return pieces;
}

/** A response whose body the test feeds by hand. */
function handBody(status = 200) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  const encoder = new TextEncoder();
  return {
    response: { ok: status >= 200 && status < 300, status, statusText: 'OK', headers: { get: () => null }, body, text: async () => '' },
    push: (piece: string | Uint8Array) => controller.enqueue(typeof piece === 'string' ? encoder.encode(piece) : piece),
    close: () => controller.close(),
    fail: () => controller.error(new TypeError('network error')),
  };
}

async function readFetch(text: string, size: number): Promise<{ batches: BlueStreamEvent[][]; end: StreamEnd }> {
  fake.reply(new FakeResponse({ headers: NDJSON, body: bytePieces(text, size) }));
  const run = open('fetch');
  const end = await run.stream.finished;
  return { batches: run.batches, end };
}

async function readXhr(text: string, size: number): Promise<{ batches: BlueStreamEvent[][]; end: StreamEnd; xhr: FakeXMLHttpRequest }> {
  const run = open('xhr');
  const xhr = FakeXMLHttpRequest.last!;
  xhr.respond(200, NDJSON);
  for (const piece of textPieces(text, size)) xhr.push(piece);
  xhr.finish();
  const end = await run.stream.finished;
  return { batches: run.batches, end, xhr };
}

async function readWhole(text: string): Promise<{ batches: BlueStreamEvent[][]; end: StreamEnd }> {
  fake.reply(new FakeResponse({ headers: NDJSON, body: text }));
  const run = open('whole');
  const end = await run.stream.finished;
  return { batches: run.batches, end };
}

/** What a recording holds: each line as JSON, blank lines skipped, nothing after `done`. */
function recordedEvents(text: string): any[] {
  const events = text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
  const done = events.findIndex((e) => e.type === 'done');
  return done === -1 ? events : events.slice(0, done + 1);
}

const conversation = (id: string) => ({ type: 'conversation', conversationId: id });

/** The hand-written cases: what each gives, and how it ends. */
const CASES: Record<string, { events: any[]; end: StreamEnd }> = {
  'case-keep-alive': {
    events: [
      conversation('0000000000000000000000a1'),
      { type: 'step', label: 'Looking into it' },
      { type: 'delta', text: 'Parcels leave every weekday at 4pm.' },
      { type: 'sources', sources: [] },
      { type: 'text', text: 'Parcels leave every weekday at 4pm.' },
      { type: 'done' },
    ],
    end: { kind: 'ended' },
  },
  'case-cut-after-text': {
    events: [
      conversation('0000000000000000000000a2'),
      { type: 'step', label: 'Looking into it' },
      { type: 'delta', text: 'Refunds are paid within 14 days of a request [1].' },
      { type: 'sources', sources: [{ number: 1, title: 'Delivery notes', excerpt: 'Refunds for late parcels are paid on request.' }] },
      { type: 'text', text: 'Refunds are paid within 14 days of a request [1].' },
    ],
    end: { kind: 'cut', reason: 'no-end' },
  },
  'case-after-done': {
    events: [conversation('0000000000000000000000a3'), { type: 'delta', text: 'Hello.' }, { type: 'text', text: 'Hello.' }, { type: 'done' }],
    end: { kind: 'ended' },
  },
  'case-draft-space': {
    events: [
      conversation('0000000000000000000000a4'),
      { type: 'step', label: 'Looking into it' },
      { type: 'delta', text: '£12 a seat [1' },
      { type: 'delta', text: '£12 a seat [1, 2]. Ask about 漢字 or 🎉 groups [3]' },
      { type: 'sources', sources: [{ number: 1, title: 'Prices', excerpt: '£12 a seat.' }, { number: 2, title: null }] },
      { type: 'text', text: '£12 a seat [1, 2]. Ask about 漢字 or 🎉 groups [1].' },
      { type: 'done' },
    ],
    end: { kind: 'ended' },
  },
  'case-unknown-events': {
    events: [conversation('0000000000000000000000a5'), { type: 'text', text: 'Still here.' }, { type: 'done' }],
    end: { kind: 'ended' },
  },
  'case-not-json': {
    events: [conversation('0000000000000000000000a6'), { type: 'delta', text: 'Half' }],
    end: { kind: 'cut', reason: 'not-json' },
  },
  'case-no-last-newline': {
    events: [conversation('0000000000000000000000a7'), { type: 'text', text: 'A last line without its newline.' }, { type: 'done' }],
    end: { kind: 'ended' },
  },
};

test('the fixtures hold every recording the backend makes, and each hand-written case is known here', () => {
  assert.deepEqual(recordedNames(), [
    'answer-cited',
    'answer-reset',
    'error',
    'interview-choices',
    'lookup-offer',
    'offer',
    'offline',
    'sources-off',
    'stopped',
  ]);
  assert.deepEqual(
    streamNames().filter((n) => n.startsWith('case-')),
    Object.keys(CASES).sort()
  );
});

for (const name of streamNames()) {
  test(`${name}: the same events through fetch's body, XMLHttpRequest and the body read whole`, async () => {
    const text = streamOf(name);
    const expected = CASES[name] ?? { events: recordedEvents(text), end: { kind: 'ended' } };
    for (const size of [1, 7, 64, 1 << 20]) {
      const viaFetch = await readFetch(text, size);
      assert.deepEqual(flat(viaFetch.batches), expected.events, `fetch, ${size}-byte chunks`);
      assert.deepEqual(viaFetch.end, expected.end, `fetch, ${size}-byte chunks`);
      assert.ok(viaFetch.batches.every((b) => b.length > 0));

      const viaXhr = await readXhr(text, size);
      assert.deepEqual(flat(viaXhr.batches), expected.events, `XHR, ${size}-character pieces`);
      assert.deepEqual(viaXhr.end, expected.end, `XHR, ${size}-character pieces`);
    }
    const whole = await readWhole(text);
    assert.deepEqual(whole.batches, expected.events.length ? [expected.events] : [], 'whole: one batch, no drafts');
    assert.deepEqual(whole.end, expected.end, 'whole');
  });
}

test('one batch per network chunk, holding every line the chunk completed', async () => {
  const run = open('xhr');
  const xhr = FakeXMLHttpRequest.last!;
  xhr.respond(200, NDJSON);
  xhr.push('{"type":"conversation","conversationId":"c1"}\n{"type":"delta","text":"A"}\n{"type":"del');
  xhr.push('ta","text":"AB"}\n');
  xhr.push('\n');
  xhr.push('{"type":"reset"}\n{"type":"delta","text":"C"}\n{"type":"text","text":"C."}\n{"type":"done"}\n');
  xhr.finish();
  assert.deepEqual(await run.stream.finished, { kind: 'ended' });
  assert.deepEqual(run.batches, [
    [conversation('c1'), { type: 'delta', text: 'A' }],
    [{ type: 'delta', text: 'AB' }],
    [{ type: 'reset' }, { type: 'delta', text: 'C' }, { type: 'text', text: 'C.' }, { type: 'done' }],
  ]);
  assert.equal(run.opens, 1);
});

// XMLHttpRequest, as React Native's own fetch has no body.

test('XHR: the request has the three headers alone, no credentials, no time limit, and onprogress set before send', () => {
  open('xhr');
  const xhr = FakeXMLHttpRequest.last!;
  assert.equal(xhr.method, 'POST');
  assert.equal(xhr.url, 'https://blue.example/v1/chat');
  assert.deepEqual(xhr.requestHeaders, {
    authorization: `Bearer ${transport.apiKey}`,
    'content-type': 'application/json',
    'x-blue-conversation': SECRET,
  });
  assert.deepEqual(JSON.parse(String(xhr.body)), { message: 'Hello', clientId: 'c'.repeat(22) });
  assert.equal(xhr.withCredentials, false);
  assert.equal(xhr.timeout, 0);
  assert.equal(xhr.responseType, '');
  assert.equal(xhr.progressSetAtSend, true);
});

test('XHR: keep-alives every 15 s hold the stream open past 45 s; 45 s of nothing is a cut', async () => {
  const run = open('xhr');
  const xhr = FakeXMLHttpRequest.last!;
  xhr.respond(200, NDJSON);
  xhr.push('{"type":"conversation","conversationId":"c1"}\n');
  for (let s = 0; s < 50; s += 15) {
    clock.tick(15_000);
    xhr.push('\n');
  }
  clock.tick(IDLE_MS - 1);
  await flush();
  assert.equal(xhr.aborted, false, 'not cut after 50 s of keep-alives');
  clock.tick(1);
  assert.deepEqual(await run.stream.finished, { kind: 'cut', reason: 'idle' });
  assert.equal(xhr.aborted, true, 'the request is aborted before anything is read back');
  xhr.push('{"type":"text","text":"Late."}\n');
  assert.deepEqual(flat(run.batches), [conversation('c1')]);
});

test('XHR: no headers within 30 s is a cut', async () => {
  const run = open('xhr');
  const xhr = FakeXMLHttpRequest.last!;
  clock.tick(HEADERS_MS - 1);
  await flush();
  assert.equal(xhr.aborted, false);
  clock.tick(1);
  assert.deepEqual(await run.stream.finished, { kind: 'cut', reason: 'headers' });
  assert.equal(xhr.aborted, true);
  assert.equal(run.opens, 0);
});

test('XHR: the tail that arrives with load alone is read, and no line is read twice', async () => {
  const run = open('xhr');
  const xhr = FakeXMLHttpRequest.last!;
  xhr.respond(200, NDJSON);
  xhr.push('{"type":"conversation","conversationId":"c1"}\n{"type":"text","text":"Hi."}\n');
  // readystatechange 4 and load both fire for the last piece: it is read once.
  xhr.finish('{"type":"done"}\n');
  assert.deepEqual(await run.stream.finished, { kind: 'ended' });
  assert.deepEqual(run.batches, [[conversation('c1'), { type: 'text', text: 'Hi.' }], [{ type: 'done' }]]);
});

test('XHR: a last line without its newline is read at the end', async () => {
  const run = open('xhr');
  const xhr = FakeXMLHttpRequest.last!;
  xhr.respond(200, NDJSON);
  xhr.push('{"type":"text","text":"Hi."}\n{"type":"do');
  xhr.finish('ne"}');
  assert.deepEqual(await run.stream.finished, { kind: 'ended' });
  assert.deepEqual(flat(run.batches), [{ type: 'text', text: 'Hi.' }, { type: 'done' }]);
});

test('XHR: an error mid-stream is a cut, after the events that came', async () => {
  const run = open('xhr');
  const xhr = FakeXMLHttpRequest.last!;
  xhr.respond(200, NDJSON);
  xhr.push('{"type":"conversation","conversationId":"c1"}\n{"type":"delta","text":"Par');
  xhr.fail();
  assert.deepEqual(await run.stream.finished, { kind: 'cut', reason: 'network' });
  assert.deepEqual(flat(run.batches), [conversation('c1')]);
});

test('XHR: abort ends the request, and nothing comes after it', async () => {
  const run = open('xhr');
  const xhr = FakeXMLHttpRequest.last!;
  xhr.respond(200, NDJSON);
  xhr.push('{"type":"conversation","conversationId":"c1"}\n');
  run.stream.abort();
  assert.equal(xhr.aborted, true);
  assert.deepEqual(await run.stream.finished, { kind: 'aborted' });
  xhr.push('{"type":"text","text":"Late."}\n');
  xhr.finish('{"type":"done"}\n');
  assert.deepEqual(flat(run.batches), [conversation('c1')]);
  assert.equal(clock.pending, 0, 'no timer left');
});

test('XHR: 409 busy is refused in the library words, before any event', async () => {
  const run = open('xhr');
  const xhr = FakeXMLHttpRequest.last!;
  xhr.respond(409, { 'content-type': 'application/json' }, 'Conflict');
  xhr.push('{"error":{"code":"busy","message":"The backend said 410 and gone."}}');
  xhr.finish();
  const end = await run.stream.finished;
  assert.equal(end.kind, 'refused');
  if (end.kind !== 'refused') return;
  assert.equal(end.error.status, 409);
  assert.equal(end.error.code, 'busy');
  assert.equal(end.error.errorDesc, WORDS.busy);
  assert.equal(end.error.message, `HTTP request failed: 409 Conflict: ${WORDS.busy}`);
  assert.equal(run.opens, 0);
  assert.deepEqual(run.batches, []);
});

test('XHR: 429 gives its Retry-After', async () => {
  const run = open('xhr');
  const xhr = FakeXMLHttpRequest.last!;
  xhr.respond(429, { 'content-type': 'application/json', 'retry-after': '7' }, 'Too Many Requests');
  xhr.finish('{"error":{"code":"rate_limited","message":"Slow down."}}');
  const end = await run.stream.finished;
  assert.equal(end.kind, 'refused');
  if (end.kind !== 'refused') return;
  assert.equal(end.error.retryAfter, 7);
  assert.equal(end.error.errorDesc, WORDS.tooMany);
});

test('XHR: a 4xx JSON body is read for its code, never its words; a send with files reads its 413 as one', async () => {
  let run = open('xhr');
  let xhr = FakeXMLHttpRequest.last!;
  xhr.respond(400, { 'content-type': 'application/json' });
  xhr.finish('{"error":{"code":"invalid_attachment","message":"The backend said 410 and gone."}}');
  let end = await run.stream.finished;
  assert.equal(end.kind === 'refused' && end.error.errorDesc, WORDS.fileNotFound);
  assert.ok(end.kind === 'refused' && !/410|gone/i.test(end.error.message));

  run = open('xhr', { withFiles: true });
  xhr = FakeXMLHttpRequest.last!;
  xhr.respond(413);
  xhr.finish('{"error":{"code":"too_large","message":"Too big."}}');
  end = await run.stream.finished;
  assert.equal(end.kind === 'refused' && end.error.errorDesc, WORDS.fileTooBig);
});

test('XHR: a responseText past 2 MB aborts the request and is a cut', async () => {
  const run = open('xhr');
  const xhr = FakeXMLHttpRequest.last!;
  xhr.respond(200, NDJSON);
  const line = `${JSON.stringify({ type: 'delta', text: 'a'.repeat(100_000) })}\n`;
  let pushed = 0;
  while (pushed <= XHR_BODY_MAX_BYTES && xhr.aborted === false) {
    xhr.push(line);
    pushed += line.length;
  }
  assert.deepEqual(await run.stream.finished, { kind: 'cut', reason: 'body-too-big' });
  assert.equal(xhr.aborted, true);
  assert.ok(flat(run.batches).length < pushed / line.length);
});

test('XHR: a line over 1 MB aborts the request and is a cut', async () => {
  const run = open('xhr');
  const xhr = FakeXMLHttpRequest.last!;
  xhr.respond(200, NDJSON);
  xhr.push('{"type":"delta","text":"');
  xhr.push('a'.repeat(1_048_576));
  assert.deepEqual(await run.stream.finished, { kind: 'cut', reason: 'line-too-long' });
  assert.equal(xhr.aborted, true);
});

// fetch's body: browsers, Electron, Node, Deno, Bun, and React Native with expo/fetch.

test('fetch: the request has the three headers alone, as JSON, without credentials', async () => {
  const inits: any[] = [];
  const options = new FakeFetch().reply(new FakeResponse({ headers: NDJSON, body: '{"type":"done"}\n' }));
  transport.configure({
    fetch: (input: string, init: any) => {
      inits.push(init);
      return options.fetch(input, init);
    },
  });
  const run = open('fetch');
  assert.deepEqual(await run.stream.finished, { kind: 'ended' });
  assert.equal(inits[0].credentials, 'omit');
  const request = options.last!;
  assert.equal(request.url, 'https://blue.example/v1/chat');
  assert.equal(request.method, 'POST');
  assert.deepEqual(request.headers, {
    authorization: `Bearer ${transport.apiKey}`,
    'content-type': 'application/json',
    'x-blue-conversation': SECRET,
  });
  assert.deepEqual(request.json, { message: 'Hello', clientId: 'c'.repeat(22) });
  assert.equal(fake.requests.length, 0, 'the global fetch is left alone when options.fetch is given');
});

const SPLIT = '{"type":"delta","text":"é 漢 🎉"}\n{"type":"done"}\n';

test('fetch: chunks splitting é, 漢 and an emoji give them whole, with TextDecoder', async () => {
  for (let size = 1; size <= 6; size++) {
    const { batches, end } = await readFetch(SPLIT, size);
    assert.deepEqual(flat(batches), [{ type: 'delta', text: 'é 漢 🎉' }, { type: 'done' }], `${size}-byte chunks`);
    assert.deepEqual(end, { kind: 'ended' });
  }
});

test('fetch: chunks splitting é, 漢 and an emoji give them whole with no TextDecoder, by the own decoder', async () => {
  const original = (globalThis as any).TextDecoder;
  delete (globalThis as any).TextDecoder;
  try {
    for (let size = 1; size <= 6; size++) {
      const { batches } = await readFetch(SPLIT, size);
      assert.deepEqual(flat(batches), [{ type: 'delta', text: 'é 漢 🎉' }, { type: 'done' }], `${size}-byte chunks`);
    }
  } finally {
    (globalThis as any).TextDecoder = original;
  }
});

test('fetch: a response with body null is read whole, in one batch', async () => {
  fake.reply(new FakeResponse({ headers: NDJSON, body: streamOf('answer-cited'), stream: false }));
  const run = open('fetch');
  assert.deepEqual(await run.stream.finished, { kind: 'ended' });
  assert.deepEqual(run.batches, [recordedEvents(streamOf('answer-cited'))]);
  assert.equal(run.opens, 1);
});

test('fetch: an abort mid-read ends the request, and nothing comes after it', async () => {
  const hand = handBody();
  fake.reply(hand.response as any);
  const run = open('fetch');
  await flush();
  hand.push('{"type":"conversation","conversationId":"c1"}\n');
  await flush();
  run.stream.abort();
  assert.deepEqual(await run.stream.finished, { kind: 'aborted' });
  assert.equal(fake.last!.signal?.aborted, true);
  try {
    hand.push('{"type":"text","text":"Late."}\n');
  } catch (_) {
    // The body was cancelled: nothing more can come.
  }
  await flush();
  assert.deepEqual(flat(run.batches), [conversation('c1')]);
  assert.equal(clock.pending, 0);
});

test('fetch: chunks every 15 s keep it open, keep-alives too; 45 s of nothing is a cut', async () => {
  const hand = handBody();
  fake.reply(hand.response as any);
  const run = open('fetch');
  await flush();
  hand.push('{"type":"conversation","conversationId":"c1"}\n');
  await flush();
  for (let s = 0; s < 60; s += 15) {
    clock.tick(15_000);
    hand.push('\n');
    await flush();
  }
  clock.tick(IDLE_MS - 1);
  await flush();
  assert.equal(fake.last!.signal?.aborted, false);
  clock.tick(1);
  assert.deepEqual(await run.stream.finished, { kind: 'cut', reason: 'idle' });
  assert.equal(fake.last!.signal?.aborted, true);
});

test('fetch: no headers within 30 s is a cut, the request aborted', async () => {
  fake.reply(() => new Promise<never>(() => undefined));
  const run = open('fetch');
  await flush();
  clock.tick(HEADERS_MS);
  assert.deepEqual(await run.stream.finished, { kind: 'cut', reason: 'headers' });
  assert.equal(fake.last!.signal?.aborted, true);
});

test('fetch: a network error before or during the body is a cut', async () => {
  fake.reply(new TypeError('fetch failed'));
  assert.deepEqual(await open('fetch').stream.finished, { kind: 'cut', reason: 'network' });

  const hand = handBody();
  fake.reply(hand.response as any);
  const run = open('fetch');
  await flush();
  hand.push('{"type":"conversation","conversationId":"c1"}\n{"type":"delta","text":"Pa');
  await flush();
  hand.fail();
  assert.deepEqual(await run.stream.finished, { kind: 'cut', reason: 'network' });
  assert.deepEqual(flat(run.batches), [conversation('c1')]);
});

test('fetch: an end without done, stopped or error is a cut', async () => {
  const hand = handBody();
  fake.reply(hand.response as any);
  const run = open('fetch');
  await flush();
  hand.push('{"type":"conversation","conversationId":"c1"}\n{"type":"delta","text":"Pa"}\n');
  hand.close();
  assert.deepEqual(await run.stream.finished, { kind: 'cut', reason: 'no-end' });
});

test('fetch: 409, 429 and a 4xx are refused by status and code, never the body words', async () => {
  fake.reply(jsonResponse({ error: { code: 'busy', message: 'The backend said 410 and gone.' } }, 409));
  let end = await open('fetch').stream.finished;
  assert.equal(end.kind === 'refused' && end.error.errorDesc, WORDS.busy);

  fake.reply(jsonResponse({ error: { code: 'day_limit', message: 'Gone for the day.' } }, 429, { 'retry-after': '3600' }));
  end = await open('fetch').stream.finished;
  assert.equal(end.kind === 'refused' && end.error.retryAfter, 3600);
  assert.equal(end.kind === 'refused' && end.error.errorDesc, WORDS.dayOfAnswers);

  fake.reply(jsonResponse({ error: { code: 'not_found', message: 'Gone.' } }, 404));
  const run = open('fetch');
  end = await run.stream.finished;
  assert.equal(end.kind === 'refused' && end.error.errorDesc, WORDS.conversationGone);
  assert.equal(run.opens, 0);
});

test('fetch: a line over 1 MB aborts the request and is a cut', async () => {
  const hand = handBody();
  fake.reply(hand.response as any);
  const run = open('fetch');
  await flush();
  hand.push(`{"type":"delta","text":"${'a'.repeat(1_048_576)}"}\n`);
  assert.deepEqual(await run.stream.finished, { kind: 'cut', reason: 'line-too-long' });
  assert.equal(fake.last!.signal?.aborted, true);
});

// Reading whole: the same events, all at once, within 330 s of the send.

test('whole: a text() taking 60 s gives its events; one never settling is cut at 330 s from the send', async () => {
  const body = streamOf('sources-off');
  fake.reply({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    body: null,
    text: () => new Promise<string>((r) => clock.setTimeout(() => r(body), 60_000)),
  } as any);
  let run = open('whole');
  await flush();
  clock.tick(60_000);
  assert.deepEqual(await run.stream.finished, { kind: 'ended' });
  assert.deepEqual(run.batches, [recordedEvents(body)]);

  fake.reply({ ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, body: null, text: () => new Promise<never>(() => undefined) } as any);
  run = open('whole');
  await flush();
  assert.equal(run.opens, 1, 'the headers came');
  clock.tick(WHOLE_MS - 1);
  await flush();
  assert.equal(fake.last!.signal?.aborted, false);
  clock.tick(1);
  assert.deepEqual(await run.stream.finished, { kind: 'cut', reason: 'whole-time' });
  assert.equal(fake.last!.signal?.aborted, true);
  assert.deepEqual(run.batches, []);
});

test('whole: headers that never come are cut at 330 s, not 30', async () => {
  fake.reply(() => new Promise<never>(() => undefined));
  const run = open('whole');
  await flush();
  clock.tick(HEADERS_MS);
  await flush();
  assert.equal(fake.last!.signal?.aborted, false);
  clock.tick(WHOLE_MS - HEADERS_MS);
  assert.deepEqual(await run.stream.finished, { kind: 'cut', reason: 'whole-time' });
});

// The instance.

test('dispose() ends a stream in flight; a disposed instance opens none', async () => {
  const run = open('xhr');
  const xhr = FakeXMLHttpRequest.last!;
  xhr.respond(200, NDJSON);
  api.dispose();
  assert.deepEqual(await run.stream.finished, { kind: 'aborted' });
  assert.equal(xhr.aborted, true);
  assert.throws(() => open('xhr'), { message: DISPOSED });
});

test('a listener that throws does not cut the answer', async () => {
  const xhr = (() => {
    const stream = openStream(transport, {
      path: '/v1/chat',
      body: {},
      way: 'xhr',
      clock,
      onEvents: () => {
        throw new Error('the app broke');
      },
    });
    return { stream, xhr: FakeXMLHttpRequest.last! };
  })();
  xhr.xhr.respond(200, NDJSON);
  xhr.xhr.push('{"type":"text","text":"Hi."}\n{"type":"done"}\n');
  xhr.xhr.finish();
  assert.deepEqual(await xhr.stream.finished, { kind: 'ended' });
});

// The pick (§2.3), made before the POST goes out.

class AResponse {
  get body() {
    return null;
  }
}

test('the pick: fetch body where ReadableStream and Response.body exist, outside React Native', () => {
  const browser = { navigator: { product: 'Gecko' }, ReadableStream: class {}, Response: AResponse, XMLHttpRequest: class {} };
  assert.equal(pickWay({}, browser), 'fetch');
  assert.equal(pickWay({ stream: 'auto' }, browser), 'fetch');
  // Node 20 has no navigator.
  assert.equal(pickWay({}, { ReadableStream: class {}, Response: AResponse }), 'fetch');
  // The runtime these tests run on.
  assert.equal(pickWay({}), 'fetch');
});

test('the pick: React Native takes XHR, unless options.fetch is given (expo/fetch)', () => {
  const reactNative = { navigator: { product: 'ReactNative' }, ReadableStream: class {}, Response: AResponse, XMLHttpRequest: class {} };
  assert.equal(pickWay({}, reactNative), 'xhr');
  assert.equal(pickWay({ fetch: () => undefined }, reactNative), 'fetch');
});

test('the pick: no ReadableStream, or a Response without body, takes XHR; neither takes the body whole', () => {
  assert.equal(pickWay({}, { Response: AResponse, XMLHttpRequest: class {} }), 'xhr');
  assert.equal(pickWay({}, { ReadableStream: class {}, Response: class {}, XMLHttpRequest: class {} }), 'xhr');
  assert.equal(pickWay({}, { Response: AResponse }), 'whole');
  assert.equal(pickWay({}, {}), 'whole');
});

test('the pick: options.stream decides', () => {
  const browser = { ReadableStream: class {}, Response: AResponse, XMLHttpRequest: class {} };
  assert.equal(pickWay({ stream: 'whole' }, browser), 'whole');
  assert.equal(pickWay({ stream: 'xhr' }, browser), 'xhr');
  assert.equal(pickWay({ stream: 'fetch', fetch: undefined }, {}), 'fetch');
  assert.equal(pickWay({ stream: 'whole', fetch: () => undefined }, browser), 'whole');
});

test('XHR picked where there is none reads the body whole by fetch', async () => {
  uninstallXhr();
  uninstallXhr = () => undefined;
  const restore = (globalThis as any).XMLHttpRequest;
  assert.equal(restore, undefined);
  fake.reply(new FakeResponse({ headers: NDJSON, body: streamOf('offline') }));
  const run = open('xhr');
  assert.deepEqual(await run.stream.finished, { kind: 'ended' });
  assert.deepEqual(run.batches, [recordedEvents(streamOf('offline'))]);
});
