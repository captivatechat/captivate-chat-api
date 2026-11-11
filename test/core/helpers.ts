// Shared by core's tests. The fakes go in before src loads (see each fake's note).
import '../fakes/console';
import { FakeWebSocket } from '../fakes/websocket';
import { CaptivateChatAPI, CaptivateChatAPIOptions } from '../../src/api/CaptivateChatAPI';

let made = 0;

/** A key no other test in this process used: instances are kept per key and mode. */
export function freshKey(): string {
  made += 1;
  return `test-key-${made}`;
}

/** A new instance with its socket open and socket_connected received. */
export async function connectedApi(
  options: CaptivateChatAPIOptions = {},
  mode: 'prod' | 'dev' = 'prod',
  socketId = 'socket-1'
): Promise<CaptivateChatAPI> {
  const api = new CaptivateChatAPI(freshKey(), mode, options);
  const connecting = api.connect();
  FakeWebSocket.last!.open(socketId);
  await connecting;
  return api;
}

/** CaptivateChatAPI.create's guarded instance, its socket opened by hand. */
export async function createdApi(
  options: CaptivateChatAPIOptions = {},
  mode: 'prod' | 'dev' = 'prod',
  socketId = 'socket-1'
): Promise<CaptivateChatAPI> {
  const creating = CaptivateChatAPI.create(freshKey(), mode, options);
  FakeWebSocket.last!.open(socketId);
  return creating;
}

/** Waits, a turn at a time, until the condition holds; fails after `turns`. */
export async function until(condition: () => boolean, turns = 200): Promise<void> {
  for (let i = 0; i < turns; i++) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('The condition never held');
}

export { FakeWebSocket };
