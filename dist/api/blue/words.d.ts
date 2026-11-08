/** What an app user may see, fixed. */
export declare const WORDS: {
    /** A cut stream whose message was never stored: safe to send again. */
    readonly didntGoThrough: "Your message didn't go through. Send it again.";
    /** 409 `busy`, once the hold ran out. */
    readonly busy: "This conversation is still answering. Try again in a moment.";
    /** 409 `needs_sign_in` on a press. */
    readonly signInAgain: "Sign in again in the app, then try once more.";
    /** Any other 409 on a press (the form closed, look-ups switched off). */
    readonly notAnyMore: "This can't be done any more. Ask again in the chat.";
    /** 400 `too_many_files`. */
    readonly tooManyFiles: "This conversation can't take more files. Start a new conversation to send more.";
    /** 400 on a press with the body's `error.fields`. */
    readonly formRefused: "That form can't be sent like that. Check it and try again.";
    /** 429 on a press. */
    readonly sentTooOften: "You've sent this a few times already. Please try again later.";
    /** 400 `invalid_attachment` on a send. */
    readonly fileNotFound: "A file you attached couldn't be found. Attach it again and send your message.";
    /** 413 on a send with files. */
    readonly fileTooBig: "That file is too big for the assistant to look at. Send a smaller picture or PDF, or paste the part that matters as text.";
    /** A file whose type Blue can't read: the backend's `unsupported_type` sentence (gaps G14). */
    readonly fileType: "I can read pictures (PNG, JPG or WebP), PDFs, Word, Excel and PowerPoint files, and text, Markdown and CSV files.";
    /** A file over 20 MB: the backend's 413 sentence for an upload (gaps G14). */
    readonly fileOver20MB: "A file can be at most 20 MB.";
    /** More than 5 files with one message: Blue's window's words (gaps G14). */
    readonly filesPerMessage: "You can send up to 5 files with one message.";
    /** Core's `storage: false`, a file referenced by its URL (§2.9). */
    readonly cantSendFiles: "This app can't send files.";
    /** Any other 400, or 413, on a send. */
    readonly shortenIt: "That message couldn't be sent as it is. Shorten it and send it again.";
    /** 429 on a send or a start past the key's day (decision 3 (d)). */
    readonly dayOfAnswers: "This chat has answered all it can for today. Please try again tomorrow.";
    /** 429 on an upload past the key's day of files. */
    readonly dayOfFiles: "This chat can't take more files today. You can still type your question.";
    /** 429 on a delete past the server key's day of deletes (first-channels-server-key-spec §3.3). */
    readonly deletesDay: "No more conversations can be deleted today. Please try again tomorrow.";
    /** 429 `too_many_empty` on a start (gaps G7: apps own choice 8's words). */
    readonly tooManyNew: "Too many new conversations at once. Send a message in one first.";
    /** Any other 429. */
    readonly tooMany: "Too many messages just now. Try again in a minute.";
    /** 404 on a conversation. */
    readonly conversationGone: "This conversation isn't available any more. Start a new one.";
    /** 401, or any 403. */
    readonly cantReach: "This app can't reach its assistant right now.";
    /** 500, 503, unreachable, an `error` event, a call or a follow past its time. */
    readonly couldntAnswer: "The assistant couldn't answer just now. Please try again.";
};
/** Thrown at setup, for the developer. */
export declare const SETUP_WORDS: {
    readonly websiteKey: "Website keys work only in Blue's own chat window. Make a key for your app on the Channels page.";
    readonly notForApps: "This key isn't for apps. Make a key for your app on the Channels page.";
    readonly serverKeyInApp: "Server keys work only on your own server, never in an app or a web page. Make a key for your app on the Channels page, and if this key was ever in an app or a page, get a new one there.";
    readonly serverKeyNotWhole: "This server key isn't whole. Copy it again from the Channels page.";
    /** A user's ID outside X-Blue-User's form, in server mode. */
    readonly serverUserForm: "On a server, each user's ID must be 1 to 128 visible characters, without spaces.";
    /** A server-mode call naming no user: getConversation(id). */
    readonly nameTheUser: "On a server, name the user on every call: getConversation(id, userId).";
    readonly noRandomSource: "Blue mode needs a secure random source here. Add one, or pass options.randomValues.";
    readonly userSecretForm: "options.userSecret must give a secret of 43 to 128 letters, digits, - or _ (base64url).";
    /** A handle from getConversation(id) whose user nothing on this device knows: each call refuses. */
    readonly userUnknown: "This conversation's user isn't known on this device. List the user's conversations first.";
    /** CaptivateChatManager merges lists on core's server, which knows no Blue key. */
    readonly managerBlueKey: "Use one CaptivateChatAPI for each app key. CaptivateChatManager is for Captivate's own keys.";
    /** CaptivateChatFileManager's static calls, given a Blue key (§2.2). */
    readonly fileManagerKey: "Use conversation.fileManager with a key for your app.";
    /** sendAction's send on a link offer (gaps G5): a link opens in the browser. */
    readonly linkOffer: "This offer is a link: open its link.url in the browser. There's nothing to send.";
};
/** What Blue mode doesn't do: thrown as an Error with status 501. */
export declare const NOT_HERE: {
    readonly shorterTimeToLive: "Files sent in a chat are kept with it for 90 days here. A shorter time isn't available.";
    readonly longerTimeToLive: "Files sent in a chat are kept with it for 90 days here. A longer time isn't available.";
    readonly editing: "Editing a message isn't available here.";
};
/** Written to the console once, for the developer. */
export declare const CONSOLE_WORDS: {
    readonly keyRefused: "The key was refused. Check it is a key for your app, turned on, and that this address is listed on it.";
    readonly noWebAddress: "This app's pages aren't on a web address, so the key can't check where they are. Use the library from the app's main process, or register the app's own scheme and list its address on the key.";
    readonly serverKeepsNothing: "Server mode keeps nothing on this machine, so storage and userSecret aren't used.";
    readonly serverNoUserToken: "Blue takes the customer your server names from user_id, so user_token isn't sent.";
    /** A server key's 403 `server_only`, in place of keyRefused. */
    readonly serverOnly: "This server key was refused because the request came from a web page. Use it only on your own server.";
    /** Any other 401 or 403 in server mode, in place of keyRefused. */
    readonly serverKeyRefused: "The server key was refused. Check it is the newest key from the Channels page and that it is turned on.";
    readonly listFilters: "Blue mode lists a user's conversations newest first, without filters or searches, so those were left out.";
    readonly privateMetadata: "Blue mode doesn't keep private metadata, so it wasn't sent.";
    readonly notAnOffer: "That action isn't one of the bot's forms, so nothing was sent.";
    readonly userId: "user_id must be letters, digits and - _ . : (at most 64), so the chat goes on without knowing who's signed in.";
    readonly userToken: "user_token isn't a token the chat can use, so it goes on without knowing who's signed in.";
    readonly detailTooLong: "A detail the bot reads was over 200 characters, so it wasn't sent.";
};
/** What a call was, since the same status reads differently on a send, a press or an upload. */
export type BlueCall = 'start' | 'send' | 'press' | 'upload' | 'metadata' | 'conversation' | 'delete';
/** The 4 KB words, which a metadata PATCH's 413 gives too (gaps G10). */
export declare const METADATA_TOO_BIG = "Blue keeps at most 4 KB of metadata with a conversation. Keep less in it.";
/**
 * The app user's words for a refusal: told by its status and the body's `error.code`, a
 * press's 400 by its `error.fields`, a 429 by `day_limit` (gaps G8) and then its Retry-After.
 */
export declare function refusalWords(refusal: {
    status: number;
    call: BlueCall;
    code?: string;
    fields?: string[];
    retryAfter?: number;
    /** A send with files, for its 413. */
    withFiles?: boolean;
}): string;
