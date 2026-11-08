// A stand-in for Blue's /v1/chat on 127.0.0.1, for the Electron harness and the plain Node run
// (first-channels-library-spec §5, L7): it starts conversations and replays the fixtures in
// test/fixtures/blue-mode one line a network chunk, answers CORS as Blue's backend does for a
// listed address, serves the harness page and the built library, and keeps what each request
// carried (its Origin, its key's id, whether it named a user or a secret) for the checks.
const { createServer } = require('node:http');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const FIXTURES = join(ROOT, 'test', 'fixtures', 'blue-mode');
/** Lines this far apart, so each mostly reaches the library as a network chunk of its own. */
const LINE_GAP_MS = 100;
/** The only files the server gives out: the page, its script and the built library. */
const FILES = {
  '/test/electron/page.html': 'text/html; charset=utf-8',
  '/test/electron/page.js': 'text/javascript; charset=utf-8',
  '/dist/captivate-chat-api.js': 'text/javascript; charset=utf-8',
};

/** The fixtures that end, each with what an app's listeners get beside it. */
function fixtureNames() {
  return readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.callbacks.json'))
    .map((name) => name.slice(0, -'.callbacks.json'.length))
    .sort();
}

const streamOf = (name) => readFileSync(join(FIXTURES, `${name}.ndjson`), 'utf8');
const expectedOf = (name) => JSON.parse(readFileSync(join(FIXTURES, `${name}.callbacks.json`), 'utf8')).calls;
const conversationOf = (name) => JSON.parse(streamOf(name).split('\n').find((l) => l.trim())).conversationId;
/** Each line of a stream, its newline kept; the last may have none. */
const linesOf = (text) => text.split(/(?<=\n)/).filter((piece) => piece !== '');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Blue-Conversation, X-Blue-User',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function readJson(req) {
  return new Promise((resolve) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (piece) => (text += piece));
    req.on('end', () => {
      try {
        resolve(JSON.parse(text || '{}'));
      } catch (_) {
        resolve({});
      }
    });
  });
}

/** Starts the replay on a free port; resolves `{ url, seen, close }`. */
function startReplay() {
  /** What each request carried: never a key's secret, a user's ID or a secret's value. */
  const seen = [];
  const server = createServer(async (req, res) => {
    const path = (req.url || '/').split('?')[0];
    const cors = corsHeaders(req);
    const auth = /^Bearer (vb[a-z]_[0-9a-f]{24})/.exec(req.headers.authorization || '');
    const record = {
      method: req.method,
      path,
      origin: req.headers.origin === undefined ? null : req.headers.origin,
      keyId: auth ? auth[1] : null,
      user: req.headers['x-blue-user'] === undefined ? null : req.headers['x-blue-user'],
      secret: req.headers['x-blue-conversation'] !== undefined,
    };
    seen.push(record);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }
    if (req.method === 'GET' && FILES[path]) {
      res.writeHead(200, { 'Content-Type': FILES[path], 'Cache-Control': 'no-store', ...cors });
      return res.end(readFileSync(join(ROOT, path)));
    }
    if (req.method === 'POST' && path === '/v1/chat/conversations') {
      const body = await readJson(req);
      const name = body && body.metadata && body.metadata.fixture;
      if (!fixtureNames().includes(name)) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...cors });
        return res.end(JSON.stringify({ error: { code: 'bad_request', message: 'No such fixture.' } }));
      }
      res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8', ...cors });
      return res.end(JSON.stringify({ conversationId: conversationOf(name), greeting: null, details: [] }));
    }
    if (req.method === 'POST' && path === '/v1/chat') {
      const body = await readJson(req);
      record.message = body.message;
      record.conversationId = body.conversationId;
      if (!fixtureNames().includes(body.message)) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...cors });
        return res.end(JSON.stringify({ error: { code: 'bad_request', message: 'No such fixture.' } }));
      }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', ...cors });
      for (const line of linesOf(streamOf(body.message))) {
        if (res.destroyed) return;
        res.write(line);
        await sleep(LINE_GAP_MS);
      }
      return res.end();
    }
    res.writeHead(404, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } }));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        seen,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

/**
 * Where a fixture's calls differ from its callbacks file, or null. The file is what an app gets
 * reading one line a network chunk; a real network may still bring two lines in one chunk, which
 * gives one draft (the later) or none, so a run may leave out drafts but nothing else.
 */
function differenceOf(name, calls) {
  const expected = expectedOf(name);
  let at = 0;
  for (const call of calls) {
    const same = (e) => JSON.stringify(e) === JSON.stringify(call);
    while (at < expected.length && !same(expected[at]) && expected[at].listener === 'onDelta') at += 1;
    if (at === expected.length || !same(expected[at])) {
      return `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(calls)}`;
    }
    at += 1;
  }
  const left = expected.slice(at).filter((e) => e.listener !== 'onDelta');
  return left.length ? `${name}: missing ${JSON.stringify(left)}, got ${JSON.stringify(calls)}` : null;
}

/** How many drafts a run's results got, against the callbacks files' count. */
function draftsOf(results) {
  let got = 0;
  let expected = 0;
  for (const name of Object.keys(results || {})) {
    got += results[name].calls.filter((c) => c.listener === 'onDelta').length;
    expected += expectedOf(name).filter((c) => c.listener === 'onDelta').length;
  }
  return { got, expected };
}

module.exports = { startReplay, fixtureNames, expectedOf, differenceOf, draftsOf, ROOT };
