import { BlueCall } from './words';
/** How an answer is read: picked before the POST goes out, since a sent POST can't be read again (§2.3). */
export type BlueStreamMode = 'auto' | 'fetch' | 'xhr' | 'whole';
/**
 * Where the user's secrets are kept: `{ get, set, remove }`, or localStorage's and React Native's
 * AsyncStorage's own `{ getItem, setItem, removeItem }`, each call possibly a Promise.
 */
export type BlueStorage = {
    get(name: string): string | null | undefined | Promise<string | null | undefined>;
    set(name: string, value: string): void | Promise<void>;
    remove(name: string): void | Promise<void>;
} | {
    getItem(name: string): string | null | undefined | Promise<string | null | undefined>;
    setItem(name: string, value: string): void | Promise<void>;
    removeItem(name: string): void | Promise<void>;
};
/** Blue mode's options (§1.1), all optional, beside core's tunables in CaptivateChatAPIOptions. */
export interface BlueOptions {
    /** The backend's address; `prod` and `dev` have defaults. */
    blueUrl?: string;
    /** A fetch to use in place of the global one: expo/fetch, Electron's net.fetch or a polyfill. */
    fetch?: (input: string, init?: any) => Promise<any>;
    /** How answers are read: "auto" (the default) picks by the runtime. */
    stream?: BlueStreamMode;
    /** Where each user's secret is kept; localStorage or memory without it. */
    storage?: BlueStorage;
    /** A secure random source, where crypto.getRandomValues is missing (React Native: expo-crypto). */
    randomValues?: (bytes: Uint8Array) => Uint8Array;
    /** The user's secret from the app's own server, the same on every device (§2.6). */
    userSecret?: (userId: string) => string | Promise<string>;
}
/** The backend's address per mode: Blue's BLUE_BACKEND_PUBLIC_URL in its wrangler.jsonc (§7). */
export declare const BLUE_URLS: {
    readonly prod: "https://vienna-blue-backend.prod.captivat.io";
    readonly dev: "https://vienna-blue-backend.dev.captivat.io";
};
/** Every call but a send's stream and a start waits this long, a press too (gaps G16). */
export declare const CALL_MS = 30000;
/** What Blue mode throws and gives onError: §1.2's words, the status, and what the refusal said beyond words. */
export interface BlueError extends Error {
    /** The HTTP status; none when the backend couldn't be reached or the call ran out of time. */
    status?: number;
    /** §1.2's words, for the app user. */
    errorDesc: string;
    /** The body's `error.code`. */
    code?: string;
    /** A 429's Retry-After, in seconds. */
    retryAfter?: number;
    /** The names of a refused form's fields, never their words. */
    fields?: string[];
}
/** An Error in core's buildHttpError shape, with §1.2's words where core puts the body. */
export declare function blueError(words: string, refusal?: {
    status?: number;
    statusText?: string;
    code?: string;
    retryAfter?: number;
    fields?: string[];
}): BlueError;
/** Retry-After as seconds: a number, or an HTTP date. */
export declare function retryAfterOf(value: string | null | undefined, now?: number): number | undefined;
export declare const DISPOSED = "This CaptivateChatAPI instance has been disposed. Create a new one.";
export interface BlueRequest {
    /** What the call is, for its refusal's words. */
    call: BlueCall;
    /** Sent as JSON. */
    body?: unknown;
    /** The user's secret, as X-Blue-Conversation; in server mode the user's ID, as X-Blue-User. */
    secret?: string;
    /** How long the whole call may take; CALL_MS by default. */
    timeoutMs?: number;
    /** A send with files, for its 413's words. */
    withFiles?: boolean;
}
export type Logger = {
    log: (...args: any[]) => void;
    warn: (...args: any[]) => void;
};
export declare class BlueTransport {
    readonly apiKey: string;
    readonly mode: 'prod' | 'dev';
    /**
     * Server mode (first-channels-server-key-spec §3.1): a whole vbk_ key on the app's own server.
     * Every call names its user by X-Blue-User where app mode sends the user's secret, and nothing
     * is kept on the machine.
     */
    readonly serverMode: boolean;
    private options;
    private disposed;
    private readonly inFlight;
    private readonly warned;
    readonly logger: Logger;
    constructor(apiKey: string, mode: 'prod' | 'dev', options: BlueOptions, logger: Logger, serverMode?: boolean);
    /** Takes the Blue members of the options; anything left out keeps its value. */
    configure(options?: BlueOptions): void;
    /** The options as they stand, for the reader and the user's secret. */
    get settings(): Readonly<BlueOptions>;
    get baseUrl(): string;
    get isDisposed(): boolean;
    /** `count` secure random bytes. */
    randomBytes(count: number): Uint8Array;
    /**
     * The only headers Blue's preflight allows: Authorization, Content-Type and X-Blue-Conversation
     * (§2.3); in server mode X-Blue-User, the user's ID, in place of the secret, on every call.
     */
    headers(secret?: string, json?: boolean): Record<string, string>;
    /** The fetch to call: the option's, else the runtime's. */
    get fetchImpl(): ((input: string, init?: any) => Promise<any>) | undefined;
    /**
     * One call and its answer read whole, within its time. Resolves with the body as JSON
     * (undefined when empty); rejects with a BlueError in §1.2's words, never sending it again.
     */
    request<T = any>(method: string, path: string, request: BlueRequest): Promise<T>;
    /** A refusal as a BlueError, with the developer's console line when the key was refused. */
    refused(response: {
        status: number;
        statusText?: string;
        headers?: {
            get(name: string): string | null;
        };
    }, text: string, request: BlueRequest): BlueError;
    /** A console warning for the developer, once per instance. */
    warnOnce(name: string, words: string): void;
    /** Counts a call made outside request() (an answer's stream) among those dispose() ends; gives back its untrack. */
    track(handle: {
        abort(): void;
    }): () => void;
    /** Aborts every call in flight; later calls refuse. */
    dispose(): void;
}
