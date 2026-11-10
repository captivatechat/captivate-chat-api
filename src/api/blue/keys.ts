// Which path a key takes (first-channels-library-spec §2.1): anything shaped `vb?_` is one of
// Blue's keys, and everything else is a core key on today's path, so core's keys never reach here.

/** An app key: public, shipped in the app. */
const APP_KEY = /^vba_[0-9a-f]{24}$/;
/** A whole server key: a secret, on the app's own server only (server mode). */
const SERVER_KEY = /^vbk_[0-9a-f]{24}_[0-9a-f]{64}$/;

export type BlueKeyKind =
  /** `vba_<24 hex>`: app mode. */
  | 'app'
  /** A whole `vbk_<24 hex>_<64 hex>`: server mode. */
  | 'server'
  /** `vbk_` but not whole (cut short when copied, or the key's id alone). */
  | 'server-partial'
  /** `vbw_`: the website chat's, which works only in Blue's own chat window. */
  | 'website'
  /** Any other `vb?_`, or a `vba_` key of the wrong form. */
  | 'other';

/** True for every key shaped like one of Blue's (`vb` + a letter + `_`). */
export function isBlueKey(apiKey: unknown): boolean {
  return typeof apiKey === 'string' && /^vb[a-z]_/.test(apiKey);
}

/** The kind of a Blue key, or null for a core key. */
export function blueKeyKind(apiKey: unknown): BlueKeyKind | null {
  if (!isBlueKey(apiKey)) return null;
  const key = apiKey as string;
  if (APP_KEY.test(key)) return 'app';
  if (SERVER_KEY.test(key)) return 'server';
  if (key.startsWith('vbk_')) return 'server-partial';
  if (key.startsWith('vbw_')) return 'website';
  return 'other';
}

/**
 * A server user's ID, as X-Blue-User carries it: 1 to 128 visible ASCII characters, no spaces
 * (first-channels-server-key-spec §2.2). Checked before anything is sent.
 */
export const SERVER_USER_FORM = /^[\x21-\x7E]{1,128}$/;

/**
 * True where a server key must not run (server key spec §3.1): a page, a browser worker, React
 * Native or Electron. Not WorkerGlobalScope, which Cloudflare Workers define too; a scope with no
 * `process` (Workers without nodejs_compat) passes, as do Node, Deno and Bun.
 */
export function serverModeRefused(scope: any = globalThis): boolean {
  if (typeof scope.document !== 'undefined') return true;
  if (typeof scope.importScripts === 'function') return true;
  if (typeof scope.navigator !== 'undefined' && scope.navigator?.product === 'ReactNative') return true;
  return typeof scope.process !== 'undefined' && !!scope.process?.versions?.electron;
}

/** What a log line may name of a Blue key: its kind and id (`vbk_` and 24 hex), never its secret. */
export function keyIdOf(apiKey: string): string {
  return /^vb[a-z]_[0-9a-f]{24}/.exec(apiKey)?.[0] ?? `${apiKey.slice(0, 4)}…`;
}

/**
 * Keeps a key, Blue's or core's (or the address or socket holding it), out of what JSON.stringify
 * and console.log list of an object: a server that answers its own page with `res.json(handle)` must not send the key.
 * Still readable by name inside the library.
 */
export function hideFromJson(target: object, ...names: string[]): void {
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(target, name)) continue;
    Object.defineProperty(target, name, { enumerable: false, writable: true, configurable: true, value: (target as any)[name] });
  }
}
