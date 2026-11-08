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
