// npm run test:electron (after npm run build): server mode on plain Node, then the Electron harness
// on each Electron this folder's package.json pins, the newest stable and the oldest still
// supported upstream. Installs them here first when they aren't (each Electron fetches its binary
// the first time it is asked for its path); xvfb-run on Linux without a display. Exits 1 when any
// run failed.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ELECTRONS = ['electron', 'electron-oldest'];

if (!ELECTRONS.every((name) => existsSync(join(here, 'node_modules', name, 'package.json')))) {
  console.log('Installing the harness\'s Electrons…');
  const installed = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: here, stdio: 'inherit', shell: process.platform === 'win32' });
  if (installed.status !== 0) process.exit(installed.status ?? 1);
}

/** Runs a command, passing its output on; resolves its exit code. */
function run(command, args, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: here, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (piece) => process.stdout.write(piece));
    child.stderr.on('data', (piece) => process.stderr.write(piece));
    child.on('error', (error) => {
      console.log(`FAIL couldn't start ${command}: ${error.message}`);
      resolve(1);
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const failed = [];
if ((await run(process.execPath, [join(here, 'node-server-mode.js')])) !== 0) failed.push(`Node ${process.versions.node}, server mode`);

const require = createRequire(import.meta.url);
// Electron run as plain Node would never open a window.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
for (const name of ELECTRONS) {
  const binary = require(join(here, 'node_modules', name));
  const version = require(join(here, 'node_modules', name, 'package.json')).version;
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  const code = headless ? await run('xvfb-run', ['-a', binary, join(here, 'main.js')], env) : await run(binary, [join(here, 'main.js')], env);
  if (code !== 0) failed.push(`Electron ${version}`);
}

console.log(failed.length ? `Failed: ${failed.join(', ')}` : 'Every run passed.');
process.exit(failed.length ? 1 : 0);
