/** One line's cap, in UTF-8 bytes (gaps G15). */
export declare const LINE_MAX_BYTES = 1048576;
/** A source of an answer, with the backend's number, which matches the `[n]` in its final text. */
export interface BlueSource {
    number: number;
    /** The document's readable title; null for an internal document. */
    title: string | null;
    page?: number;
    excerpt?: string;
    url?: string;
}
/** One of the bot's forms offered under an answer, as the backend sends it. */
export interface BlueOffer {
    id: string;
    [field: string]: unknown;
}
/**
 * What POST /v1/chat streams for an app key: Blue's PublishedChatEvent, less `verification`
 * (a signed-in person's only). The backend's order is conversation, step, delta/reset, sources,
 * text, offer, choices, done; `stopped` and `error` end an answer too.
 */
export type BlueStreamEvent = {
    type: 'conversation';
    conversationId: string;
} | {
    type: 'step';
    label: string;
} | {
    type: 'delta';
    text: string;
} | {
    type: 'reset';
} | {
    type: 'sources';
    sources: BlueSource[];
} | {
    type: 'text';
    text: string;
} | {
    type: 'offer';
    offer: BlueOffer;
} | {
    type: 'choices';
    choices: string[];
} | {
    type: 'stopped';
} | {
    type: 'done';
} | {
    type: 'error';
    message: string;
    down?: boolean;
};
/** Why a stream's lines broke it. */
export type LineProblem = 'line-too-long' | 'not-json';
/** What a piece of the body gave: its events, and the problem that broke the stream, if any. */
export interface LinesRead {
    events: BlueStreamEvent[];
    problem?: LineProblem;
}
export interface LineReader {
    /** The events of the lines this piece completes; the partial tail is kept for the next. */
    lines(chunk: string): LinesRead;
    /** The body ended: a last line without "\n" is read too. */
    end(): LinesRead;
}
/** A string's length in UTF-8 bytes. */
export declare function utf8Length(text: string): number;
/** A reader for one response's body. */
export declare function lineReader(maxLineBytes?: number): LineReader;
/** Bytes to text across chunks: a character split between two chunks comes out whole with the second. */
export interface Utf8Stream {
    decode(bytes: Uint8Array): string;
    /** The body ended: a character left unfinished reads as U+FFFD. */
    end(): string;
}
/** TextDecoder with `{ stream: true }` where the runtime has one, else the library's own (Hermes has none). */
export declare function utf8Stream(): Utf8Stream;
/** A small streaming UTF-8 decoder, WHATWG's algorithm: bad bytes read as U+FFFD, as TextDecoder reads them. */
export declare function ownUtf8Stream(): Utf8Stream;
