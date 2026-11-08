// Shared by the answer's tests: a Blue conversation on the fakes, and every call its listeners get.
import { CaptivateChatAPI } from '../../src/api/CaptivateChatAPI';
import { Conversation } from '../../src/api/Conversation';
import { BlueTransport } from '../../src/api/blue/transport';
import { FakeClock } from '../fakes/clock';

export const SECRET = 's'.repeat(43);
export const NDJSON = { 'content-type': 'application/x-ndjson; charset=utf-8' };

/** One call an app's listener got: the listener's name and what it was given. */
export interface Call {
  listener: string;
  args: unknown[];
}

export const LISTENERS = ['onStep', 'onDelta', 'onMessage', 'onActionReceived', 'onAnswer', 'onConversationUpdate', 'onError'] as const;
export type ListenerName = (typeof LISTENERS)[number];

/** A Blue conversation handle, as L4's createConversation will make one. */
export function blueConversation(api: CaptivateChatAPI, clock: FakeClock, id = '0000000000000000000000c1'): Conversation {
  const transport = (api as any).blue as BlueTransport;
  return new Conversation(id, null, {}, transport.apiKey, 'prod', null, api, { transport, secret: SECRET, clock });
}

/** Registers the listeners named (all by default) and records each call, in order. */
export function record(conversation: Conversation, listeners: readonly ListenerName[] = LISTENERS): Call[] {
  const calls: Call[] = [];
  for (const listener of listeners) {
    (conversation as any)[listener]((...args: unknown[]) => calls.push({ listener, args: JSON.parse(JSON.stringify(args)) }));
  }
  return calls;
}

/** Lets promise chains (fetch's, a ReadableStream's reads, the send queue) run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

/** Moves the clock on, letting what each timer starts run. */
export async function tick(clock: FakeClock, ms: number): Promise<void> {
  clock.tick(ms);
  await flush();
}

/** A response whose body the test feeds by hand. */
export function handBody(status = 200) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  const encoder = new TextEncoder();
  return {
    response: { ok: status >= 200 && status < 300, status, statusText: 'OK', headers: { get: () => null }, body, text: async () => '' },
    push: (piece: string) => controller.enqueue(encoder.encode(piece)),
    close: () => controller.close(),
    fail: () => controller.error(new TypeError('network error')),
  };
}

/** Each line of a stream, newline kept: one network chunk a line. */
export function lineChunks(text: string): string[] {
  return text.split(/(?<=\n)/).filter((piece) => piece !== '');
}

/** The names of the calls, in order. */
export const names = (calls: Call[]) => calls.map((c) => c.listener);
