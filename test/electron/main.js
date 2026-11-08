// The Electron harness (first-channels-library-spec §5, L7; §2.10): the built library against the
// fixtures' replay on 127.0.0.1, checked (a) in the main process with Node's fetch and with
// net.fetch, (b) in a hidden window on http://127.0.0.1, (c) on a file:// page, (d) on a page of a
// registered app:// scheme, and (e) a server key in the main process. Pages report over IPC; the
// harness prints a line a check and exits 0 only when every check passed.
const { app, BrowserWindow, ipcMain, net, protocol } = require('electron');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { startReplay, fixtureNames, expectedOf, differenceOf, draftsOf, ROOT } = require('./replay');
const { runAll } = require('./page');

const APP_ORIGIN = 'app://myapp';
const PAGE = 'test/electron/page.html';
const REPORT_MS = 120000;
// src/api/blue/words.ts's, exactly.
const SERVER_KEY_IN_APP =
  'Server keys work only on your own server, never in an app or a web page. Make a key for your app on the Channels page, and if this key was ever in an app or a page, get a new one there.';
const NO_WEB_ADDRESS =
  "This app's pages aren't on a web address, so the key can't check where they are. Use the library from the app's main process, or register the app's own scheme and list its address on the key.";
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const SERVED = new Set([PAGE, 'test/electron/page.js', 'dist/captivate-chat-api.js']);

// Decision 16 (c): a packaged app's own scheme, as the README tells developers to register it.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
app.disableHardwareAcceleration();

/** An app key of its own for each check, so the replay tells their requests apart. */
const appKey = (n) => `vba_${n.toString(16).padStart(24, '0')}`;
const fixtures = fixtureNames().map((name) => ({ name, count: expectedOf(name).filter((c) => c.listener !== 'onDelta').length }));
const outcomes = [];

function check(name, problems) {
  outcomes.push({ name, problems });
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}${problems.length ? `\n       ${problems.join('\n       ')}` : ''}`);
}

/**
 * What went wrong in a run of every fixture: a missing one, a rejection, calls that differ, or no
 * draft at all (the answer read whole).
 */
function resultProblems(results) {
  const problems = [];
  const drafts = draftsOf(results);
  if (drafts.got === 0) problems.push(`no drafts (${drafts.expected} in the fixtures)`);
  for (const { name } of fixtures) {
    const result = results && results[name];
    if (!result) problems.push(`${name}: not run`);
    else if (result.rejected) problems.push(`${name}: sendMessage rejected: ${result.rejected}`);
    else {
      const difference = differenceOf(name, result.calls);
      if (difference) problems.push(difference);
    }
  }
  return problems;
}

/** The Origins the replay saw on a key's calls to /v1/chat routes. */
function originsOf(replay, key) {
  const id = key.slice(0, 28);
  return [...new Set(replay.seen.filter((r) => r.keyId === id && r.path.startsWith('/v1/chat') && r.method !== 'OPTIONS').map((r) => r.origin))];
}

/** "(drafts 9 of 11)": a draft less than the fixtures' is two lines that came in one chunk. */
function draftWords(results) {
  const { got, expected } = draftsOf(results);
  return ` (drafts ${got} of ${expected})`;
}

const tasks = new Map();
const reports = new Map();

/** Opens a hidden window on `url` with its task, and resolves its report. */
function pageReport(load, task) {
  return new Promise((resolve) => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: { preload: join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true },
    });
    const id = window.webContents.id;
    tasks.set(id, task);
    const timer = setTimeout(() => finish({ crashes: [`no report within ${REPORT_MS / 1000} s`] }), REPORT_MS);
    function finish(report) {
      clearTimeout(timer);
      reports.delete(id);
      tasks.delete(id);
      if (!window.isDestroyed()) window.destroy();
      resolve(report);
    }
    reports.set(id, finish);
    window.webContents.on('render-process-gone', (_, details) => finish({ crashes: [`renderer gone: ${details.reason}`] }));
    load(window).catch((error) => finish({ crashes: [`didn't load: ${error.message}`] }));
  });
}

ipcMain.handle('harness:task', (event) => tasks.get(event.sender.id));
ipcMain.on('harness:report', (event, report) => reports.get(event.sender.id)?.(report));

async function main() {
  console.log(`Electron ${process.versions.electron} (Chromium ${process.versions.chrome}, Node ${process.versions.node}): ${fixtures.length} fixtures`);
  const replay = await startReplay();
  // The library as apps get it: dist, built by npm run test:electron first.
  const { CaptivateChatAPI } = require(join(ROOT, 'dist', 'captivate-chat-api.js'));

  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '');
    if (url.host !== 'myapp' || !SERVED.has(path)) return new Response('Not found', { status: 404 });
    return new Response(readFileSync(join(ROOT, path)), { headers: { 'Content-Type': TYPES[path.slice(path.lastIndexOf('.'))] } });
  });

  // (a) The main process: Node's fetch, then Electron's net.fetch passed as options.fetch.
  for (const [n, label, options] of [
    [0xa1, "main process, Node's fetch", {}],
    [0xa2, 'main process, net.fetch', { fetch: (url, init) => net.fetch(url, init) }],
  ]) {
    const key = appKey(n);
    const problems = [];
    let draftLine = '';
    try {
      const api = await CaptivateChatAPI.create(key, 'prod', { blueUrl: replay.url, ...options });
      const results = await runAll(api, fixtures, 'main-user');
      draftLine = draftWords(results);
      problems.push(...resultProblems(results));
      api.dispose();
    } catch (error) {
      problems.push(`crashed: ${error.message}`);
    }
    const origins = originsOf(replay, key);
    if (origins.length !== 1 || origins[0] !== null) problems.push(`an Origin was sent: ${JSON.stringify(origins)}`);
    check(`(a) ${label}: drafts and the final answer, no Origin${draftLine}`, problems);
  }

  // (b) A hidden window on the replay's own http address.
  {
    const key = appKey(0xb1);
    const report = await pageReport((w) => w.loadURL(`${replay.url}/${PAGE}`), { check: 'b', key, blueUrl: replay.url, fixtures });
    const problems = [...(report.crashes || []), ...resultProblems(report.results)];
    const origins = originsOf(replay, key);
    if (origins.length !== 1 || origins[0] !== replay.url) problems.push(`Origin sent: ${JSON.stringify(origins)}, expected ${replay.url}`);
    if ((report.warnings || []).length) problems.push(`warned: ${report.warnings.join(' | ')}`);
    check(`(b) a window on http://127.0.0.1: drafts in the renderer, its address as Origin${draftWords(report.results)}`, problems);
  }

  // (c) A file:// page: the one warning, and no crash.
  {
    const report = await pageReport((w) => w.loadFile(join(ROOT, PAGE)), { check: 'c', key: appKey(0xc1), blueUrl: replay.url, fixtures: [] });
    const problems = [...(report.crashes || [])];
    if (report.protocol !== 'file:') problems.push(`the page was on ${report.protocol}`);
    const warned = (report.warnings || []).filter((w) => w.includes(NO_WEB_ADDRESS)).length;
    if (warned !== 1) problems.push(`warned ${warned} times, expected once: ${JSON.stringify(report.warnings)}`);
    check('(c) a file:// page: the warning once, no crash', problems);
  }

  // (d) A page on the registered app:// scheme: its Origin sent, through the preflight, and drafts.
  {
    const key = appKey(0xd1);
    const report = await pageReport((w) => w.loadURL(`${APP_ORIGIN}/${PAGE}`), { check: 'd', key, blueUrl: replay.url, fixtures });
    const problems = [...(report.crashes || []), ...resultProblems(report.results)];
    if (report.origin !== APP_ORIGIN) problems.push(`the page's origin was ${report.origin}`);
    const origins = originsOf(replay, key);
    if (origins.length !== 1 || origins[0] !== APP_ORIGIN) problems.push(`Origin sent: ${JSON.stringify(origins)}, expected ${APP_ORIGIN}`);
    const preflights = replay.seen.filter((r) => r.method === 'OPTIONS' && r.origin === APP_ORIGIN).length;
    if (preflights === 0) problems.push('no preflight came from app://myapp');
    if ((report.warnings || []).length) problems.push(`warned: ${report.warnings.join(' | ')}`);
    check(`(d) a page on ${APP_ORIGIN}: its Origin sent, drafts in the renderer${draftWords(report.results)}`, problems);
  }

  // (e) A whole server key in the main process: refused in the server key spec's §3.3 words.
  {
    const key = `vbk_${'e1'.padStart(24, '0')}_${'ab'.repeat(32)}`;
    const problems = [];
    try {
      const api = await CaptivateChatAPI.create(key, 'prod', { blueUrl: replay.url });
      api.dispose();
      problems.push('the server key was taken');
    } catch (error) {
      if (error.message !== SERVER_KEY_IN_APP) problems.push(`refused in other words: ${error.message}`);
    }
    if (CaptivateChatAPI.hasInstance(key, 'prod')) problems.push('the refused key was kept');
    if (replay.seen.some((r) => r.keyId === key.slice(0, 28))) problems.push('a call was made with it');
    check('(e) a server key in the main process: refused in its words', problems);
  }

  await replay.close();
  const failed = outcomes.filter((o) => o.problems.length).length;
  console.log(`Electron ${process.versions.electron}: ${outcomes.length - failed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

app.on('window-all-closed', () => {
  // The harness ends itself with its exit code; closing its windows mustn't quit it first.
});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.log(`FAIL the harness itself: ${(error && error.stack) || error}`);
    return 1;
  })
  .then((code) => app.exit(code));
