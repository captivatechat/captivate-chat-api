// Blue mode's transport (first-channels-library-spec §2.2, §2.3, §1.2; gaps G16): each call's
// headers and nothing more, its time, and its refusals in §1.2's words, never the backend's.
import { FakeWebSocket, appKey } from './helpers';
import { linesAt, clearLogs } from '../fakes/console';
import { FakeFetch, FakeResponse, jsonResponse } from '../fakes/fetch';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CaptivateChatAPI } from '../../src/api/CaptivateChatAPI';
import { BlueError, BlueTransport, CALL_MS, retryAfterOf } from '../../src/api/blue/transport';
import { BlueCall, CONSOLE_WORDS, METADATA_TOO_BIG, SETUP_WORDS, WORDS, refusalWords } from '../../src/api/blue/words';

let fake: FakeFetch;
let api: CaptivateChatAPI;
let transport: BlueTransport;

beforeEach(() => {
  FakeWebSocket.reset();
  clearLogs();
  fake = new FakeFetch().install();
  api = new CaptivateChatAPI(appKey(), 'prod');
  transport = (api as any).blue;
});

afterEach(() => {
  api.dispose();
  fake.restore();
});

const refusal = (status: number, error: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  jsonResponse({ error: { message: 'The backend said 410 and gone.', ...error } }, status, headers);

async function refusedWith(call: BlueCall, reply: FakeResponse, extra: { withFiles?: boolean } = {}): Promise<BlueError> {
  fake.reply(reply);
  try {
    await transport.request('POST', '/v1/chat', { call, body: {}, ...extra });
  } catch (error) {
    return error as BlueError;
  }
  throw new Error('The call was not refused');
}

test('a call sends the key, the JSON type and the user secret, and no other header, without credentials', async () => {
  const seen: any[] = [];
  const options = new FakeFetch();
  options.reply((request) => {
    seen.push(request);
    return jsonResponse({ ok: true });
  });
  // The init as the library gives it, beside what the fake records.
  const fetchOption = (input: string, init: any) => {
    seen.push(init);
    return options.fetch(input, init);
  };
  transport.configure({ fetch: fetchOption, blueUrl: 'https://blue.example' });
  const body = await transport.request('POST', '/v1/chat/conversations', {
    call: 'start',
    body: { greeting: true },
    secret: 'x'.repeat(43),
  });
  assert.deepEqual(body, { ok: true });
  const [init, request] = seen;
  assert.equal(init.credentials, 'omit');
  assert.equal(request.url, 'https://blue.example/v1/chat/conversations');
  assert.equal(request.method, 'POST');
  assert.deepEqual(request.headers, {
    authorization: `Bearer ${transport.apiKey}`,
    'content-type': 'application/json',
    'x-blue-conversation': 'x'.repeat(43),
  });
  assert.deepEqual(request.json, { greeting: true });
  // options.fetch was used, never the global one.
  assert.equal(fake.requests.length, 0);
});

test('a call without a body or a secret sends the key alone; an empty answer is undefined', async () => {
  fake.reply(new FakeResponse({ status: 204 }));
  const body = await transport.request('DELETE', '/v1/chat/c-1', { call: 'conversation' });
  assert.equal(body, undefined);
  assert.equal(fake.last!.url, 'https://vienna-blue-backend.prod.captivat.io/v1/chat/c-1');
  assert.deepEqual(fake.last!.headers, { authorization: `Bearer ${transport.apiKey}` });
  assert.equal(fake.last!.body, undefined);
});

test('a refusal is an Error in core shape, with the status, the code and the words, never the backend words', async () => {
  const error = await refusedWith('conversation', refusal(404, { code: 'not_found' }));
  assert.equal(error.message, `HTTP request failed: 404 Not Found: ${WORDS.conversationGone}`);
  assert.equal(error.status, 404);
  assert.equal(error.code, 'not_found');
  assert.equal(error.errorDesc, "This conversation isn't available any more. Start a new one.");
  assert.doesNotMatch(error.message, /410|gone/i);
  assert.equal((error as any).body, undefined);
});

test("a status text left out (HTTP/2) leaves no gap in the message", async () => {
  const error = await refusedWith('conversation', new FakeResponse({ status: 500, statusText: '', body: '' }));
  assert.equal(error.message, `HTTP request failed: 500: ${WORDS.couldntAnswer}`);
});

test("each refusal gets §1.2's words by its status, its code and the call", async () => {
  const rows: [BlueCall, FakeResponse, string, { withFiles?: boolean }?][] = [
    ['send', refusal(409, { code: 'busy' }), WORDS.busy],
    ['press', refusal(409, { code: 'needs_sign_in' }), WORDS.signInAgain],
    ['press', refusal(409, { code: 'offer_closed' }), WORDS.notAnyMore],
    ['press', refusal(409, { code: 'switched_off' }), WORDS.notAnyMore],
    ['send', refusal(400, { code: 'too_many_files' }), WORDS.tooManyFiles],
    ['upload', refusal(400, { code: 'too_many_files' }), WORDS.tooManyFiles],
    ['press', refusal(400, { code: 'invalid', fields: { email: 'That address needs a look.' } }), WORDS.formRefused],
    ['press', refusal(429, { code: 'rate_limited' }, { 'Retry-After': '30' }), WORDS.sentTooOften],
    ['send', refusal(400, { code: 'invalid_attachment' }), WORDS.fileNotFound],
    ['send', refusal(413, { code: 'too_large' }), WORDS.fileTooBig, { withFiles: true }],
    ['send', refusal(413, { code: 'too_large' }), WORDS.shortenIt],
    ['send', refusal(400, { code: 'invalid' }), WORDS.shortenIt],
    ['send', refusal(429, { code: 'rate_limited' }, { 'Retry-After': '3600' }), WORDS.dayOfAnswers],
    ['start', refusal(429, { code: 'rate_limited' }, { 'Retry-After': '601' }), WORDS.dayOfAnswers],
    // Gaps G8: a day's cap told by its code, even within ten minutes of midnight UTC.
    ['send', refusal(429, { code: 'day_limit' }, { 'Retry-After': '120' }), WORDS.dayOfAnswers],
    ['upload', refusal(429, { code: 'day_limit' }, { 'Retry-After': '120' }), WORDS.dayOfFiles],
    ['upload', refusal(429, { code: 'rate_limited' }, { 'Retry-After': '7200' }), WORDS.dayOfFiles],
    // Gaps G7: twenty empty conversations under one secret.
    ['start', refusal(429, { code: 'too_many_empty' }, { 'Retry-After': '7200' }), WORDS.tooManyNew],
    ['send', refusal(429, { code: 'rate_limited' }, { 'Retry-After': '600' }), WORDS.tooMany],
    ['conversation', refusal(429, { code: 'rate_limited' }, { 'Retry-After': '20' }), WORDS.tooMany],
    ['conversation', refusal(404, { code: 'not_found' }), WORDS.conversationGone],
    ['send', refusal(401, { code: 'invalid_key' }), WORDS.cantReach],
    ['send', refusal(403, { code: 'origin_not_allowed' }), WORDS.cantReach],
    ['send', refusal(403, { code: 'hidden' }), WORDS.cantReach],
    // Gaps G10: a metadata PATCH over 4 KB.
    ['metadata', refusal(413, { code: 'too_large' }), METADATA_TOO_BIG],
    ['send', refusal(500, { code: 'internal' }), WORDS.couldntAnswer],
    ['send', refusal(503, { code: 'storage_unavailable' }), WORDS.couldntAnswer],
    ['send', new FakeResponse({ status: 502, body: '<html>Bad gateway</html>' }), WORDS.couldntAnswer],
  ];
  for (const [call, reply, words, extra] of rows) {
    const error = await refusedWith(call, reply, extra);
    assert.equal(error.errorDesc, words, `${call} ${reply.status}`);
  }
});

test("a refused form names its fields, never their words; a 429 carries Retry-After in seconds", async () => {
  const form = await refusedWith('press', refusal(400, { code: 'invalid', fields: { email: 'Not an address.', phone: 'Too short.' } }));
  assert.deepEqual(form.fields, ['email', 'phone']);
  assert.doesNotMatch(form.message, /Not an address|Too short/);

  const limited = await refusedWith('send', refusal(429, { code: 'rate_limited' }, { 'Retry-After': '42' }));
  assert.equal(limited.retryAfter, 42);
  assert.equal(limited.status, 429);
  assert.equal(retryAfterOf('Wed, 21 Oct 2026 07:28:00 GMT', Date.parse('Wed, 21 Oct 2026 07:27:00 GMT')), 60);
  assert.equal(retryAfterOf('2.2'), 3);
  assert.equal(retryAfterOf('soon'), undefined);
  assert.equal(retryAfterOf(null), undefined);
});

test('a refused key warns the developer once, in its words', async () => {
  await refusedWith('send', refusal(401, { code: 'invalid_key' }));
  await refusedWith('send', refusal(403, { code: 'origin_not_allowed' }));
  assert.deepEqual(linesAt('warn'), [`[CaptivateChatAPI] ${CONSOLE_WORDS.keyRefused}`]);
  assert.equal(
    CONSOLE_WORDS.keyRefused,
    'The key was refused. Check it is a key for your app, turned on, and that this address is listed on it.'
  );
  clearLogs();
  await refusedWith('send', refusal(500));
  assert.deepEqual(linesAt('warn'), []);
});

test('no network gives the "couldn\'t answer" words with no status, sent once', async () => {
  fake.reply(new TypeError('Failed to fetch'));
  await assert.rejects(transport.request('POST', '/v1/chat', { call: 'send', body: {} }), (error: BlueError) => {
    assert.equal(error.errorDesc, WORDS.couldntAnswer);
    assert.equal(error.status, undefined);
    assert.equal(error.message, `HTTP request failed: ${WORDS.couldntAnswer}`);
    return true;
  });
  assert.equal(fake.requests.length, 1);
});

test('a call past its time is aborted and answered with the "couldn\'t answer" words, never sent again (gaps G16)', async () => {
  assert.equal(CALL_MS, 30_000);
  let signal: AbortSignal | null | undefined;
  fake.reply((request) => {
    signal = request.signal;
    return new Promise(() => undefined);
  });
  await assert.rejects(transport.request('GET', '/v1/chat/c-1', { call: 'conversation', timeoutMs: 20 }), {
    errorDesc: WORDS.couldntAnswer,
  } as any);
  assert.equal(signal?.aborted, true);
  assert.equal(fake.requests.length, 1);
});

test('a body that never finishes counts against the time too', async () => {
  const slow = new FakeResponse({ status: 200 });
  (slow as any).text = () => new Promise(() => undefined);
  fake.reply(slow);
  await assert.rejects(transport.request('GET', '/v1/chat/c-1', { call: 'conversation', timeoutMs: 20 }), {
    errorDesc: WORDS.couldntAnswer,
  } as any);
});

test('a 2xx answer that is not JSON reads as "couldn\'t answer"', async () => {
  fake.reply(new FakeResponse({ status: 200, body: '<html></html>' }));
  await assert.rejects(transport.request('GET', '/v1/chat/c-1', { call: 'conversation' }), {
    errorDesc: WORDS.couldntAnswer,
  } as any);
});

test('dispose() aborts every call in flight, and later calls refuse', async () => {
  let signal: AbortSignal | null | undefined;
  fake.reply((request) => {
    signal = request.signal;
    return new Promise((_, reject) => request.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  });
  const pending = transport.request('GET', '/v1/chat/c-1', { call: 'conversation' });
  await new Promise((resolve) => setImmediate(resolve));
  api.dispose();
  await assert.rejects(pending, /disposed/);
  assert.equal(signal?.aborted, true);
  await assert.rejects(transport.request('GET', '/v1/chat/c-1', { call: 'conversation' }), /disposed/);
  assert.equal(fake.requests.length, 1);
});

test('no word an app user may see says "410" or "gone"', () => {
  const words = [...Object.values(WORDS), METADATA_TOO_BIG];
  for (const call of ['start', 'send', 'press', 'upload', 'metadata', 'conversation'] as BlueCall[]) {
    for (const status of [400, 401, 403, 404, 409, 410, 413, 422, 429, 500, 502, 503]) {
      for (const code of [undefined, 'busy', 'needs_sign_in', 'too_many_files', 'invalid_attachment', 'day_limit', 'too_many_empty']) {
        words.push(refusalWords({ status, call, code, retryAfter: 900, fields: ['a'] }));
      }
    }
  }
  for (const text of [...words, ...Object.values(SETUP_WORDS), ...Object.values(CONSOLE_WORDS)]) {
    assert.doesNotMatch(text, /410|gone/i, text);
  }
});
