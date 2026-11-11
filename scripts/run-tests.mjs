// npm test: builds test/**/*.test.ts with tsconfig.test.json into build-test/, then runs
// node --test on the files it lists by name, since Node 20's --test takes no glob and
// neither does Windows' shell. Arguments narrow the run to files whose path holds them:
// `npm test -- core-path`.
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'build-test');
// The Electron harness has its own package.json and its own run (npm run test:electron).
const SKIP = new Set(['electron', 'fakes', 'fixtures']);

function testFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP.has(name)) found.push(...testFiles(path));
    } else if (name.endsWith('.test.ts')) {
      found.push(path);
    }
  }
  return found;
}

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

rmSync(out, { recursive: true, force: true });
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const built = run([tsc, '-p', join(root, 'tsconfig.test.json')]);
if (built !== 0) {
  console.error('The tests did not build: see the errors above.');
  process.exit(built);
}

const filters = process.argv.slice(2);
const files = testFiles(join(root, 'test'))
  .map((file) => relative(root, file))
  .filter((file) => filters.length === 0 || filters.some((f) => file.includes(f)))
  .map((file) => join(out, file.replace(/\.ts$/, '.js')));

if (files.length === 0) {
  console.error(filters.length ? `No test file matches ${filters.join(', ')}.` : 'No test files found under test/.');
  process.exit(1);
}

console.log(`Running ${files.length} test file(s): ${files.map((f) => relative(out, f).split(sep).join('/')).join(', ')}`);
// Each file runs in its own process, so each gets a fresh CaptivateChatAPI registry and
// its own fake WebSocket. The timeout keeps a hung test from holding the run.
process.exit(run(['--test', '--test-timeout=30000', ...files]));
