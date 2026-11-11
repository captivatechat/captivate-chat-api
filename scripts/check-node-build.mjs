// Run by `npm run build` after webpack: the package as Node loads it (package.json's "main") must
// open core's socket with the installed `ws` where Node has no WebSocket of its own (Node 20).
// The web build bundles ws's browser stub, which throws "ws does not work in the browser" there,
// and 7.0.0 shipped that build as "main". No network: `ws` is replaced in Node's module cache by
// a socket that answers socket_connected, and global WebSocket (Node 22 and later) is taken away.
// It also imports the same file as an ES module: `import { CaptivateChatAPI } from 'captivate-chat-api'`
// in a .mjs file or a "type": "module" app needs the build's exports to be ones Node can see by name.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));

delete globalThis.WebSocket;

const opened = [];
class CheckSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url) {
    this.url = url;
    this.readyState = CheckSocket.CONNECTING;
    this.listeners = new Map();
    opened.push(this);
    setTimeout(() => {
      this.readyState = CheckSocket.OPEN;
      this.emit('open', {});
      this.emit('message', { data: JSON.stringify({ event: { event_type: 'socket_connected', event_payload: { socket_id: 'check-1' } } }) });
    }, 0);
  }
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener));
  }
  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  send() {}
  close() {
    this.readyState = CheckSocket.CLOSED;
  }
}

function fail(words) {
  console.error(`check-node-build: ${words}`);
  process.exit(1);
}

const wsPath = require.resolve('ws');
if (/browser\.js$/.test(wsPath)) fail(`Node resolves ws to its browser stub (${wsPath}).`);
require.cache[wsPath] = { id: wsPath, filename: wsPath, loaded: true, exports: CheckSocket };

const main = require.resolve(root);
if (!main.endsWith(join('dist', 'captivate-chat-api.node.js'))) fail(`package.json's "main" is ${main}, not the Node build.`);
const { CaptivateChatAPI } = require(root);

const esm = await import(pathToFileURL(main).href).catch((error) => fail(`import() of the Node build failed: ${error?.message ?? error}`));
for (const name of ['CaptivateChatAPI', 'CaptivateChatManager', 'CaptivateChatFileManager', 'isBlueKey', 'renumber']) {
  if (typeof esm[name] !== 'function') fail(`import { ${name} } from the Node build gave ${typeof esm[name]}, not a function: ESM apps can't use the package by name.`);
}
if (esm.CaptivateChatAPI !== CaptivateChatAPI) fail('import() and require() give two different CaptivateChatAPI classes.');

const api = new CaptivateChatAPI('check-node-build-key-0000', 'dev', { connectTimeoutMs: 2000, maxReconnectAttempts: 0 });
try {
  await api.connect();
} catch (error) {
  fail(`core mode did not connect without a global WebSocket: ${error?.message ?? error}`);
}
if (opened.length !== 1) fail(`expected one socket through the installed ws, saw ${opened.length}.`);
if (!api.isSocketActive()) fail('the socket is not active after socket_connected.');
api.dispose();
console.log('check-node-build: the Node build opens core\'s socket with the installed ws, by require() and by import.');
