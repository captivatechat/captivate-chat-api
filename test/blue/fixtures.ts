// The Blue-mode fixtures in test/fixtures/blue-mode: the backend's recordings (its
// scripts/blue-mode-fixtures.mjs, copied as recorded) and the hand-written cases beside them,
// named case-*, for what the backend's stub can't make. Beside each stream that ends, its
// <name>.callbacks.json: what an app's listeners get, which Vienna's suite reads too (dotnet own
// choice 110); `WRITE_CALLBACKS=1 npm test -- answer.test` writes them again. Read from the source
// tree, since the tests run from build-test/.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURES = join(__dirname, '..', '..', '..', 'test', 'fixtures', 'blue-mode');

/** Every stream's name, without .ndjson: the recordings and the hand-written cases. */
export function streamNames(): string[] {
  return readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.ndjson'))
    .map((name) => name.slice(0, -'.ndjson'.length))
    .sort();
}

/** The recordings alone. */
export function recordedNames(): string[] {
  return streamNames().filter((name) => !name.startsWith('case-'));
}

/** A stream's body as the backend sent it. */
export function streamOf(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.ndjson`), 'utf8');
}

/** A JSON file beside a stream: `<name>.read-back.json`, `<name>.press.json` or `<name>.callbacks.json`. */
export function jsonOf(file: string): any {
  return JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
}
