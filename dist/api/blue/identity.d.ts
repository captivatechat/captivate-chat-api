/** The backend's USER_ID_FORM (its LOOKUP_SLOT): an email address is outside it. */
export declare const USER_ID_FORM: RegExp;
/** The backend drops a user whose token is longer (gaps G11: 2,048 in both libraries and Blue's loader). */
export declare const TOKEN_MAX_CHARS = 2048;
/** A detail's value, at most (the backend's APP_DETAIL_MAX_CHARS); a longer one is dropped (gaps G12). */
export declare const DETAIL_MAX_CHARS = 200;
/** Sent as the body's `user`: `{ id: null }` when no one is signed in. */
export type BlueUser = {
    id: string;
    token?: string;
} | {
    id: null;
};
/** A console warning, once per instance (the transport's warnOnce). */
type WarnOnce = (name: string, words: string) => void;
/**
 * The customer a call's metadata names, or undefined when it names no `user_id` (nothing to
 * change). `user_id: null` is a sign-out; an ID outside USER_ID_FORM, or a token that isn't a
 * non-empty string of at most 2,048 characters, is no one, with a warning, since the backend
 * would drop such a user whole. In server mode a token is never sent (first-channels-server-key-spec
 * §2.6, K-D2 (c)): the server's word names the customer, so one given is left out, with one warning.
 */
export declare function customerOf(metadata: unknown, warnOnce: WarnOnce, serverMode?: boolean): BlueUser | undefined;
/**
 * The details to send with a message or a press: only the names the backend lists for the bot
 * (the names its look-ups read), each from the metadata's top level when it is text or a finite
 * number, at most 200 characters (a longer one dropped, with one warning). Never `user_id` or
 * `user_token`. Undefined when there are none.
 */
export declare function detailsOf(given: Record<string, unknown>, names: readonly string[] | null, warnOnce: WarnOnce): Record<string, string> | undefined;
export {};
