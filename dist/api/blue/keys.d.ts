export type BlueKeyKind = 
/** `vba_<24 hex>`: app mode. */
'app'
/** A whole `vbk_<24 hex>_<64 hex>`: server mode. */
 | 'server'
/** `vbk_` but not whole (cut short when copied, or the key's id alone). */
 | 'server-partial'
/** `vbw_`: the website chat's, which works only in Blue's own chat window. */
 | 'website'
/** Any other `vb?_`, or a `vba_` key of the wrong form. */
 | 'other';
/** True for every key shaped like one of Blue's (`vb` + a letter + `_`). */
export declare function isBlueKey(apiKey: unknown): boolean;
/** The kind of a Blue key, or null for a core key. */
export declare function blueKeyKind(apiKey: unknown): BlueKeyKind | null;
/**
 * A server user's ID, as X-Blue-User carries it: 1 to 128 visible ASCII characters, no spaces
 * (first-channels-server-key-spec §2.2). Checked before anything is sent.
 */
export declare const SERVER_USER_FORM: RegExp;
/**
 * True where a server key must not run (server key spec §3.1): a page, a browser worker, React
 * Native or Electron. Not WorkerGlobalScope, which Cloudflare Workers define too; a scope with no
 * `process` (Workers without nodejs_compat) passes, as do Node, Deno and Bun.
 */
export declare function serverModeRefused(scope?: any): boolean;
/** What a log line may name of a Blue key: its kind and id (`vbk_` and 24 hex), never its secret. */
export declare function keyIdOf(apiKey: string): string;
/**
 * Keeps a Blue key (or the address holding it) out of what JSON.stringify and console.log list of
 * an object: a server that answers its own page with `res.json(handle)` must not send the key.
 * Still readable by name inside the library.
 */
export declare function hideFromJson(target: object, ...names: string[]): void;
