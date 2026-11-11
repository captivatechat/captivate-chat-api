import { BlueStreamEvent } from './ndjson';
import { BlueError, BlueStreamMode, BlueTransport } from './transport';
/** How an answer is read (§2.3's table). */
export type BlueReadWay = 'fetch' | 'xhr' | 'whole';
/** Streaming, the response's headers must come within this. */
export declare const HEADERS_MS = 30000;
/** Streaming, nothing at all for this long, not even a keep-alive, is a cut: three missed keep-alives. */
export declare const IDLE_MS = 45000;
/** Reading whole, the backend's 300 s answer cap plus margin, from the send. */
export declare const WHOLE_MS = 330000;
/** XMLHttpRequest's responseText only grows: past this many UTF-8 bytes the request is aborted. */
export declare const XHR_BODY_MAX_BYTES = 2097152;
/** The runtime's parts the pick reads; globalThis by default. */
export interface ReadEnvironment {
    navigator?: {
        product?: string;
    };
    ReadableStream?: unknown;
    Response?: unknown;
    XMLHttpRequest?: unknown;
}
/**
 * The way to read (§2.3): fetch's body when `options.fetch` was given, or where ReadableStream and
 * Response's body exist outside React Native (whose own fetch has no body); else XMLHttpRequest;
 * else the body whole. `options.stream`, when not "auto", decides.
 */
export declare function pickWay(options: {
    stream?: BlueStreamMode;
    fetch?: unknown;
}, env?: ReadEnvironment): BlueReadWay;
/** Why a stream was cut (§2.5). */
export type CutReason = 
/** The request failed on the way, or the connection broke. */
'network'
/** Streaming, no headers within HEADERS_MS. */
 | 'headers'
/** Streaming, nothing for IDLE_MS. */
 | 'idle'
/** Reading whole, no end within WHOLE_MS of the send. */
 | 'whole-time'
/** The body ended without `done`, `stopped` or `error`. */
 | 'no-end'
/** A line over 1 MB. */
 | 'line-too-long'
/** A line that isn't JSON. */
 | 'not-json'
/** XMLHttpRequest's body over 2 MB. */
 | 'body-too-big';
/** How a stream finished. */
export type StreamEnd = 
/** The body ended after `done`, `stopped` or `error`. */
{
    kind: 'ended';
}
/** Cut: the request was aborted first, and nothing is sent again. */
 | {
    kind: 'cut';
    reason: CutReason;
}
/** Refused before the stream opened, in §1.2's words; or no way to call at all (no status). */
 | {
    kind: 'refused';
    error: BlueError;
}
/** The caller aborted it, or the instance was disposed. */
 | {
    kind: 'aborted';
};
/** The timers the stream runs on; the runtime's by default, a manual clock in tests. */
export interface Clock {
    setTimeout(run: () => void, ms: number): unknown;
    clearTimeout(timer: unknown): void;
    now(): number;
}
export declare const RUNTIME_CLOCK: Clock;
export interface StreamRequest {
    /** The route, e.g. "/v1/chat". */
    path: string;
    /** Sent as JSON. */
    body: unknown;
    /** The user's secret, as X-Blue-Conversation; in server mode the user's ID, as X-Blue-User. */
    secret?: string;
    way: BlueReadWay;
    /** A send with files, for its 413's words. */
    withFiles?: boolean;
    /** The response's headers arrived with a 2xx: once, before any events. */
    onOpen?: () => void;
    /** The events one network chunk completed, never an empty batch; none after `done`, a cut or an abort. */
    onEvents: (events: BlueStreamEvent[]) => void;
    clock?: Clock;
}
export interface BlueStream {
    readonly way: BlueReadWay;
    /** Settles once, never rejects. */
    readonly finished: Promise<StreamEnd>;
    /** Ends the request; no event comes after. Aborting never stops the answer on the backend (§2.5). */
    abort(): void;
}
/** One answer's POST, read the way given. Throws at once on a disposed instance. */
export declare function openStream(transport: BlueTransport, request: StreamRequest): BlueStream;
