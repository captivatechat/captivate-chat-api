// A fetch the tests answer by hand: every call is recorded, and each is answered by the
// next queued reply. A call nothing answers rejects, so a test never reaches the network.

export interface RecordedRequest {
  url: string;
  method: string;
  /** Header names lowercased. */
  headers: Record<string, string>;
  /** The body as sent. */
  body: unknown;
  /** The body read as JSON, or undefined when it isn't JSON. */
  json: any;
  signal?: AbortSignal | null;
}

export type Reply =
  | FakeResponse
  | Error
  | ((request: RecordedRequest) => FakeResponse | Error | Promise<FakeResponse | Error>);

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

const encoder = new TextEncoder();

/** Enough of fetch's Response for the library: status, headers, text, json and a body stream. */
export class FakeResponse {
  readonly status: number;
  readonly statusText: string;
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null; has(name: string): boolean };
  /** A ReadableStream of the chunks, or null (as some runtimes give). */
  readonly body: ReadableStream<Uint8Array> | null;
  bodyUsed = false;
  private readonly whole: Promise<string>;

  constructor(
    options: {
      status?: number;
      statusText?: string;
      headers?: Record<string, string>;
      /** The whole body; or the chunks it arrives in. */
      body?: string | (string | Uint8Array)[];
      /** False gives `body: null`, while text() still answers. */
      stream?: boolean;
    } = {}
  ) {
    this.status = options.status ?? 200;
    this.statusText = options.statusText ?? STATUS_TEXT[this.status] ?? '';
    this.ok = this.status >= 200 && this.status < 300;
    const headers = new Map(
      Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v] as [string, string])
    );
    this.headers = {
      get: (name) => headers.get(name.toLowerCase()) ?? null,
      has: (name) => headers.has(name.toLowerCase()),
    };
    const chunks = (Array.isArray(options.body) ? options.body : [options.body ?? '']).map((c) =>
      typeof c === 'string' ? encoder.encode(c) : c
    );
    this.whole = Promise.resolve(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'));
    this.body =
      options.stream === false || typeof ReadableStream === 'undefined'
        ? null
        : new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(chunk);
              controller.close();
            },
          });
  }

  async text(): Promise<string> {
    this.bodyUsed = true;
    return this.whole;
  }

  async json(): Promise<any> {
    return JSON.parse(await this.text());
  }
}

/** A JSON reply. */
export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): FakeResponse {
  return new FakeResponse({
    status,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** A plain-text reply, as core's gateway sends "OK". */
export function textResponse(body: string, status = 200, headers: Record<string, string> = {}): FakeResponse {
  return new FakeResponse({ status, headers: { 'content-type': 'text/plain', ...headers }, body });
}

function headersOf(init: any): Record<string, string> {
  const out: Record<string, string> = {};
  const h = init?.headers;
  if (!h) return out;
  if (typeof h.forEach === 'function' && !Array.isArray(h)) {
    h.forEach((value: string, key: string) => (out[key.toLowerCase()] = value));
  } else {
    for (const [key, value] of Array.isArray(h) ? h : Object.entries(h)) out[String(key).toLowerCase()] = String(value);
  }
  return out;
}

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

export class FakeFetch {
  readonly requests: RecordedRequest[] = [];
  private readonly replies: Reply[] = [];
  private original: typeof fetch | undefined;

  /** The function to hand to the library, as the global or as an option. */
  readonly fetch = async (input: any, init: any = {}): Promise<any> => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    let json: any;
    if (typeof init.body === 'string') {
      try {
        json = JSON.parse(init.body);
      } catch (_) {
        json = undefined;
      }
    }
    const request: RecordedRequest = {
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers: headersOf(init),
      body: init.body,
      json,
      signal: init.signal,
    };
    this.requests.push(request);
    if (init.signal?.aborted) throw abortError();

    const reply = this.replies.shift();
    if (reply === undefined) {
      throw new Error(`The fake fetch had no reply queued for ${request.method} ${url}`);
    }
    const answered = typeof reply === 'function' ? await reply(request) : reply;
    if (init.signal?.aborted) throw abortError();
    if (answered instanceof Error) throw answered;
    return answered;
  };

  /** Queues replies, answered in order. */
  reply(...replies: Reply[]): this {
    this.replies.push(...replies);
    return this;
  }

  /** How many queued replies no call has taken yet. */
  get pending(): number {
    return this.replies.length;
  }

  get last(): RecordedRequest | undefined {
    return this.requests[this.requests.length - 1];
  }

  /** Puts this fake in place of the global fetch. */
  install(): this {
    this.original = globalThis.fetch;
    (globalThis as any).fetch = this.fetch;
    return this;
  }

  /** Puts the global fetch back. */
  restore(): void {
    if (this.original) (globalThis as any).fetch = this.original;
    this.original = undefined;
  }
}
