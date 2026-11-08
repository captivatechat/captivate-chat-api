// Shared by Blue mode's tests. The fakes go in before src loads (see each fake's note).
import '../fakes/console';
import { FakeWebSocket } from '../fakes/websocket';

let made = 0;

/** A new 24-hex id, so each test gets keys no other test in this process used. */
export function freshId(): string {
  made += 1;
  return made.toString(16).padStart(24, '0');
}

/** An app key no other test in this process used: instances are kept per key and mode. */
export function appKey(): string {
  return `vba_${freshId()}`;
}

/** A whole server key's form, with a made-up secret. */
export function serverKey(): string {
  return `vbk_${freshId()}_${'ab'.repeat(32)}`;
}

export { FakeWebSocket };
