// An answer (first-channels-library-spec §2.4, §2.5; gaps G2, G3, G16): one conversation's
// sends, each streamed to the app as drafts and then one final answer, never twice. The answer
// outlives its request, so a cut is never sent again: it is read back and matched by the
// message's own clientId. Stop, a 409's hold and resume() are here too. The Conversation hands
// in its listeners (emit, has) and keeps its own methods' names and shapes.
import { draftText, withFooter } from './citations';
import { attachmentsOf } from './files';
import { BlueUser } from './identity';
import { BlueOffer, BlueSource, BlueStreamEvent } from './ndjson';
import { BluePressAnswer, OFFER_ID, pressText, pressValues } from './offers';
import { BlueReadWay, BlueStream, Clock, RUNTIME_CLOCK, StreamEnd, openStream, pickWay } from './stream';
import { BlueError, BlueTransport, DISPOSED, blueError } from './transport';
import { CONSOLE_WORDS, SETUP_WORDS, WORDS } from './words';

/** The Conversation's listener lists Blue mode emits to: core's event names where core has the listener. */
export const BLUE_EVENTS = {
  message: 'bot_message',
  error: 'general_error',
  update: 'conversation_update',
  action: 'action',
  delta: 'delta',
  answer: 'answer',
  step: 'step',
} as const;
export type BlueEventName = (typeof BLUE_EVENTS)[keyof typeof BLUE_EVENTS];

/** A follow's waits between read-backs, then the last one again: Blue's own window's FOLLOW_WAITS. */
export const FOLLOW_WAITS = [3_000, 5_000, 8_000, 12_000, 15_000];
/** A follow, or a 409's hold, gives up after this: the backend's 600 s busy lock. */
export const FOLLOW_MS = 600_000;
/** Two read-backs at least this far apart, neither answering, with no message of the send's clientId: it wasn't stored. */
export const NOT_STORED_MS = 5_000;
/** What onAnswer gives for an answer that was stopped. */
export const STOPPED_TEXT = 'Stopped.';

/** What onAnswer gives, once per answer. */
export interface BlueAnswer {
  text: string;
  /** The backend's numbers, which match the [n] in `text`. */
  sources: BlueSource[];
  stopped?: boolean;
  /** Quick replies: an app answers one by sending its text. */
  choices?: string[];
  /** The form the bot offered under the answer; for a press (sendAction), the press's own answer. */
  offer?: BlueOffer | BluePressAnswer;
}

/** onConversationUpdate's, made by the library. */
export interface BlueUpdate {
  type: 'answering' | 'stopped' | 'busy' | 'unavailable';
  conversationId: string;
}

/** onError's, in core's shape. */
export interface BlueErrorEvent {
  conversationId: string;
  /** The HTTP status; none when Blue couldn't be reached, or the answer failed after its request. */
  errorCode?: number;
  errorDesc: string;
  retryAfter?: number;
}

/** What a Conversation gives its answers. */
export interface BlueConversationHost {
  transport: BlueTransport;
  conversationId: string;
  /** The user's secret, as X-Blue-Conversation; in server mode the user's ID, as X-Blue-User. */
  secret: string;
  /** Calls each listener of a list. */
  emit: (name: BlueEventName, ...args: unknown[]) => void;
  /** Whether a list has a listener now. */
  has: (name: BlueEventName) => boolean;
  /** Who the customer is and the details the bot reads, as they stand at each send and press (§2.7). */
  customer: () => { user: BlueUser; details?: Record<string, string> };
  /** The runtime's timers by default; a hand-driven clock in tests. */
  clock?: Clock;
}

/** The read-back as the answers read it (GET /v1/chat/:id): Blue's ChatReadBack, the parts used here. */
interface ReadBack {
  answering?: boolean;
  messages?: ReadBackMessage[];
}
interface ReadBackMessage {
  role?: string;
  content?: unknown;
  sources?: unknown;
  stopped?: boolean;
  offer?: BlueOffer;
  clientId?: string;
}

/** Past the hold's 10 minutes, or dropped by Stop: §1.2's busy words, as a 409. */
const busyError = () => blueError(WORDS.busy, { status: 409, statusText: 'Conflict', code: 'busy' });

/** One sendMessage, from its queue to its answer. */
interface Send {
  text: string;
  /** The files' places, from conversation.fileManager (§2.9). */
  attachments: { uploadId: string }[];
  clientId: string;
  /** onMessage has had the answer's text (or the answer had none): nothing but onAnswer comes after. */
  delivered: boolean;
  /** onAnswer was given, or the send ended without an answer: nothing comes for it any more. */
  finished: boolean;
  stream: BlueStream | null;
  /** A response event has come on this send's current stream. */
  started: boolean;
  /** Stop answered false before the first event: send it once more then (own choice 77). */
  stopAgain: boolean;
  /** Its first request has gone out (it isn't waiting behind the one before). */
  sent: boolean;
  /** Held behind a 409 busy. */
  held: boolean;
  /** onConversationUpdate's busy was given for it. */
  busyTold: boolean;
  /** Dropped by Stop while held: never sent. */
  dropped: boolean;
  /** resume() aborted the stream: read the answer back. */
  resumed: boolean;
  /** Stop's own call failed, so the request was aborted here. */
  stopFailed: boolean;
  /** Wakes a follow's or a hold's wait (resume, Stop, dispose). */
  wake?: () => void;
  raw: string;
  sources: BlueSource[];
  final: string | null;
  choices?: string[];
  offer?: BlueOffer;
  offerGiven: boolean;
  stopped: boolean;
  stoppedTold: boolean;
  /** sendMessage's promise: settled once. */
  handed: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  /** The send's last request has closed: the next send may go. */
  close: () => void;
}

export class BlueAnswers {
  private readonly host: BlueConversationHost;
  private readonly clock: Clock;
  private readonly pending = new Set<Send>();
  /** The last send's close: each send goes once the one before has closed its request (own choice 71). */
  private lastClosed: Promise<void> = Promise.resolve();
  /** The offers seen in this conversation, by id: a press reads its kind and its first field's label. */
  private readonly offers = new Map<string, BlueOffer>();

  constructor(host: BlueConversationHost) {
    this.host = host;
    this.clock = host.clock ?? RUNTIME_CLOCK;
  }

  private get transport(): BlueTransport {
    return this.host.transport;
  }

  private get path(): string {
    return `/v1/chat/${encodeURIComponent(this.host.conversationId)}`;
  }

  private emit(name: BlueEventName, ...args: unknown[]): void {
    this.host.emit(name, ...args);
  }

  private update(type: BlueUpdate['type']): void {
    this.emit(BLUE_EVENTS.update, { type, conversationId: this.host.conversationId } satisfies BlueUpdate);
  }

  private errorEvent(words: string, error?: BlueError): BlueErrorEvent {
    return {
      conversationId: this.host.conversationId,
      ...(error?.status !== undefined ? { errorCode: error.status } : {}),
      errorDesc: words,
      ...(error?.retryAfter !== undefined ? { retryAfter: error.retryAfter } : {}),
    };
  }

  /**
   * Sends a message: resolves at the stream's `conversation` event (reading whole, at the
   * response's headers), or at a cut, whose answer comes by the read-back; rejects at a refusal.
   */
  send(content: unknown): Promise<void> {
    if (this.transport.isDisposed) return Promise.reject(new Error(DISPOSED));
    const text = typeof content === 'string' ? content : typeof (content as any)?.text === 'string' ? (content as any).text : '';
    let attachments: { uploadId: string }[];
    try {
      attachments = typeof content === 'string' ? [] : attachmentsOf((content as any)?.files);
    } catch (error) {
      return Promise.reject(error);
    }
    let close!: () => void;
    const closed = new Promise<void>((r) => (close = r));
    const handed = new Promise<void>((resolve, reject) => {
      const send: Send = {
        text,
        attachments,
        clientId: this.clientId(),
        delivered: false,
        finished: false,
        stream: null,
        started: false,
        stopAgain: false,
        sent: false,
        held: false,
        busyTold: false,
        dropped: false,
        resumed: false,
        stopFailed: false,
        raw: '',
        sources: [],
        final: null,
        offerGiven: false,
        stopped: false,
        stoppedTold: false,
        handed: false,
        resolve,
        reject,
        close,
      };
      this.pending.add(send);
      const before = this.lastClosed;
      this.lastClosed = closed;
      before
        .then(() => this.attempt(send, null))
        .catch((error) => this.transport.logger.warn('Blue mode: a message could not be sent', error));
    });
    return handed;
  }

  /** 22 base64url characters from 16 random bytes: the message's own id (decision 18 (a)). */
  private clientId(): string {
    const bytes = this.transport.randomBytes(16);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let out = '';
    let bits = 0;
    let value = 0;
    for (const byte of Array.from(bytes)) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 6) {
        bits -= 6;
        out += alphabet[(value >> bits) & 63];
      }
    }
    if (bits > 0) out += alphabet[(value << (6 - bits)) & 63];
    return out;
  }

  private hand(send: Send): void {
    if (send.handed) return;
    send.handed = true;
    send.resolve();
  }

  /** A refusal of the send itself: sendMessage rejects, and onError hears it unless Stop dropped it. */
  private refuse(send: Send, error: Error, tell = true): void {
    this.finish(send);
    send.close();
    if (send.handed) return;
    send.handed = true;
    if (tell && (error as BlueError).errorDesc) this.emit(BLUE_EVENTS.error, this.errorEvent((error as BlueError).errorDesc, error as BlueError));
    send.reject(error);
  }

  private finish(send: Send): void {
    send.finished = true;
    this.pending.delete(send);
  }

  /** One request for the send; `holdStarted` is when a 409's hold began, so the hold has one 10 minutes. */
  private async attempt(send: Send, holdStarted: number | null): Promise<void> {
    if (send.dropped) return;
    if (this.transport.isDisposed) return this.refuse(send, new Error(DISPOSED), false);
    send.sent = true;
    const way = pickWay(this.transport.settings);
    send.started = false;
    let stream: BlueStream;
    try {
      stream = openStream(this.transport, {
        path: '/v1/chat',
        body: this.sendBody(send),
        secret: this.host.secret,
        way,
        withFiles: send.attachments.length > 0,
        clock: this.clock,
        onOpen: () => {
          if (way === 'whole') this.hand(send);
        },
        onEvents: (events) => this.events(send, events, way),
      });
    } catch (error) {
      return this.refuse(send, error as Error, false);
    }
    send.stream = stream;
    const end = await stream.finished;
    send.stream = null;
    await this.ended(send, end, holdStarted);
  }

  /**
   * A send's body: the customer and the details as they stand now (§2.7), and `accepts` only while
   * an onActionReceived listener is registered, since only an app that draws forms gets them (§2.8).
   */
  private sendBody(send: Send): Record<string, unknown> {
    const { user, details } = this.host.customer();
    return {
      conversationId: this.host.conversationId,
      message: send.text,
      ...(send.attachments.length ? { attachments: send.attachments } : {}),
      clientId: send.clientId,
      user,
      ...(details ? { details } : {}),
      ...(this.host.has(BLUE_EVENTS.action) ? { accepts: ['offers'] } : {}),
    };
  }

  /** Keeps an offer seen in a stream or a read-back, for a press on it. */
  remember(offer: unknown): void {
    if (offer && typeof offer === 'object' && typeof (offer as BlueOffer).id === 'string') {
      this.offers.set((offer as BlueOffer).id, offer as BlueOffer);
    }
  }

  /**
   * Presses one of the bot's offers (§2.8): `of-…` ids alone (any other warns once and sends
   * nothing), a link's send refused before sending (gaps G5). The answer's text and a look-up's
   * rows go to onMessage as one message, and to onAnswer with the press's answer as `offer`. A
   * refusal goes to onError and rejects, in §1.2's words by its code.
   */
  async press(actionId: string, data: unknown): Promise<void> {
    if (this.transport.isDisposed) throw new Error(DISPOSED);
    if (typeof actionId !== 'string' || !OFFER_ID.test(actionId)) {
      this.transport.warnOnce('notAnOffer', CONSOLE_WORDS.notAnOffer);
      return;
    }
    const given = (data && typeof data === 'object' ? data : {}) as { choice?: unknown; values?: unknown };
    const choice = given.choice ?? 'send';
    const offer = this.offers.get(actionId);
    if (offer?.kind === 'link' && choice === 'send') throw new Error(SETUP_WORDS.linkOffer);
    const values = pressValues(given.values);
    if (values instanceof Error) throw values;
    const { user, details } = this.host.customer();
    let answer: BluePressAnswer | undefined;
    try {
      answer = await this.transport.request<BluePressAnswer>('POST', `${this.path}/offers/${encodeURIComponent(actionId)}`, {
        call: 'press',
        secret: this.host.secret,
        body: { choice, values, user, ...(details ? { details } : {}) },
      });
    } catch (error) {
      const refusal = error as BlueError;
      if (refusal.errorDesc && !this.transport.isDisposed) this.emit(BLUE_EVENTS.error, this.errorEvent(refusal.errorDesc, refusal));
      throw error;
    }
    const pressed: BluePressAnswer = {
      offer: answer?.offer ?? { id: actionId, status: 'sent' },
      ...(answer?.lookup ? { lookup: answer.lookup } : {}),
      messages: Array.isArray(answer?.messages) ? answer!.messages : [],
    };
    if (offer && typeof pressed.offer.status === 'string') this.offers.set(actionId, { ...offer, status: pressed.offer.status });
    const text = pressText(pressed, offer);
    if (text) this.emit(BLUE_EVENTS.message, [{ type: 'text', text }], 'ai_agent');
    this.emit(BLUE_EVENTS.answer, { text, sources: [], offer: pressed } satisfies BlueAnswer);
  }

  private async ended(send: Send, end: StreamEnd, holdStarted: number | null): Promise<void> {
    if (end.kind === 'refused') {
      if (end.error.status === 409 && end.error.code === 'busy') return this.hold(send, holdStarted);
      return this.refuse(send, end.error);
    }
    // dispose(): nothing more is said, and a send not yet handed over rejects.
    if (end.kind === 'aborted' && !send.stopFailed && (!send.resumed || this.transport.isDisposed)) {
      return this.refuse(send, new Error(DISPOSED), false);
    }
    send.close();
    this.hand(send);
    if (end.kind === 'ended') {
      if (send.finished) return;
      if (send.stopped) return this.answerStopped(send);
      // An end after the answer's text but before its done (an error after it): the answer as it came.
      if (send.delivered) return this.giveAnswer(send);
      return this.couldntAnswer(send);
    }
    if (end.kind === 'aborted' && send.stopFailed) {
      if (send.finished) return;
      return send.delivered ? this.giveAnswer(send) : this.answerStopped(send);
    }
    // A cut, or resume(): never sent again, read back (§2.5); after resume() at once.
    const now = send.resumed;
    send.resumed = false;
    if (!send.finished) await this.follow(send, now);
  }

  /** One network chunk's events: in order, then the draft once, after the chunk's last line (own choice 53). */
  private events(send: Send, events: BlueStreamEvent[], way: BlueReadWay): void {
    let drafted = false;
    for (const event of events) {
      if (send.finished) return;
      if (!send.started) {
        send.started = true;
        if (send.stopAgain) {
          send.stopAgain = false;
          this.callStop().catch(() => undefined);
        }
      }
      switch (event.type) {
        case 'conversation':
          this.hand(send);
          break;
        case 'step':
          this.emit(BLUE_EVENTS.step, event.label);
          break;
        case 'reset':
          send.raw = '';
          drafted = false;
          if (way !== 'whole' && !send.delivered) this.emit(BLUE_EVENTS.delta, '', { reset: true });
          break;
        case 'delta':
          send.raw += event.text;
          drafted = true;
          break;
        case 'sources':
          send.sources = event.sources;
          break;
        case 'text':
          this.deliver(send, event.text);
          break;
        case 'offer':
          send.offer = event.offer;
          this.giveOffer(send);
          break;
        case 'choices':
          send.choices = event.choices;
          break;
        case 'stopped':
          send.stopped = true;
          this.tellStopped(send);
          break;
        case 'error':
          // After the answer's text only onAnswer can come (§2.4), at the stream's end.
          if (!send.delivered) this.couldntAnswer(send);
          break;
        case 'done':
          if (send.stopped) this.answerStopped(send);
          else this.giveAnswer(send);
          break;
      }
    }
    if (drafted && way !== 'whole' && !send.delivered && !send.finished) {
      this.emit(BLUE_EVENTS.delta, draftText(send.raw), { reset: false });
    }
  }

  /** onMessage, once per answer and never for an empty text; the footer only when no onAnswer is registered (own choice 55). */
  private deliver(send: Send, text: string): void {
    if (send.final === null) send.final = text;
    if (send.delivered) return;
    send.delivered = true;
    if (!text) return;
    const shown = this.host.has(BLUE_EVENTS.answer) ? text : withFooter(text, send.sources);
    this.emit(BLUE_EVENTS.message, [{ type: 'text', text: shown }], 'ai_agent');
  }

  private giveOffer(send: Send): void {
    if (send.offerGiven || !send.offer) return;
    send.offerGiven = true;
    this.remember(send.offer);
    this.emit(BLUE_EVENTS.action, [{ id: send.offer.id, data: send.offer }]);
  }

  private giveAnswer(send: Send): void {
    if (send.finished) return;
    this.finish(send);
    const answer: BlueAnswer = {
      text: send.final ?? '',
      sources: send.sources,
      ...(send.choices ? { choices: send.choices } : {}),
      ...(send.offer ? { offer: send.offer } : {}),
    };
    this.emit(BLUE_EVENTS.answer, answer);
  }

  private tellStopped(send: Send): void {
    if (send.stoppedTold) return;
    send.stoppedTold = true;
    this.update('stopped');
  }

  /** A stopped answer: no onMessage, onAnswer's "Stopped." (own choice 56). */
  private answerStopped(send: Send): void {
    if (send.finished) return;
    send.delivered = true;
    this.tellStopped(send);
    this.finish(send);
    this.emit(BLUE_EVENTS.answer, { text: STOPPED_TEXT, sources: [], stopped: true } satisfies BlueAnswer);
  }

  /** After the send was handed over: onMessage's "[Error: …]" and onError, in §1.2's words. */
  private failed(send: Send, words: string, error?: BlueError): void {
    if (send.finished) return;
    this.finish(send);
    this.emit(BLUE_EVENTS.message, `[Error: ${words}]`, 'error');
    this.emit(BLUE_EVENTS.error, this.errorEvent(words, error));
  }

  private couldntAnswer(send: Send): void {
    if (send.finished) return;
    this.failed(send, WORDS.couldntAnswer);
    this.update('unavailable');
  }

  /** Waits `ms` on the clock, or until woken. */
  private pause(send: Send, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = this.clock.setTimeout(() => {
        send.wake = undefined;
        resolve();
      }, ms);
      send.wake = () => {
        this.clock.clearTimeout(timer);
        send.wake = undefined;
        resolve();
      };
    });
  }

  /**
   * Reads the conversation back at FOLLOW_WAITS, within FOLLOW_MS of `started` (gaps G3: a 429
   * waits its Retry-After; a 5xx, no network or a read that ran out keeps the waits; 404, 401
   * and 403 end it). Gives each read that came, until `read` says it's done; or how it ended.
   * `now` reads first without waiting.
   */
  private async readBack(
    send: Send,
    started: number,
    now: boolean,
    read: (back: ReadBack) => boolean,
    still: () => boolean
  ): Promise<{ kind: 'done' | 'ran-out' | 'stopped' } | { kind: 'refused'; refusal: BlueError }> {
    const untrack = this.transport.track({ abort: () => send.wake?.() });
    try {
      let next = now ? 0 : 1;
      let wait = now ? 0 : FOLLOW_WAITS[0];
      for (;;) {
        const left = FOLLOW_MS - (this.clock.now() - started);
        if (left <= 0) return { kind: 'ran-out' };
        if (wait > 0) await this.pause(send, Math.min(wait, left));
        if (!still() || this.transport.isDisposed) return { kind: 'stopped' };
        wait = FOLLOW_WAITS[Math.min(next, FOLLOW_WAITS.length - 1)];
        next += 1;
        let back: ReadBack;
        try {
          back = (await this.transport.request<ReadBack>('GET', this.path, { call: 'conversation', secret: this.host.secret })) ?? {};
        } catch (error) {
          if (!still() || this.transport.isDisposed) return { kind: 'stopped' };
          const refusal = error as BlueError;
          if (refusal.status === 429) wait = Math.max(wait, (refusal.retryAfter ?? 0) * 1000);
          else if (refusal.status === 404 || refusal.status === 401 || refusal.status === 403) return { kind: 'refused', refusal };
          continue;
        }
        if (!still()) return { kind: 'stopped' };
        if (read(back)) return { kind: 'done' };
      }
    } finally {
      send.wake = undefined;
      untrack();
    }
  }

  /** A cut's follow: the answer read back and matched by the send's clientId (§2.5). */
  private async follow(send: Send, now: boolean): Promise<void> {
    let answering = false;
    let missedAt: number | null = null;
    const end = await this.readBack(
      send,
      this.clock.now(),
      now,
      (back) => {
        if (back.answering === true) {
          if (!answering) {
            answering = true;
            if (!send.delivered) this.emit(BLUE_EVENTS.delta, '', { reset: true });
            this.update('answering');
          }
          return false;
        }
        const messages = Array.isArray(back.messages) ? back.messages : [];
        const at = messages.findIndex((m) => m?.role === 'user' && m.clientId === send.clientId);
        if (at < 0) {
          const now = this.clock.now();
          if (missedAt === null) missedAt = now;
          else if (now - missedAt >= NOT_STORED_MS) {
            this.failed(send, WORDS.didntGoThrough);
            return true;
          }
          return false;
        }
        // Its answer comes right after it, before any other message of the customer's.
        let reply: ReadBackMessage | undefined;
        for (const m of messages.slice(at + 1)) {
          if (m?.role === 'user') break;
          if (m?.role === 'assistant') {
            reply = m;
            break;
          }
        }
        if (!reply) this.couldntAnswer(send);
        else this.readAnswer(send, reply);
        return true;
      },
      () => !send.finished
    );
    if (end.kind === 'ran-out') this.couldntAnswer(send);
    if (end.kind === 'refused') this.failed(send, end.refusal.errorDesc, end.refusal);
    if (end.kind === 'stopped' && !send.finished) this.finish(send);
  }

  /** The stored answer: onMessage unless given already or stopped, onAnswer, and its offer. */
  private readAnswer(send: Send, reply: ReadBackMessage): void {
    if (reply.stopped === true) return this.answerStopped(send);
    if (Array.isArray(reply.sources)) send.sources = reply.sources as BlueSource[];
    this.deliver(send, typeof reply.content === 'string' ? reply.content : '');
    if (reply.offer && typeof reply.offer.id === 'string' && !send.offer) {
      send.offer = reply.offer;
      this.giveOffer(send);
    }
    this.giveAnswer(send);
  }

  /** 409 busy: the message held until the conversation is free, then sent (own choice 62); the wait delivers nothing. */
  private async hold(send: Send, holdStarted: number | null): Promise<void> {
    const started = holdStarted ?? this.clock.now();
    send.held = true;
    if (!send.busyTold) {
      send.busyTold = true;
      this.update('busy');
    }
    const end = await this.readBack(send, started, false, (back) => back.answering !== true, () => !send.dropped);
    if (send.dropped) return;
    if (end.kind === 'done') {
      send.held = false;
      return this.attempt(send, started);
    }
    if (end.kind === 'stopped') return this.refuse(send, new Error(DISPOSED), false);
    if (end.kind === 'refused') return this.refuse(send, end.refusal);
    this.refuse(send, busyError());
  }

  private callStop(): Promise<{ stopped?: boolean } | undefined> {
    return this.transport.request<{ stopped?: boolean }>('POST', `${this.path}/stop`, {
      call: 'conversation',
      secret: this.host.secret,
      body: {},
    });
  }

  /**
   * Stop (§2.5): a message held behind busy is dropped, never sent; then POST …/stop. False
   * before the stream's first event is sent again at it; false later means keep reading. Only
   * when the call itself fails is the request aborted here: aborting never stops the answer.
   */
  async stop(): Promise<{ stopped: boolean }> {
    for (const send of [...this.pending]) {
      if (!send.held || send.dropped) continue;
      send.dropped = true;
      send.wake?.();
      this.refuse(send, busyError(), false);
    }
    let answer: { stopped?: boolean } | undefined;
    try {
      answer = await this.callStop();
    } catch (error) {
      for (const send of [...this.pending]) {
        if (!send.stream) continue;
        send.stopFailed = true;
        send.stream.abort();
      }
      throw error;
    }
    const stopped = answer?.stopped === true;
    const running = [...this.pending].filter((s) => s.sent && !s.held);
    if (stopped) {
      if (running.length) running.forEach((s) => this.tellStopped(s));
      else this.update('stopped');
    } else {
      for (const send of running) if (send.stream && !send.started) send.stopAgain = true;
    }
    return { stopped };
  }

  /** The app is back in the foreground: a message still pending is read back now (§2.5). */
  resume(): void {
    for (const send of this.pending) {
      if (send.finished) continue;
      if (send.stream) {
        send.resumed = true;
        send.stream.abort();
      } else send.wake?.();
    }
  }
}
