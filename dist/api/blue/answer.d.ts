import { BlueUser } from './identity';
import { BlueOffer, BlueSource } from './ndjson';
import { BluePressAnswer } from './offers';
import { Clock } from './stream';
import { BlueTransport } from './transport';
/** The Conversation's listener lists Blue mode emits to: core's event names where core has the listener. */
export declare const BLUE_EVENTS: {
    readonly message: "bot_message";
    readonly error: "general_error";
    readonly update: "conversation_update";
    readonly action: "action";
    readonly delta: "delta";
    readonly answer: "answer";
    readonly step: "step";
};
export type BlueEventName = (typeof BLUE_EVENTS)[keyof typeof BLUE_EVENTS];
/** A follow's waits between read-backs, then the last one again: Blue's own window's FOLLOW_WAITS. */
export declare const FOLLOW_WAITS: number[];
/** A follow, or a 409's hold, gives up after this: the backend's 600 s busy lock. */
export declare const FOLLOW_MS = 600000;
/** Two read-backs at least this far apart, neither answering, with no message of the send's clientId: it wasn't stored. */
export declare const NOT_STORED_MS = 5000;
/** What onAnswer gives for an answer that was stopped. */
export declare const STOPPED_TEXT = "Stopped.";
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
    customer: () => {
        user: BlueUser;
        details?: Record<string, string>;
    };
    /** The runtime's timers by default; a hand-driven clock in tests. */
    clock?: Clock;
}
export declare class BlueAnswers {
    private readonly host;
    private readonly clock;
    private readonly pending;
    /** The last send's close: each send goes once the one before has closed its request (own choice 71). */
    private lastClosed;
    /** The offers seen in this conversation, by id: a press reads its kind and its first field's label. */
    private readonly offers;
    constructor(host: BlueConversationHost);
    private get transport();
    private get path();
    private emit;
    private update;
    private errorEvent;
    /**
     * Sends a message: resolves at the stream's `conversation` event (reading whole, at the
     * response's headers), or at a cut, whose answer comes by the read-back; rejects at a refusal.
     */
    send(content: unknown): Promise<void>;
    /** 22 base64url characters from 16 random bytes: the message's own id (decision 18 (a)). */
    private clientId;
    private hand;
    /** A refusal of the send itself: sendMessage rejects, and onError hears it unless Stop dropped it. */
    private refuse;
    private finish;
    /** One request for the send; `holdStarted` is when a 409's hold began, so the hold has one 10 minutes. */
    private attempt;
    /**
     * A send's body: the customer and the details as they stand now (§2.7), and `accepts` only while
     * an onActionReceived listener is registered, since only an app that draws forms gets them (§2.8).
     */
    private sendBody;
    /** Keeps an offer seen in a stream or a read-back, for a press on it. */
    remember(offer: unknown): void;
    /**
     * Presses one of the bot's offers (§2.8): `of-…` ids alone (any other warns once and sends
     * nothing), a link's send refused before sending (gaps G5). The answer's text and a look-up's
     * rows go to onMessage as one message, and to onAnswer with the press's answer as `offer`. A
     * refusal goes to onError and rejects, in §1.2's words by its code.
     */
    press(actionId: string, data: unknown): Promise<void>;
    private ended;
    /** One network chunk's events: in order, then the draft once, after the chunk's last line (own choice 53). */
    private events;
    /** onMessage, once per answer and never for an empty text; the footer only when no onAnswer is registered (own choice 55). */
    private deliver;
    private giveOffer;
    private giveAnswer;
    private tellStopped;
    /** A stopped answer: no onMessage, onAnswer's "Stopped." (own choice 56). */
    private answerStopped;
    /** After the send was handed over: onMessage's "[Error: …]" and onError, in §1.2's words. */
    private failed;
    private couldntAnswer;
    /** Waits `ms` on the clock, or until woken. */
    private pause;
    /**
     * Reads the conversation back at FOLLOW_WAITS, within FOLLOW_MS of `started` (gaps G3: a 429
     * waits its Retry-After; a 5xx, no network or a read that ran out keeps the waits; 404, 401
     * and 403 end it). Gives each read that came, until `read` says it's done; or how it ended.
     * `now` reads first without waiting.
     */
    private readBack;
    /** A cut's follow: the answer read back and matched by the send's clientId (§2.5). */
    private follow;
    /** The stored answer: onMessage unless given already or stopped, onAnswer, and its offer. */
    private readAnswer;
    /** 409 busy: the message held until the conversation is free, then sent (own choice 62); the wait delivers nothing. */
    private hold;
    private callStop;
    /**
     * Stop (§2.5): a message held behind busy is dropped, never sent; then POST …/stop. False
     * before the stream's first event is sent again at it; false later means keep reading. Only
     * when the call itself fails is the request aborted here: aborting never stops the answer.
     */
    stop(): Promise<{
        stopped: boolean;
    }>;
    /** The app is back in the foreground: a message still pending is read back now (§2.5). */
    resume(): void;
}
