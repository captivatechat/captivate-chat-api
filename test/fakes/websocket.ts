// A WebSocket the tests drive by hand. CaptivateChatAPI picks its WebSocket class once, when
// its module loads (window's, then global's, then `ws`), so importing this file installs the
// fake on the global first: import it before anything from src.

type Listener = (event: any) => void;

export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  /** Every socket made since the last reset, oldest first. */
  static instances: FakeWebSocket[] = [];

  /** The last socket made. */
  static get last(): FakeWebSocket | undefined {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  /** What the library closed this socket with, if it did. */
  closedWith: { code?: number; reason?: string } | null = null;
  /** Frames the library sent over the socket (core sends over HTTP, so this stays empty). */
  sent: unknown[] = [];
  private listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    if (!list.includes(listener)) list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type);
    if (list) this.listeners.set(type, list.filter((l) => l !== listener));
  }

  /** How many listeners of a type are on this socket. */
  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.closedWith = { code, reason };
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', { code: code ?? 1005, reason: reason ?? '' });
  }

  // The server's side.

  /** Opens the socket and, unless told otherwise, sends core's socket_connected. */
  open(socketId: string | null = 'socket-1'): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
    if (socketId !== null) {
      this.receive({ event: { event_type: 'socket_connected', event_payload: { socket_id: socketId } } });
    }
  }

  /** Delivers a frame: an object is sent as JSON, a string as it is. */
  receive(frame: unknown): void {
    this.emit('message', { data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }

  /** The server or the network closing the socket. */
  drop(code = 1006): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', { code, reason: '' });
  }

  fail(message = 'WebSocket error'): void {
    this.emit('error', { message });
  }

  private emit(type: string, event: any): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

Object.defineProperty(globalThis, 'WebSocket', {
  value: FakeWebSocket,
  writable: true,
  configurable: true,
});
