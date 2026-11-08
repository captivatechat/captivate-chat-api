// An answer's stream (first-channels-library-spec §2.3, §2.5): one POST, read one of three ways,
// picked before it goes out since a sent POST can't be read again. Every way feeds the same line
// reader (ndjson.ts) and gives the caller the same events, one batch per network chunk; reading
// whole gives them all in one batch at the end. The stream never sends again: a cut aborts the
// request and says why, and the caller reads the answer back (step L3).
import { BlueStreamEvent, LineReader, LinesRead, lineReader, utf8Length, utf8Stream } from './ndjson';
import { BlueError, BlueStreamMode, BlueTransport, DISPOSED, blueError } from './transport';
import { WORDS } from './words';

/** How an answer is read (§2.3's table). */
export type BlueReadWay = 'fetch' | 'xhr' | 'whole';

/** Streaming, the response's headers must come within this. */
export const HEADERS_MS = 30_000;
/** Streaming, nothing at all for this long, not even a keep-alive, is a cut: three missed keep-alives. */
export const IDLE_MS = 45_000;
/** Reading whole, the backend's 300 s answer cap plus margin, from the send. */
export const WHOLE_MS = 330_000;
/** XMLHttpRequest's responseText only grows: past this many UTF-8 bytes the request is aborted. */
export const XHR_BODY_MAX_BYTES = 2_097_152;

/** The runtime's parts the pick reads; globalThis by default. */
export interface ReadEnvironment {
  navigator?: { product?: string };
  ReadableStream?: unknown;
  Response?: unknown;
  XMLHttpRequest?: unknown;
}

/**
 * The way to read (§2.3): fetch's body when `options.fetch` was given, or where ReadableStream and
 * Response's body exist outside React Native (whose own fetch has no body); else XMLHttpRequest;
 * else the body whole. `options.stream`, when not "auto", decides.
 */
export function pickWay(
  options: { stream?: BlueStreamMode; fetch?: unknown },
  env: ReadEnvironment = globalThis as ReadEnvironment
): BlueReadWay {
  if (options.stream === 'fetch' || options.stream === 'xhr' || options.stream === 'whole') return options.stream;
  if (options.fetch) return 'fetch';
  const reactNative = typeof env.navigator !== 'undefined' && env.navigator?.product === 'ReactNative';
  const prototype = typeof env.Response === 'function' ? (env.Response as { prototype?: object }).prototype : undefined;
  const bodies = typeof env.ReadableStream !== 'undefined' && !!prototype && 'body' in prototype;
  if (bodies && !reactNative) return 'fetch';
  if (typeof env.XMLHttpRequest === 'function') return 'xhr';
  return 'whole';
}

/** Why a stream was cut (§2.5). */
export type CutReason =
  /** The request failed on the way, or the connection broke. */
  | 'network'
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
  | { kind: 'ended' }
  /** Cut: the request was aborted first, and nothing is sent again. */
  | { kind: 'cut'; reason: CutReason }
  /** Refused before the stream opened, in §1.2's words; or no way to call at all (no status). */
  | { kind: 'refused'; error: BlueError }
  /** The caller aborted it, or the instance was disposed. */
  | { kind: 'aborted' };

/** The timers the stream runs on; the runtime's by default, a manual clock in tests. */
export interface Clock {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
  now(): number;
}

export const RUNTIME_CLOCK: Clock = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

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

type Headers = { get(name: string): string | null };

/** One answer's POST, read the way given. Throws at once on a disposed instance. */
export function openStream(transport: BlueTransport, request: StreamRequest): BlueStream {
  if (transport.isDisposed) throw new Error(DISPOSED);
  const clock = request.clock ?? RUNTIME_CLOCK;
  const sentAt = clock.now();
  const url = `${transport.baseUrl}${request.path}`;
  const headers = transport.headers(request.secret, true);
  const payload = JSON.stringify(request.body);

  let settled = false;
  let resolve!: (end: StreamEnd) => void;
  const finished = new Promise<StreamEnd>((r) => (resolve = r));
  let timer: unknown;
  let stopRequest: () => void = () => undefined;
  let opened = false;
  let doneSeen = false;
  let endSeen = false;
  const lines: LineReader = lineReader();

  const clearTimer = () => {
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
  };
  const settle = (end: StreamEnd, abortRequest: boolean) => {
    if (settled) return;
    settled = true;
    clearTimer();
    untrack();
    // A cut aborts the request before anything is read back (§2.5).
    if (abortRequest) {
      try {
        stopRequest();
      } catch (_) {
        // The request is gone either way.
      }
    }
    transport.logger.log(`Blue POST ${request.path}: ${end.kind === 'cut' ? `cut (${end.reason})` : end.kind}`);
    resolve(end);
  };
  const cut = (reason: CutReason) => settle({ kind: 'cut', reason }, true);
  const after = (ms: number, reason: CutReason) => {
    clearTimer();
    timer = clock.setTimeout(() => cut(reason), ms);
  };
  const untrack = transport.track({ abort: () => settle({ kind: 'aborted' }, true) });

  const open = () => {
    if (opened) return;
    opened = true;
    try {
      request.onOpen?.();
    } catch (error) {
      transport.logger.warn('Blue mode: a listener threw while an answer was read', error);
    }
  };

  // Hands on what a piece gave, dropping everything after `done` (§2.4: only the stream's end is read).
  const deliver = (read: LinesRead) => {
    const events: BlueStreamEvent[] = [];
    for (const event of read.events) {
      if (doneSeen) break;
      events.push(event);
      if (event.type === 'done') doneSeen = true;
      if (event.type === 'done' || event.type === 'stopped' || event.type === 'error') endSeen = true;
    }
    if (events.length && !settled) {
      try {
        request.onEvents(events);
      } catch (error) {
        // The caller's listener failing doesn't cut the answer it is reading.
        transport.logger.warn('Blue mode: a listener threw while an answer was read', error);
      }
    }
    if (read.problem) cut(read.problem);
  };
  const feed = (text: string) => {
    if (!settled && text) deliver(lines.lines(text));
  };
  const finish = () => {
    if (settled) return;
    deliver(lines.end());
    if (settled) return;
    if (endSeen) settle({ kind: 'ended' }, false);
    else cut('no-end');
  };
  const refuse = (response: { status: number; statusText?: string; headers?: Headers }, text: string) =>
    settle({ kind: 'refused', error: transport.refused(response, text, { call: 'send', withFiles: request.withFiles }) }, false);

  // Reads a fetch response's body whole, within what's left of WHOLE_MS from the send.
  const readWhole = async (response: any) => {
    after(Math.max(0, WHOLE_MS - (clock.now() - sentAt)), 'whole-time');
    let text: string;
    try {
      text = await response.text();
    } catch (_) {
      return cut('network');
    }
    if (settled) return;
    // One batch, a last line without "\n" in it too: reading whole has no drafts.
    const read = lines.lines(text);
    const rest = lines.end();
    deliver({ events: [...read.events, ...rest.events], problem: read.problem ?? rest.problem });
    finish();
  };

  const viaFetch = async (whole: boolean) => {
    const fetchImpl = transport.fetchImpl;
    if (!fetchImpl) return settle({ kind: 'refused', error: blueError(WORDS.couldntAnswer) }, false);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let reader: { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } | null = null;
    stopRequest = () => {
      controller?.abort();
      reader?.cancel().catch(() => undefined);
    };
    after(whole ? WHOLE_MS : HEADERS_MS, whole ? 'whole-time' : 'headers');
    let response: any;
    try {
      response = await fetchImpl(url, { method: 'POST', headers, body: payload, credentials: 'omit', signal: controller?.signal });
    } catch (_) {
      return cut('network');
    }
    if (settled) return;
    if (!response.ok) {
      // A refusal's body is small: it gets the headers' time again.
      if (!whole) after(HEADERS_MS, 'headers');
      const text: string = await Promise.resolve(response.text()).catch(() => '');
      if (!settled) refuse(response, text);
      return;
    }
    open();
    const body = response.body;
    if (whole || !body || typeof body.getReader !== 'function') return readWhole(response);
    reader = body.getReader();
    const decoder = utf8Stream();
    after(IDLE_MS, 'idle');
    for (;;) {
      let chunk: { done: boolean; value?: Uint8Array };
      try {
        chunk = await reader!.read();
      } catch (_) {
        return cut('network');
      }
      if (settled) return;
      if (chunk.done) break;
      after(IDLE_MS, 'idle');
      if (chunk.value && chunk.value.length) feed(decoder.decode(chunk.value));
      if (settled) return;
    }
    clearTimer();
    feed(decoder.end());
    finish();
  };

  const viaXhr = () => {
    const Xhr = (globalThis as any).XMLHttpRequest;
    if (typeof Xhr !== 'function') return viaFetch(true);
    const xhr = new Xhr();
    let offset = 0;
    let bodyBytes = 0;
    let refused = false;
    stopRequest = () => xhr.abort();
    const headersOf: Headers = { get: (name) => xhr.getResponseHeader(name) };
    const ok = () => xhr.status >= 200 && xhr.status < 300;

    // Read on progress, on readystatechange (3 and 4) and on load, from the last offset, so the
    // tail that arrives with load alone is read and no line is read twice (§2.3).
    const pump = () => {
      if (settled) return;
      const state = xhr.readyState;
      if (state === 4 && xhr.status === 0) return cut('network');
      if (state < 2) return;
      if (!opened && !refused) {
        if (!ok()) {
          refused = true;
          after(HEADERS_MS, 'headers');
        } else {
          open();
          if (settled) return;
          after(IDLE_MS, 'idle');
        }
      }
      if (refused) {
        if (state === 4) refuse({ status: xhr.status, statusText: xhr.statusText, headers: headersOf }, String(xhr.responseText ?? ''));
        return;
      }
      if (state >= 3) {
        const text = String(xhr.responseText ?? '');
        if (text.length > offset) {
          const piece = text.slice(offset);
          offset = text.length;
          bodyBytes += utf8Length(piece);
          if (bodyBytes > XHR_BODY_MAX_BYTES) return cut('body-too-big');
          if (state === 3) after(IDLE_MS, 'idle');
          feed(piece);
          if (settled) return;
        }
      }
      if (state === 4) {
        clearTimer();
        finish();
      }
    };

    xhr.open('POST', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.responseType = '';
    xhr.withCredentials = false;
    // No overall time: an answer may take its 300 s (§2.5).
    xhr.timeout = 0;
    // React Native turns on incremental data only for a handler set before send().
    xhr.onprogress = pump;
    xhr.onreadystatechange = pump;
    xhr.onload = pump;
    xhr.onerror = () => cut('network');
    xhr.ontimeout = () => cut('network');
    xhr.onabort = () => cut('network');
    after(HEADERS_MS, 'headers');
    try {
      xhr.send(payload);
    } catch (_) {
      cut('network');
    }
  };

  // The request goes out now; a failure the ways didn't catch is a cut, never a send again.
  try {
    const running = request.way === 'xhr' ? viaXhr() : viaFetch(request.way === 'whole');
    if (running) running.catch(() => cut('network'));
  } catch (_) {
    cut('network');
  }

  return {
    way: request.way,
    finished,
    abort: () => settle({ kind: 'aborted' }, true),
  };
}
