// An XMLHttpRequest the tests drive chunk by chunk, as React Native's grows `responseText`
// and fires `progress`. Core never uses XHR; Blue mode's reader does (library §2.3).

type Handler = ((event: any) => void) | null;

export class FakeXMLHttpRequest {
  static readonly UNSENT = 0;
  static readonly OPENED = 1;
  static readonly HEADERS_RECEIVED = 2;
  static readonly LOADING = 3;
  static readonly DONE = 4;

  /** Every request made since the last reset, oldest first. */
  static instances: FakeXMLHttpRequest[] = [];

  static get last(): FakeXMLHttpRequest | undefined {
    return FakeXMLHttpRequest.instances[FakeXMLHttpRequest.instances.length - 1];
  }

  static reset(): void {
    FakeXMLHttpRequest.instances = [];
  }

  readyState = FakeXMLHttpRequest.UNSENT;
  status = 0;
  statusText = '';
  responseText = '';
  responseType = '';
  timeout = 0;
  withCredentials = false;

  method = '';
  url = '';
  /** Header names lowercased. */
  requestHeaders: Record<string, string> = {};
  body: unknown = undefined;
  sent = false;
  aborted = false;
  /** Whether `onprogress` (or a progress listener) was set before send(), as React Native needs. */
  progressSetAtSend = false;

  onreadystatechange: Handler = null;
  onprogress: Handler = null;
  onload: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  ontimeout: Handler = null;
  onloadend: Handler = null;

  private responseHeaders = new Map<string, string>();
  private listeners = new Map<string, ((event: any) => void)[]>();

  constructor() {
    FakeXMLHttpRequest.instances.push(this);
  }

  open(method: string, url: string): void {
    this.method = method.toUpperCase();
    this.url = url;
    this.readyState = FakeXMLHttpRequest.OPENED;
    this.fire('readystatechange');
  }

  setRequestHeader(name: string, value: string): void {
    if (this.readyState !== FakeXMLHttpRequest.OPENED || this.sent) {
      throw new Error('setRequestHeader called outside OPENED');
    }
    this.requestHeaders[name.toLowerCase()] = value;
  }

  send(body?: unknown): void {
    if (this.readyState !== FakeXMLHttpRequest.OPENED || this.sent) throw new Error('send called twice or before open');
    this.body = body;
    this.sent = true;
    this.progressSetAtSend = this.onprogress !== null || (this.listeners.get('progress')?.length ?? 0) > 0;
  }

  abort(): void {
    if (this.aborted || this.readyState === FakeXMLHttpRequest.DONE) return;
    this.aborted = true;
    this.readyState = FakeXMLHttpRequest.DONE;
    this.status = 0;
    this.fire('readystatechange');
    this.fire('abort');
    this.fire('loadend');
  }

  getResponseHeader(name: string): string | null {
    if (this.readyState < FakeXMLHttpRequest.HEADERS_RECEIVED) return null;
    return this.responseHeaders.get(name.toLowerCase()) ?? null;
  }

  getAllResponseHeaders(): string {
    if (this.readyState < FakeXMLHttpRequest.HEADERS_RECEIVED) return '';
    return [...this.responseHeaders].map(([k, v]) => `${k}: ${v}\r\n`).join('');
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    const list = this.listeners.get(type);
    if (list) this.listeners.set(type, list.filter((l) => l !== listener));
  }

  // The server's side.

  /** The status line and headers arriving. */
  respond(status = 200, headers: Record<string, string> = {}, statusText = ''): void {
    this.status = status;
    this.statusText = statusText;
    for (const [k, v] of Object.entries(headers)) this.responseHeaders.set(k.toLowerCase(), v);
    this.readyState = FakeXMLHttpRequest.HEADERS_RECEIVED;
    this.fire('readystatechange');
  }

  /** More of the body arriving: responseText grows, then `progress` fires. */
  push(text: string): void {
    if (this.readyState < FakeXMLHttpRequest.HEADERS_RECEIVED) this.respond();
    this.responseText += text;
    this.readyState = FakeXMLHttpRequest.LOADING;
    this.fire('readystatechange');
    this.fire('progress', { loaded: this.responseText.length, lengthComputable: false });
  }

  /** The body ending, with an optional last piece that only `load` sees. */
  finish(tail = ''): void {
    if (this.readyState < FakeXMLHttpRequest.HEADERS_RECEIVED) this.respond();
    this.responseText += tail;
    this.readyState = FakeXMLHttpRequest.DONE;
    this.fire('readystatechange');
    this.fire('load');
    this.fire('loadend');
  }

  /** A network failure. */
  fail(): void {
    this.readyState = FakeXMLHttpRequest.DONE;
    this.status = 0;
    this.fire('readystatechange');
    this.fire('error');
    this.fire('loadend');
  }

  private fire(type: string, extra: Record<string, unknown> = {}): void {
    const event = { type, target: this, ...extra };
    const handler = (this as any)[`on${type}`] as Handler;
    if (handler) handler.call(this, event);
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener.call(this, event);
  }
}

/** Puts the fake in place of the global XMLHttpRequest; returns the function that undoes it. */
export function installFakeXhr(): () => void {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'XMLHttpRequest');
  const original = (globalThis as any).XMLHttpRequest;
  (globalThis as any).XMLHttpRequest = FakeXMLHttpRequest;
  return () => {
    if (had) (globalThis as any).XMLHttpRequest = original;
    else delete (globalThis as any).XMLHttpRequest;
  };
}
