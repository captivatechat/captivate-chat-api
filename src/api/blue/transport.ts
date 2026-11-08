// Blue mode's one way to the backend (first-channels-library-spec §2.1 to §2.3): no socket, one
// HTTP call per method, made with the key's own headers and nothing else, its refusals turned
// into §1.2's words. An answer's stream (stream.ts, with the line reader in ndjson.ts) builds on it.
import { BlueCall, CONSOLE_WORDS, SETUP_WORDS, WORDS, refusalWords } from './words';

/** How an answer is read: picked before the POST goes out, since a sent POST can't be read again (§2.3). */
export type BlueStreamMode = 'auto' | 'fetch' | 'xhr' | 'whole';

/**
 * Where the user's secrets are kept: `{ get, set, remove }`, or localStorage's and React Native's
 * AsyncStorage's own `{ getItem, setItem, removeItem }`, each call possibly a Promise.
 */
export type BlueStorage =
  | {
      get(name: string): string | null | undefined | Promise<string | null | undefined>;
      set(name: string, value: string): void | Promise<void>;
      remove(name: string): void | Promise<void>;
    }
  | {
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
export const BLUE_URLS = {
  prod: 'https://vienna-blue-backend.prod.captivat.io',
  dev: 'https://vienna-blue-backend.dev.captivat.io',
} as const;

/** Every call but a send's stream and a start waits this long, a press too (gaps G16). */
export const CALL_MS = 30_000;

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
export function blueError(
  words: string,
  refusal: { status?: number; statusText?: string; code?: string; retryAfter?: number; fields?: string[] } = {}
): BlueError {
  const { status, statusText } = refusal;
  const head = status === undefined ? 'HTTP request failed' : `HTTP request failed: ${status}${statusText ? ` ${statusText}` : ''}`;
  const error = new Error(`${head}: ${words}`) as BlueError;
  error.errorDesc = words;
  if (status !== undefined) error.status = status;
  if (refusal.code !== undefined) error.code = refusal.code;
  if (refusal.retryAfter !== undefined) error.retryAfter = refusal.retryAfter;
  if (refusal.fields !== undefined) error.fields = refusal.fields;
  return error;
}

/** Retry-After as seconds: a number, or an HTTP date. */
export function retryAfterOf(value: string | null | undefined, now = Date.now()): number | undefined {
  if (value === null || value === undefined || value.trim() === '') return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}

/** The body's `{ error: { code, fields } }`; never its message, which is the backend's words. */
function refusalOf(text: string): { code?: string; fields?: string[] } {
  try {
    const error = JSON.parse(text)?.error;
    if (!error || typeof error !== 'object') return {};
    const code = typeof error.code === 'string' ? error.code : undefined;
    const fields =
      error.fields && typeof error.fields === 'object' && !Array.isArray(error.fields) ? Object.keys(error.fields) : undefined;
    return { code, fields };
  } catch (_) {
    return {};
  }
}

export const DISPOSED = 'This CaptivateChatAPI instance has been disposed. Create a new one.';

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

export type Logger = { log: (...args: any[]) => void; warn: (...args: any[]) => void };

export class BlueTransport {
  readonly apiKey: string;
  readonly mode: 'prod' | 'dev';
  /**
   * Server mode (first-channels-server-key-spec §3.1): a whole vbk_ key on the app's own server.
   * Every call names its user by X-Blue-User where app mode sends the user's secret, and nothing
   * is kept on the machine.
   */
  readonly serverMode: boolean;
  private options: BlueOptions = {};
  private disposed = false;
  private readonly inFlight = new Set<{ abort(): void }>();
  private readonly warned = new Set<string>();
  readonly logger: Logger;

  constructor(apiKey: string, mode: 'prod' | 'dev', options: BlueOptions, logger: Logger, serverMode = false) {
    this.apiKey = apiKey;
    this.mode = mode;
    this.serverMode = serverMode;
    this.logger = logger;
    this.configure(options);
    // A secret for each user, and an id for each message, need one (§2.6, §2.5).
    if (!this.options.randomValues && typeof (globalThis as any).crypto?.getRandomValues !== 'function') {
      throw new Error(SETUP_WORDS.noRandomSource);
    }
    // A page with no web address sends Origin "null", which no key can list (§2.10).
    const location = (globalThis as any).location;
    if (!serverMode && location && (location.protocol === 'file:' || location.origin === 'null')) {
      this.warnOnce('noWebAddress', CONSOLE_WORDS.noWebAddress);
    }
  }

  /** Takes the Blue members of the options; anything left out keeps its value. */
  configure(options: BlueOptions = {}): void {
    const next: BlueOptions = { ...this.options };
    for (const name of ['blueUrl', 'fetch', 'stream', 'storage', 'randomValues', 'userSecret'] as const) {
      if (options[name] !== undefined) (next as any)[name] = options[name];
    }
    this.options = next;
    // Server mode stores no secret, so these would only mislead (server key spec §3.3).
    if (this.serverMode && (options.storage !== undefined || options.userSecret !== undefined)) {
      this.warnOnce('serverKeepsNothing', CONSOLE_WORDS.serverKeepsNothing);
    }
  }

  /** The options as they stand, for the reader and the user's secret. */
  get settings(): Readonly<BlueOptions> {
    return this.options;
  }

  get baseUrl(): string {
    return (this.options.blueUrl ?? BLUE_URLS[this.mode]).replace(/\/+$/, '');
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** `count` secure random bytes. */
  randomBytes(count: number): Uint8Array {
    const bytes = new Uint8Array(count);
    if (this.options.randomValues) return this.options.randomValues(bytes);
    return (globalThis as any).crypto.getRandomValues(bytes);
  }

  /**
   * The only headers Blue's preflight allows: Authorization, Content-Type and X-Blue-Conversation
   * (§2.3); in server mode X-Blue-User, the user's ID, in place of the secret, on every call.
   */
  headers(secret?: string, json = false): Record<string, string> {
    if (this.serverMode && secret === undefined) throw new Error(SETUP_WORDS.nameTheUser);
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
    if (json) headers['Content-Type'] = 'application/json';
    if (secret !== undefined) headers[this.serverMode ? 'X-Blue-User' : 'X-Blue-Conversation'] = secret;
    return headers;
  }

  /** The fetch to call: the option's, else the runtime's. */
  get fetchImpl(): ((input: string, init?: any) => Promise<any>) | undefined {
    if (this.options.fetch) return this.options.fetch;
    const global = (globalThis as any).fetch;
    return typeof global === 'function' ? (input, init) => global(input, init) : undefined;
  }

  /**
   * One call and its answer read whole, within its time. Resolves with the body as JSON
   * (undefined when empty); rejects with a BlueError in §1.2's words, never sending it again.
   */
  async request<T = any>(method: string, path: string, request: BlueRequest): Promise<T> {
    if (this.disposed) throw new Error(DISPOSED);
    const fetchImpl = this.fetchImpl;
    if (!fetchImpl) throw blueError(WORDS.couldntAnswer);
    const headers = this.headers(request.secret, request.body !== undefined);

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handle = { abort: () => controller?.abort() };
    this.inFlight.add(handle);

    const call = (async () => {
      const response = await fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        credentials: 'omit',
        signal: controller?.signal,
      });
      const text: string = await response.text().catch(() => '');
      return { response, text };
    })();
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller?.abort();
        reject(new Error('timed out'));
      }, request.timeoutMs ?? CALL_MS);
    });

    let answered: { response: any; text: string };
    try {
      answered = await Promise.race([call, deadline]);
    } catch (_) {
      call.catch(() => undefined);
      if (this.disposed && !timedOut) throw new Error(DISPOSED);
      this.logger.log(`Blue ${method} ${path}: ${timedOut ? 'ran out of time' : 'not reached'}`);
      throw blueError(WORDS.couldntAnswer);
    } finally {
      clearTimeout(timer);
      this.inFlight.delete(handle);
    }

    const { response, text } = answered;
    this.logger.log(`Blue ${method} ${path}: ${response.status}`);
    if (response.ok) {
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch (_) {
        throw blueError(WORDS.couldntAnswer, { status: response.status, statusText: response.statusText });
      }
    }
    throw this.refused(response, text, request);
  }

  /** A refusal as a BlueError, with the developer's console line when the key was refused. */
  refused(response: { status: number; statusText?: string; headers?: { get(name: string): string | null } }, text: string, request: BlueRequest): BlueError {
    const { code, fields } = refusalOf(text);
    const retryAfter = response.status === 429 ? retryAfterOf(response.headers?.get('retry-after')) : undefined;
    if (response.status === 401 || response.status === 403) {
      if (!this.serverMode) this.warnOnce('keyRefused', CONSOLE_WORDS.keyRefused);
      else if (code === 'server_only') this.warnOnce('serverOnly', CONSOLE_WORDS.serverOnly);
      else this.warnOnce('keyRefused', CONSOLE_WORDS.serverKeyRefused);
    }
    const words = refusalWords({ status: response.status, call: request.call, code, fields, retryAfter, withFiles: request.withFiles });
    return blueError(words, { status: response.status, statusText: response.statusText, code, retryAfter, fields });
  }

  /** A console warning for the developer, once per instance. */
  warnOnce(name: string, words: string): void {
    if (this.warned.has(name)) return;
    this.warned.add(name);
    this.logger.warn(words);
  }

  /** Counts a call made outside request() (an answer's stream) among those dispose() ends; gives back its untrack. */
  track(handle: { abort(): void }): () => void {
    this.inFlight.add(handle);
    return () => {
      this.inFlight.delete(handle);
    };
  }

  /** Aborts every call in flight; later calls refuse. */
  dispose(): void {
    this.disposed = true;
    for (const handle of this.inFlight) handle.abort();
    this.inFlight.clear();
  }
}
