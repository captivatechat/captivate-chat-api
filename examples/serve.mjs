// Serves one of the web chat examples on localhost, with the library from ../dist.
//   node examples/serve.mjs chat-core     (http://localhost:5174)
//   node examples/serve.mjs chat-blue     (http://localhost:5173)
// The key is read when the server starts, from examples/<example>/.env, or from the file named in KEY_FILE.
// It is handed to the page in /config.js, since the library runs in the browser with it, and never logged.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXAMPLES = {
  'chat-core': { port: 5174, keyNames: ['CAPTIVATE_API_KEY', 'CORE_DEV_API_KEY'], mode: 'dev' },
  'chat-blue': { port: 5173, keyNames: ['BLUE_APP_KEY'], mode: 'dev' },
};

const here = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2];
const example = EXAMPLES[name];
if (!example) {
  console.error(`Say which example to serve: node examples/serve.mjs ${Object.keys(EXAMPLES).join(' | ')}`);
  process.exit(1);
}

function readKey() {
  const file = process.env.KEY_FILE || join(here, name, '.env');
  if (!existsSync(file)) return { file, key: '' };
  const values = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) values[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const found = example.keyNames.find((k) => values[k]);
  return { file, key: found ? values[found] : '', mode: values.MODE || '' };
}

const { file, key, mode } = readKey();
if (!key) {
  console.error(`No key found. Put ${example.keyNames[0]}=<your key> in ${file}, then start this again.`);
  process.exit(1);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const ROOTS = { '/lib/': join(here, '..', 'dist'), '/shared/': join(here, 'shared'), '/': join(here, name) };

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path === '/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
    res.end(`window.EXAMPLE_CONFIG = ${JSON.stringify({ key, mode: mode || example.mode })};`);
    return;
  }
  const prefix = Object.keys(ROOTS).find((p) => path.startsWith(p));
  const root = ROOTS[prefix];
  const target = normalize(join(root, path.slice(prefix.length) || 'index.html'));
  if (!target.startsWith(root) || target.endsWith('.env') || !existsSync(target) || !TYPES[extname(target)]) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(target)], 'Cache-Control': 'no-store' });
  res.end(readFileSync(target));
});

server.listen(example.port, '127.0.0.1', () => {
  console.log(`${name} is running: open http://localhost:${example.port} (Ctrl+C stops it)`);
});
