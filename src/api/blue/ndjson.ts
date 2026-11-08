// Blue mode's one line reader (first-channels-library-spec §2.3; gaps G15), fed by all three ways
// of reading an answer: fetch's body, XMLHttpRequest's growing responseText, and a body read
// whole. It splits on "\n", trims "\r", keeps the partial tail, skips blank lines (the backend's
// keep-alive every 15 s) and parses each line as JSON; a line over 1 MB, or one that isn't JSON,
// breaks the stream, which the caller counts as a cut. Unknown event types are ignored.

/** One line's cap, in UTF-8 bytes (gaps G15). */
export const LINE_MAX_BYTES = 1_048_576;

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
export type BlueStreamEvent =
  | { type: 'conversation'; conversationId: string }
  | { type: 'step'; label: string }
  | { type: 'delta'; text: string }
  | { type: 'reset' }
  | { type: 'sources'; sources: BlueSource[] }
  | { type: 'text'; text: string }
  | { type: 'offer'; offer: BlueOffer }
  | { type: 'choices'; choices: string[] }
  | { type: 'stopped' }
  | { type: 'done' }
  | { type: 'error'; message: string; down?: boolean };

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
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

const isText = (value: unknown): value is string => typeof value === 'string';

/** A parsed line as an event the library reads, or null: an unknown type, or a known one missing what it carries. */
function eventOf(value: any): BlueStreamEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  switch (value.type) {
    case 'conversation':
      return isText(value.conversationId) ? value : null;
    case 'step':
      return isText(value.label) ? value : null;
    case 'delta':
    case 'text':
      return isText(value.text) ? value : null;
    case 'sources':
      return Array.isArray(value.sources) ? value : null;
    case 'offer':
      return value.offer && typeof value.offer === 'object' && isText(value.offer.id) ? value : null;
    case 'choices':
      return Array.isArray(value.choices) && value.choices.every(isText) ? value : null;
    case 'error':
      return isText(value.message) ? value : null;
    case 'reset':
    case 'stopped':
    case 'done':
      return value;
    default:
      return null;
  }
}

/** A reader for one response's body. */
export function lineReader(maxLineBytes = LINE_MAX_BYTES): LineReader {
  let tail = '';
  let tailBytes = 0;
  let broken: LineProblem | undefined;

  // False once the line broke the stream.
  const take = (raw: string, out: BlueStreamEvent[]): boolean => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.trim() === '') return true;
    if (utf8Length(line) > maxLineBytes) {
      broken = 'line-too-long';
      return false;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (_) {
      broken = 'not-json';
      return false;
    }
    const event = eventOf(value);
    if (event) out.push(event);
    return true;
  };

  return {
    lines(chunk: string): LinesRead {
      const events: BlueStreamEvent[] = [];
      if (broken) return { events, problem: broken };
      let start = 0;
      for (let newline = chunk.indexOf('\n'); newline !== -1; newline = chunk.indexOf('\n', start)) {
        const piece = chunk.slice(start, newline);
        const line = tail ? tail + piece : piece;
        tail = '';
        tailBytes = 0;
        start = newline + 1;
        if (!take(line, events)) return { events, problem: broken };
      }
      const rest = chunk.slice(start);
      if (rest) {
        tail += rest;
        tailBytes += utf8Length(rest);
        if (tailBytes > maxLineBytes) {
          broken = 'line-too-long';
          tail = '';
        }
      }
      return broken ? { events, problem: broken } : { events };
    },
    end(): LinesRead {
      const events: BlueStreamEvent[] = [];
      if (!broken && tail) {
        const line = tail;
        tail = '';
        tailBytes = 0;
        take(line, events);
      }
      return broken ? { events, problem: broken } : { events };
    },
  };
}

/** Bytes to text across chunks: a character split between two chunks comes out whole with the second. */
export interface Utf8Stream {
  decode(bytes: Uint8Array): string;
  /** The body ended: a character left unfinished reads as U+FFFD. */
  end(): string;
}

/** TextDecoder with `{ stream: true }` where the runtime has one, else the library's own (Hermes has none). */
export function utf8Stream(): Utf8Stream {
  const Decoder = (globalThis as any).TextDecoder;
  if (typeof Decoder !== 'function') return ownUtf8Stream();
  const decoder = new Decoder('utf-8');
  return {
    decode: (bytes) => decoder.decode(bytes, { stream: true }),
    end: () => decoder.decode(),
  };
}

/** A small streaming UTF-8 decoder, WHATWG's algorithm: bad bytes read as U+FFFD, as TextDecoder reads them. */
export function ownUtf8Stream(): Utf8Stream {
  let codePoint = 0;
  let needed = 0;
  let seen = 0;
  let lower = 0x80;
  let upper = 0xbf;

  const reset = () => {
    codePoint = 0;
    needed = 0;
    seen = 0;
    lower = 0x80;
    upper = 0xbf;
  };

  const textOf = (units: number[]): string => {
    let text = '';
    for (let i = 0; i < units.length; i += 8192) text += String.fromCharCode.apply(null, units.slice(i, i + 8192));
    return text;
  };

  const emit = (units: number[], point: number) => {
    if (point <= 0xffff) units.push(point);
    else {
      const rest = point - 0x10000;
      units.push(0xd800 + (rest >> 10), 0xdc00 + (rest & 0x3ff));
    }
  };

  return {
    decode(bytes: Uint8Array): string {
      const units: number[] = [];
      for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i];
        if (needed === 0) {
          if (byte <= 0x7f) units.push(byte);
          else if (byte >= 0xc2 && byte <= 0xdf) {
            needed = 1;
            codePoint = byte & 0x1f;
          } else if (byte >= 0xe0 && byte <= 0xef) {
            if (byte === 0xe0) lower = 0xa0;
            if (byte === 0xed) upper = 0x9f;
            needed = 2;
            codePoint = byte & 0x0f;
          } else if (byte >= 0xf0 && byte <= 0xf4) {
            if (byte === 0xf0) lower = 0x90;
            if (byte === 0xf4) upper = 0x8f;
            needed = 3;
            codePoint = byte & 0x07;
          } else units.push(0xfffd);
          continue;
        }
        if (byte < lower || byte > upper) {
          // The sequence ended early: U+FFFD for it, and this byte starts afresh.
          reset();
          units.push(0xfffd);
          i--;
          continue;
        }
        lower = 0x80;
        upper = 0xbf;
        codePoint = (codePoint << 6) | (byte & 0x3f);
        seen++;
        if (seen === needed) {
          emit(units, codePoint);
          reset();
        }
      }
      return textOf(units);
    },
    end(): string {
      if (needed === 0) return '';
      reset();
      return '�';
    },
  };
}
