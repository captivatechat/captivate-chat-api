// The words of Blue mode (first-channels-library-spec §1.2). App users see WORDS, through
// errorDesc and onMessage's "[Error: …]"; the backend's own words never pass through, so none
// can say "410" or "gone", which apps on 7.0 read as "send it again". SETUP_WORDS and
// CONSOLE_WORDS are the developer's.

/** What an app user may see, fixed. */
export const WORDS = {
  /** A cut stream whose message was never stored: safe to send again. */
  didntGoThrough: "Your message didn't go through. Send it again.",
  /** 409 `busy`, once the hold ran out. */
  busy: 'This conversation is still answering. Try again in a moment.',
  /** 409 `needs_sign_in` on a press. */
  signInAgain: 'Sign in again in the app, then try once more.',
  /** Any other 409 on a press (the form closed, look-ups switched off). */
  notAnyMore: "This can't be done any more. Ask again in the chat.",
  /** 400 `too_many_files`. */
  tooManyFiles: "This conversation can't take more files. Start a new conversation to send more.",
  /** 400 on a press with the body's `error.fields`. */
  formRefused: "That form can't be sent like that. Check it and try again.",
  /** 429 on a press. */
  sentTooOften: "You've sent this a few times already. Please try again later.",
  /** 400 `invalid_attachment` on a send. */
  fileNotFound: "A file you attached couldn't be found. Attach it again and send your message.",
  /** 413 on a send with files. */
  fileTooBig:
    'That file is too big for the assistant to look at. Send a smaller picture or PDF, or paste the part that matters as text.',
  /** Any other 400, or 413, on a send. */
  shortenIt: "That message couldn't be sent as it is. Shorten it and send it again.",
  /** 429 on a send or a start past the key's day (decision 3 (d)). */
  dayOfAnswers: 'This chat has answered all it can for today. Please try again tomorrow.',
  /** 429 on an upload past the key's day of files. */
  dayOfFiles: "This chat can't take more files today. You can still type your question.",
  /** 429 `too_many_empty` on a start (gaps G7: apps own choice 8's words). */
  tooManyNew: 'Too many new conversations at once. Send a message in one first.',
  /** Any other 429. */
  tooMany: 'Too many messages just now. Try again in a minute.',
  /** 404 on a conversation. */
  conversationGone: "This conversation isn't available any more. Start a new one.",
  /** 401, or any 403. */
  cantReach: "This app can't reach its assistant right now.",
  /** 500, 503, unreachable, an `error` event, a call or a follow past its time. */
  couldntAnswer: "The assistant couldn't answer just now. Please try again.",
} as const;

const MAKE_A_KEY = 'Make a key for your app on the Channels page.';

/** Thrown at setup, for the developer. */
export const SETUP_WORDS = {
  websiteKey: `Website keys work only in Blue's own chat window. ${MAKE_A_KEY}`,
  notForApps: `This key isn't for apps. ${MAKE_A_KEY}`,
  // first-channels-server-key-spec §3.3.
  serverKeyInApp:
    'Server keys work only on your own server, never in an app or a web page. Make a key for your app on the Channels page, and if this key was ever in an app or a page, get a new one there.',
  serverKeyNotWhole: "This server key isn't whole. Copy it again from the Channels page.",
  noRandomSource: 'Blue mode needs a secure random source here. Add one, or pass options.randomValues.',
  userSecretForm: 'options.userSecret must give a secret of 43 to 128 letters, digits, - or _ (base64url).',
  /** A handle from getConversation(id) whose user nothing on this device knows: each call refuses. */
  userUnknown: "This conversation's user isn't known on this device. List the user's conversations first.",
  /** CaptivateChatManager merges lists on core's server, which knows no Blue key. */
  managerBlueKey: "Use one CaptivateChatAPI for each app key. CaptivateChatManager is for Captivate's own keys.",
  /** sendAction's send on a link offer (gaps G5): a link opens in the browser. */
  linkOffer: "This offer is a link: open its link.url in the browser. There's nothing to send.",
} as const;

/** What Blue mode doesn't do: thrown as an Error with status 501. */
export const NOT_HERE = {
  shorterTimeToLive: "Files sent in a chat are kept with it for 90 days here. A shorter time isn't available.",
  // first-channels-dotnet-spec §1.2's words, offered to this library too (dotnet own choice 85).
  longerTimeToLive: "Files sent in a chat are kept with it for 90 days here. A longer time isn't available.",
  editing: "Editing a message isn't available here.",
} as const;

/** Written to the console once, for the developer. */
export const CONSOLE_WORDS = {
  keyRefused:
    'The key was refused. Check it is a key for your app, turned on, and that this address is listed on it.',
  noWebAddress:
    "This app's pages aren't on a web address, so the key can't check where they are. Use the library from the app's main process, or register the app's own scheme and list its address on the key.",
  // dotnet own choice 85's words, warned once.
  listFilters: "Blue mode lists a user's conversations newest first, without filters or searches, so those were left out.",
  privateMetadata: "Blue mode doesn't keep private metadata, so it wasn't sent.",
  notAnOffer: "That action isn't one of the bot's forms, so nothing was sent.",
  // §2.7's, Blue's loader's (its userOf) without the name of the call, since the metadata may be createConversation's.
  userId: "user_id must be letters, digits and - _ . : (at most 64), so the chat goes on without knowing who's signed in.",
  userToken: "user_token isn't a token the chat can use, so it goes on without knowing who's signed in.",
  // gaps G12: a detail over 200 characters is dropped.
  detailTooLong: "A detail the bot reads was over 200 characters, so it wasn't sent.",
} as const;

/** What a call was, since the same status reads differently on a send, a press or an upload. */
export type BlueCall = 'start' | 'send' | 'press' | 'upload' | 'metadata' | 'conversation';

/** Past this many seconds a 429's Retry-After is a day's cap, as Blue's own window reads it. */
const DAY_CAP_SECONDS = 600;

/** The 4 KB words, which a metadata PATCH's 413 gives too (gaps G10). */
export const METADATA_TOO_BIG = 'Blue keeps at most 4 KB of metadata with a conversation. Keep less in it.';

/**
 * The app user's words for a refusal: told by its status and the body's `error.code`, a
 * press's 400 by its `error.fields`, a 429 by `day_limit` (gaps G8) and then its Retry-After.
 */
export function refusalWords(refusal: {
  status: number;
  call: BlueCall;
  code?: string;
  fields?: string[];
  retryAfter?: number;
  /** A send with files, for its 413. */
  withFiles?: boolean;
}): string {
  const { status, call, code } = refusal;
  if (status === 401 || status === 403) return WORDS.cantReach;
  if (status === 404) return WORDS.conversationGone;
  if (status === 409) {
    if (code === 'busy') return WORDS.busy;
    if (call === 'press') return code === 'needs_sign_in' ? WORDS.signInAgain : WORDS.notAnyMore;
    return WORDS.couldntAnswer;
  }
  if (status === 429) {
    const dayCap = code === 'day_limit' || (refusal.retryAfter ?? 0) > DAY_CAP_SECONDS;
    if (call === 'press') return WORDS.sentTooOften;
    if (call === 'start' && code === 'too_many_empty') return WORDS.tooManyNew;
    if (dayCap && (call === 'send' || call === 'start')) return WORDS.dayOfAnswers;
    if (dayCap && call === 'upload') return WORDS.dayOfFiles;
    return WORDS.tooMany;
  }
  if (status === 400 && code === 'too_many_files') return WORDS.tooManyFiles;
  if (status === 413 && call === 'metadata') return METADATA_TOO_BIG;
  if (call === 'press' && status === 400 && refusal.fields?.length) return WORDS.formRefused;
  if (call === 'send' && (status === 400 || status === 413)) {
    if (status === 400 && code === 'invalid_attachment') return WORDS.fileNotFound;
    if (status === 413 && refusal.withFiles) return WORDS.fileTooBig;
    return WORDS.shortenIt;
  }
  return WORDS.couldntAnswer;
}
