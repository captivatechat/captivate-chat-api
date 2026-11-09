// The app's users and their secrets (first-channels-library-spec §2.6, decision 7 (a)): each
// user's conversations are bound to a secret, never to the user's ID. A secret per device, kept
// per key and user under a name holding the sha256 of the ID (often an email), never the ID; or
// one from the app's own server through options.userSecret, kept in memory only. Each
// conversation's user is kept with it, by that hash, so getConversation(id) finds it again.
import { BlueTransport } from './transport';
import { SETUP_WORDS } from './words';

/** The backend's rule for X-Blue-Conversation, with a 43-character floor: base64url only. */
export const SECRET_FORM = /^[A-Za-z0-9_-]{43,128}$/;
/** A device secret's random bytes: 43 base64url characters. */
const SECRET_BYTES = 32;
/** The conversations whose user is kept on the device; past it the oldest go. */
export const KEPT_CONVERSATIONS = 500;

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Bytes as base64url, without padding. */
export function base64url(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of Array.from(bytes)) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += BASE64URL[(value >> bits) & 63];
    }
  }
  if (bits > 0) out += BASE64URL[(value << (6 - bits)) & 63];
  return out;
}

/** Text as UTF-8; by hand where TextEncoder is missing (Hermes), a lone surrogate as U+FFFD, as TextEncoder does. */
export function utf8Bytes(text: string): Uint8Array {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text);
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      } else code = 0xfffd;
    } else if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return new Uint8Array(out);
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * SHA-256 (FIPS 180-4), synchronous and in plain JavaScript: crypto.subtle is async, missing in
 * React Native and, in browsers, on pages that aren't secure.
 */
export function sha256(data: Uint8Array): Uint8Array {
  const bitLength = data.length * 8;
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = Array.from(h);
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]);
  return out;
}

/** The part of a storage name that stands for a user: base64url(sha256(userId)). */
export function userHash(userId: string): string {
  return base64url(sha256(utf8Bytes(userId)));
}

/** A store's calls, each possibly a Promise: options.storage's `{ get, set, remove }`, or localStorage's and AsyncStorage's own names. */
interface StoreCalls {
  get(name: string): unknown;
  set(name: string, value: string): unknown;
  remove(name: string): unknown;
}

function callsOf(storage: any): StoreCalls | null {
  if (!storage || typeof storage !== 'object') return null;
  if (typeof storage.get === 'function' && typeof storage.set === 'function' && typeof storage.remove === 'function') {
    return { get: (n) => storage.get(n), set: (n, v) => storage.set(n, v), remove: (n) => storage.remove(n) };
  }
  if (typeof storage.getItem === 'function' && typeof storage.setItem === 'function' && typeof storage.removeItem === 'function') {
    return { get: (n) => storage.getItem(n), set: (n, v) => storage.setItem(n, v), remove: (n) => storage.removeItem(n) };
  }
  return null;
}

/** The runtime's localStorage, whose accessor alone can throw (a private window, blocked site data). */
function localStorageCalls(): StoreCalls | null {
  try {
    return callsOf((globalThis as any).localStorage);
  } catch (_) {
    return null;
  }
}

/** A user named on this instance: their ID and secret, in memory. */
interface KnownUser {
  userId: string;
  secret: string;
}

/**
 * One instance's users: their secrets (memory first, then the device's storage), the user each
 * conversation belongs to, and the last user named. Every storage call goes through one queue, in
 * order, so a forgetUser() is done before a later call reads; a store that fails is left for memory.
 */
export class BlueUsers {
  private readonly transport: BlueTransport;
  /** By user hash. */
  private readonly known = new Map<string, KnownUser>();
  /** Conversation id to user hash, in memory. */
  private readonly owners = new Map<string, string>();
  /** What a failed or missing store would have held. */
  private readonly memory = new Map<string, string>();
  /** A device secret being made, so two calls at once make one. */
  private readonly making = new Map<string, Promise<string | null>>();
  private queue: Promise<unknown> = Promise.resolve();
  /** How many times each user hash was forgotten: a lookup begun before a forget doesn't bring the user back. */
  private readonly forgotten = new Map<string, number>();
  /** The last user a call named on this instance: a handle without a user of its own takes theirs. */
  lastUser: string | null = null;

  constructor(transport: BlueTransport) {
    this.transport = transport;
  }

  private get prefix(): string {
    return `vb:${this.transport.apiKey}:`;
  }

  /** The store: options.storage, else localStorage, else none (memory). */
  private get store(): StoreCalls | null {
    return callsOf(this.transport.settings.storage) ?? localStorageCalls();
  }

  /** Runs `step` after every storage call before it. */
  private inTurn<T>(step: () => Promise<T>): Promise<T> {
    const run = this.queue.then(step, step);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async read(name: string): Promise<string | null> {
    const store = this.store;
    if (store) {
      try {
        const value = await store.get(name);
        if (typeof value === 'string') return value;
        if (value === null || value === undefined) return this.memory.get(name) ?? null;
      } catch (_) {
        this.transport.logger.log('Blue mode: the storage could not be read, so memory is used');
      }
    }
    return this.memory.get(name) ?? null;
  }

  private async write(name: string, value: string | null): Promise<void> {
    if (value === null) this.memory.delete(name);
    else this.memory.set(name, value);
    const store = this.store;
    if (!store) return;
    try {
      await (value === null ? store.remove(name) : store.set(name, value));
      // Kept by the store now: memory holds only what a store couldn't take.
      if (value !== null) this.memory.delete(name);
    } catch (_) {
      this.transport.logger.log('Blue mode: the storage could not be written, so memory is used');
    }
  }

  /** The user's secret: their own server's (options.userSecret), else the device's, made on first use when `make`. Null when there is none. */
  secretFor(userId: string, make: boolean): Promise<string | null> {
    const hash = userHash(userId);
    const known = this.known.get(hash);
    if (known && known.userId === userId) {
      this.lastUser = userId;
      return Promise.resolve(known.secret);
    }
    const fromServer = this.transport.settings.userSecret;
    if (fromServer) return this.fromServer(userId, hash, fromServer);
    const forgottenThen = this.forgotten.get(hash) ?? 0;
    const already = this.making.get(hash);
    if (already) return already.then((secret) => (secret ?? (make ? this.secretFor(userId, make) : null)));
    const found = this.inTurn(async () => {
      let secret = await this.read(this.prefix + hash);
      if (secret !== null && !SECRET_FORM.test(secret)) secret = null;
      if (secret === null && make) {
        secret = base64url(this.transport.randomBytes(SECRET_BYTES));
        await this.write(this.prefix + hash, secret);
      }
      return secret;
    });
    const made = found.then((secret) => {
      this.making.delete(hash);
      if (secret !== null && (this.forgotten.get(hash) ?? 0) === forgottenThen) {
        this.known.set(hash, { userId, secret });
        this.lastUser = userId;
      }
      return secret;
    });
    this.making.set(hash, made);
    return made;
  }

  private async fromServer(userId: string, hash: string, get: (userId: string) => string | Promise<string>): Promise<string> {
    const forgottenThen = this.forgotten.get(hash) ?? 0;
    const secret = await get(userId);
    if (typeof secret !== 'string' || !SECRET_FORM.test(secret)) throw new Error(SETUP_WORDS.userSecretForm);
    if ((this.forgotten.get(hash) ?? 0) === forgottenThen) {
      this.known.set(hash, { userId, secret });
      this.lastUser = userId;
    }
    return secret;
  }

  /** The kept list of conversation id to user hash, oldest first. */
  private async owned(): Promise<[string, string][]> {
    const text = await this.read(`${this.prefix}conversations`);
    if (!text) return [];
    try {
      const list = JSON.parse(text);
      return Array.isArray(list) ? list.filter((e) => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string') : [];
    } catch (_) {
      return [];
    }
  }

  /** Keeps each conversation's user: in memory, and on the device unless `keep` is false. */
  bind(conversationIds: string[], userId: string, keep = true): Promise<void> {
    const hash = userHash(userId);
    for (const id of conversationIds) this.owners.set(id, hash);
    if (!keep || conversationIds.length === 0) return Promise.resolve();
    return this.inTurn(async () => {
      const list = (await this.owned()).filter(([id]) => !conversationIds.includes(id));
      for (const id of conversationIds) list.push([id, hash]);
      await this.write(`${this.prefix}conversations`, JSON.stringify(list.slice(-KEPT_CONVERSATIONS)));
    });
  }

  /** The user a conversation belongs to, known on this instance or kept on the device; null when neither knows. */
  userOf(conversationId: string): KnownUser | null {
    const hash = this.owners.get(conversationId);
    return hash ? this.known.get(hash) ?? null : null;
  }

  /** The secret of a conversation's user, from memory, then the device; null when nothing here knows it. */
  async secretOfConversation(conversationId: string): Promise<string | null> {
    const hash =
      this.owners.get(conversationId) ??
      (await this.inTurn(async () => (await this.owned()).find(([id]) => id === conversationId)?.[1]));
    if (!hash) return null;
    this.owners.set(conversationId, hash);
    const known = this.known.get(hash);
    if (known) return known.secret;
    // A secret from the app's server needs the user's ID, which the device never keeps.
    if (this.transport.settings.userSecret) return null;
    const secret = await this.inTurn(() => this.read(this.prefix + hash));
    return secret !== null && SECRET_FORM.test(secret) ? secret : null;
  }

  /** The conversations kept here for a user, in memory. */
  conversationsOf(userId: string): string[] {
    const hash = userHash(userId);
    return [...this.owners].filter(([, h]) => h === hash).map(([id]) => id);
  }

  /** forgetUser: the user's secret and their conversations' users, in memory and on the device. */
  forget(userId: string): Promise<void> {
    const hash = userHash(userId);
    this.forgotten.set(hash, (this.forgotten.get(hash) ?? 0) + 1);
    this.known.delete(hash);
    for (const [id, h] of [...this.owners]) if (h === hash) this.owners.delete(id);
    if (this.lastUser === userId) this.lastUser = null;
    return this.inTurn(async () => {
      await this.write(this.prefix + hash, null);
      const list = await this.owned();
      const left = list.filter(([, h]) => h !== hash);
      if (left.length !== list.length) await this.write(`${this.prefix}conversations`, JSON.stringify(left));
    });
  }
}
