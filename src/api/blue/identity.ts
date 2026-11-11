// Who the customer is, and the app's details (first-channels-library-spec §2.7; gaps G11, G12):
// the website's rule carried over. `user_id` and `user_token` are read from the conversation's
// metadata as Blue's loader reads its setMetadata (its userOf), and go as `user: { id, token? }`
// with every send and press; the details the bot's look-ups read go as `details`. Both are held in
// memory only: never stored, never PATCHed, never logged.
import { CONSOLE_WORDS } from './words';

/** The backend's USER_ID_FORM (its LOOKUP_SLOT): an email address is outside it. */
export const USER_ID_FORM = /^[A-Za-z0-9_.:-]{1,64}$/;
/** The backend drops a user whose token is longer (gaps G11: 2,048 in both libraries and Blue's loader). */
export const TOKEN_MAX_CHARS = 2048;
/** A detail's value, at most (the backend's APP_DETAIL_MAX_CHARS); a longer one is dropped (gaps G12). */
export const DETAIL_MAX_CHARS = 200;

/** Sent as the body's `user`: `{ id: null }` when no one is signed in. */
export type BlueUser = { id: string; token?: string } | { id: null };

/** A console warning, once per instance (the transport's warnOnce). */
type WarnOnce = (name: string, words: string) => void;

/**
 * The customer a call's metadata names, or undefined when it names no `user_id` (nothing to
 * change). `user_id: null` is a sign-out; an ID outside USER_ID_FORM, or a token that isn't a
 * non-empty string of at most 2,048 characters, is no one, with a warning, since the backend
 * would drop such a user whole. In server mode a token is never sent (first-channels-server-key-spec
 * §2.6, K-D2 (c)): the server's word names the customer, so one given is left out, with one warning.
 */
export function customerOf(metadata: unknown, warnOnce: WarnOnce, serverMode = false): BlueUser | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const { user_id: id, user_token: token } = metadata as { user_id?: unknown; user_token?: unknown };
  if (serverMode && token !== undefined && token !== null) warnOnce('serverNoUserToken', CONSOLE_WORDS.serverNoUserToken);
  if (!('user_id' in metadata)) return undefined;
  if (id === null) return { id: null };
  if (typeof id !== 'string' || !USER_ID_FORM.test(id)) {
    warnOnce('userId', CONSOLE_WORDS.userId);
    return { id: null };
  }
  if (token === undefined || serverMode) return { id };
  if (typeof token !== 'string' || !token || token.length > TOKEN_MAX_CHARS) {
    warnOnce('userToken', CONSOLE_WORDS.userToken);
    return { id: null };
  }
  return { id, token };
}

/**
 * The details to send with a message or a press: only the names the backend lists for the bot
 * (the names its look-ups read), each from the metadata's top level when it is text or a finite
 * number, at most 200 characters (a longer one dropped, with one warning). Never `user_id` or
 * `user_token`. Undefined when there are none.
 */
export function detailsOf(
  given: Record<string, unknown>,
  names: readonly string[] | null,
  warnOnce: WarnOnce
): Record<string, string> | undefined {
  if (!names?.length) return undefined;
  const details: Record<string, string> = {};
  let count = 0;
  for (const name of names) {
    if (name === 'user_id' || name === 'user_token' || !Object.prototype.hasOwnProperty.call(given, name)) continue;
    const value = given[name];
    const text = typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
    if (text === null) continue;
    if (text.length > DETAIL_MAX_CHARS) {
      warnOnce('detailTooLong', CONSOLE_WORDS.detailTooLong);
      continue;
    }
    details[name] = text;
    count += 1;
  }
  return count ? details : undefined;
}
