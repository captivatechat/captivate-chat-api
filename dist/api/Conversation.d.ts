import { BlueAnswer } from './blue/answer';
import { BlueUser } from './blue/identity';
import { BlueCopy, BlueGreeting } from './blue/shapes';
import { Clock } from './blue/stream';
import { BlueTransport } from './blue/transport';
interface Action {
    id: string;
    data: any;
}
/** What a Blue conversation's handle is made with (first-channels-library-spec §2.2). */
export interface BlueHandle {
    transport: BlueTransport;
    /** The user's secret, as X-Blue-Conversation (in server mode the user's ID, as X-Blue-User); without it, found by findSecret at the handle's first call. */
    secret?: string;
    /** The user's ID, when the call that made the handle named one. */
    userId?: string | null;
    /** For a handle from getConversation(id): the secret of the conversation's user, or null when nothing here knows it. */
    findSecret?: () => Promise<{
        secret: string;
        userId: string | null;
    } | null>;
    /** The runtime's timers by default; a hand-driven clock in tests. */
    clock?: Clock;
    /** What the call that made the handle knew of the conversation (the start, the list). */
    copy?: BlueCopy;
    /** The bot-first greeting, given to onMessage on the next tick. */
    greeting?: BlueGreeting | null;
    /** The app's metadata as given, in memory. */
    given?: Record<string, unknown>;
    /** The names of the details the bot's look-ups read (the start's or a read-back's). */
    details?: string[] | null;
}
/** A Blue conversation's own state, beside core's fields. */
export interface BlueState {
    userId: string | null;
    secret: string | null;
    copy: BlueCopy | null;
    greeting: BlueGreeting | null;
    /**
     * The app's metadata as given (createConversation's, then each setMetadata's), in memory only:
     * user_id, user_token and the details' values are read from it (§2.7).
     */
    given: Record<string, unknown>;
    details: string[] | null;
    /** The customer the metadata last named (§2.7): sent with every send and press, `{ id: null }` for none. */
    user: BlueUser;
}
/** A Blue handle's state, read past withSocketGuard (which passes fields through as they are); null for core's. */
export declare function blueStateOf(conversation: Conversation): BlueState | null;
/** Gives a handle what a list or a read-back says of its conversation, its runtime `metadata` too. */
export declare function takeBlueCopy(conversation: Conversation, copy: BlueCopy): void;
/**
 * Gives a core handle the list already holds what the list says of its conversation, as 7.0.0's
 * fresh handle had it: the server's metadata and the conversation's key, else the instance's. A
 * list item without metadata leaves what the handle knows, never {} over it.
 */
export declare function takeListedDetails(conversation: Conversation, metadata: unknown, apiKey: string): void;
/**
 * Live view of the owning API's connection.
 *
 * A Conversation used to capture `socket` and `socketId` at construction time. Both are
 * replaced whenever CaptivateChatAPI reconnects, so every Conversation built before a
 * reconnect kept sending HTTP requests stamped with a dead socket_id — the server then
 * called PostToConnection on a closed connection and returned 410 Gone. Reading them
 * through a provider means a Conversation is always bound to the current connection.
 */
export interface ConversationSocketProvider {
    getSocket(): WebSocket | null;
    getSocketId(): string | null;
}
/** One part of a message's content. Core's gateway and Blue both send `{ type: 'text', text }`. */
export interface MessagePart {
    type: string;
    text?: string;
    [key: string]: unknown;
}
/** What onMessage gives: the sender's parts, or a string for an error ("[Error: …]"). */
export type MessageContent = MessagePart[] | string;
/** Who a message is from, as onMessage's second argument says. */
export type MessageSender = 'ai_agent' | 'human_agent' | 'error';
/**
 * Represents a conversation session, handling HTTP communication for sending and WebSocket for receiving.
 * Client-side sending uses HTTP, while server-side real-time communication uses WebSocket listeners.
 */
export declare class Conversation {
    apiKey: string;
    private conversationId;
    private metadata;
    fileManager: any;
    /**
     * Fallback WebSocket, used only when no provider was supplied (legacy callers).
     */
    private socket;
    /**
     * Live connection view. Preferred over the captured socket/socketId above.
     */
    private provider?;
    /**
     * Event listeners for real-time WebSocket communication.
     */
    private listeners;
    private mode;
    /**
     * Fallback socket ID, used only when no provider was supplied (legacy callers).
     */
    private socketId;
    /**
     * Bound message handler, kept so it can be added and removed by identity.
     */
    private readonly boundHandleMessage;
    /**
     * The socket this instance currently has a listener on, so re-attaching is idempotent.
     */
    private attachedSocket;
    /**
     * Default TTL (days) for file uploads in this conversation. Set via setTimeToLive(); used when uploading files.
     */
    private defaultTtlDays;
    /**
     * Blue mode's answers, set when the conversation is one of Blue's (first-channels-library-spec
     * §2.2): its methods then take their Blue branch, and no socket is listened to.
     */
    private blue;
    private blueState;
    private blueTransport;
    private findBlueSecret;
    /** The bot-first greeting not yet given: it goes once, on the tick after the first message or answer listener. */
    private greetingPending;
    private greetingClock;
    private detailsLookup;
    /**
     * Initializes a new Conversation instance.
     * @param conversation_id - The unique identifier of the conversation.
     * @param socket - WebSocket instance. Ignored when `provider` is supplied.
     * @param metadata - Optional metadata for the conversation.
     * @param apiKey - API key for HTTP communication (required).
     * @param mode - The mode of operation ('prod' or 'dev').
     * @param socketId - Socket ID. Ignored when `provider` is supplied.
     * @param provider - Live view of the owning API's socket and socketId. Strongly preferred:
     *                   without it this instance goes stale as soon as the API reconnects.
     * @param blue - Blue mode's transport and the user's secret, for a conversation of Blue's.
     */
    constructor(conversation_id: string, socket: WebSocket | null, metadata?: object, apiKey?: string, mode?: 'prod' | 'dev', socketId?: string | null, provider?: ConversationSocketProvider, blue?: BlueHandle);
    /**
     * The socket this conversation should currently be listening on.
     */
    private get liveSocket();
    /**
     * The socket ID that outbound HTTP requests should carry.
     */
    private get liveSocketId();
    /**
     * Sets the default time-to-live (TTL) for file uploads in this conversation and stores it in metadata.
     * When files are uploaded via conversation.fileManager.create(), this value is sent as ttlDays (1, 7, 30, or 90).
     * Does not call any path-TTL API; the value is applied only at upload time.
     * @param days - Must be 1, 7, 30, or 90. Other values are ignored.
     */
    setTimeToLive(days: number): Promise<void>;
    /**
     * Handles incoming WebSocket messages for real-time communication.
     * @param event - The WebSocket message event.
     */
    private handleMessage;
    /**
     * Attaches the message handler to the current socket, moving it if the socket changed.
     * Idempotent: calling this repeatedly never stacks duplicate handlers.
     */
    private attachSocketListener;
    /**
     * Re-binds this conversation to the current socket. Call after a reconnect.
     * Safe to call any number of times.
     */
    restartListeners(): void;
    /**
     * Detaches this conversation's socket listener. Call when discarding the instance.
     */
    detachListeners(): void;
    /**
     * Adds an event listener for a specific event type.
     * @param eventType - The type of event to listen for.
     * @param callback - The function to invoke when the event occurs.
     */
    private addListener;
    /**
     * Registers a listener for messages from the bot or live chat.
     *
     * `message` is what the sender sent, passed on as it is: from the bot or a live agent, a list of
     * parts (`[{ type: 'text', text }]`); for an error, a string (`"[Error: …]"`, type `'error'`).
     * It was typed as a string before 7.1.0, which it never was for the bot; a callback written for
     * that type still compiles (the second signature).
     * @param callback - The function to handle incoming messages.
     */
    onMessage(callback: (message: MessageContent, type: MessageSender) => void): void;
    onMessage(callback: (message: string, type: string) => void): void;
    /**
     * Registers a listener for receiving actions.
     * @param callback - The function to handle incoming action.
     */
    onActionReceived(callback: (actions: [Action]) => void): void;
    /**
     * Registers a listener for updates to the conversation.
     * @param callback - The function to handle conversation updates.
     */
    onConversationUpdate(callback: (update: any) => void): void;
    /**
     * Registers a listener for error events.
     * @param callback - The function to handle errors.
     */
    onError(callback: (error: any) => void): void;
    /**
     * Blue mode: the answer so far while it is written, its [n] markers out, once per network
     * chunk; `reset` when what was shown is dropped. Never called for a core key.
     */
    onDelta(callback: (draft: string, info: {
        reset: boolean;
    }) => void): void;
    /**
     * Blue mode: the final answer once, with the sources its [n] point at and any quick replies.
     * Never called for a core key.
     */
    onAnswer(callback: (answer: BlueAnswer) => void): void;
    /** Blue mode: what the bot is doing, for a typing line ("Looking into it"). Never called for a core key. */
    onStep(callback: (label: string) => void): void;
    /** Calls a Blue list's listeners in order; one that throws doesn't stop the others. */
    private emitBlue;
    /**
     * Removes a previously registered listener.
     * @param eventType - The type of event.
     * @param callback - The callback function to remove.
     */
    off(eventType: string, callback: Function): void;
    /**
     * Removes every listener registered on this conversation.
     */
    removeAllListeners(): void;
    /**
     * Sends a message to the conversation.
     * @param content - The message content to send.
     * @returns A promise that resolves when the message is sent.
     */
    sendMessage(content: object | string): Promise<void>;
    /**
     * Blue mode: stops the answer being written. `stopped: false` means nothing was being
     * answered, or the answer had just ended. A core key has nothing to stop.
     */
    stop(): Promise<{
        stopped: boolean;
    }>;
    /**
     * Blue mode: call when the app comes back to the foreground, so an answer still pending is
     * read back. Nothing for a core key.
     */
    resume(): void;
    /**
    * Sets metadata for the conversation and uses HTTP response for confirmation.
    * @param metadata - An object containing the metadata to set.
    * @returns A promise that resolves when the metadata update is successful.
    */
    setMetadata(metadata: object): Promise<void>;
    /**
   * Sets private metadata for the conversation (not visible to frontend).
   * @param privateMeta - An object containing the private metadata to set.
   * @returns A promise that resolves when the metadata update is successful.
   */
    setPrivateMetadata(privateMeta: object): Promise<void>;
    /**
     * Sends an action to the conversation.
     * @param actionId - The unique ID of the action to send.
     * @param data - Optional data associated with the action.
     * @returns A promise that resolves when the action is sent.
     */
    sendAction(actionId: string, data?: object): Promise<void>;
    /**
     * Requests the transcript of the conversation with automatic file URL refresh.
     * @returns A promise that resolves to the conversation transcript with refreshed file URLs.
     */
    getTranscript(): Promise<object[]>;
    /**
     * Refreshes expired file URLs in the transcript.
     * @param transcript - The transcript array to process.
     * @returns A promise that resolves to the transcript with refreshed file URLs.
     */
    private refreshExpiredFileUrls;
    /**
   * Requests metadata for the conversation using HTTP request with direct response.
   * @returns A promise that resolves to the conversation metadata.
   */
    getMetadata(): Promise<object>;
    /**
     * Deletes this conversation using HTTP request with direct response.
     * @param options - Delete options object with softDelete property.
     * @param options.softDelete - Whether to perform a soft delete (true) or hard delete (false). Defaults to true.
     * @returns A promise that resolves when the conversation is deleted successfully.
     */
    delete(options?: {
        softDelete?: boolean;
    }): Promise<void>;
    /**
     * Edits a message in the conversation using HTTP request with direct response.
     * @param messageId - The ID of the message to edit.
     * @param content - The new content for the message (object or string).
     * @returns A promise that resolves when the edit is confirmed via HTTP response.
     */
    editMessage(messageId: string, content: object | string): Promise<void>;
    /**
     * Makes this the conversation that gets its connection's replies naming none (handleMessage),
     * before the send, since the reply can reach the socket before the HTTP answer does.
     */
    private becomeActive;
    /**
     * Sends a payload via HTTP API (primary method).
     * @param eventType - The type of event being sent.
     * @param payload - The payload data to include with the event.
     * @returns A promise that resolves to the response data.
     */
    private sendPayload;
    /**
     * Builds an Error carrying the HTTP status, so callers can distinguish 401 from 429
     * from 500 instead of string-matching a message.
     */
    private buildHttpError;
    /**
     * Sends a payload via HTTP API (primary communication method).
     * @param message - The message to send via HTTP.
     * @returns A promise that resolves to the response data.
     */
    private sendPayloadViaHttp;
    /**
     * Gets the base URL for API requests based on the current mode.
     * @returns The base URL for the API.
     */
    private getBaseUrl;
    private get bluePath();
    /** The user's secret: the handle's, else found once (getConversation(id)); else each call refuses in §2.2's words. */
    private blueSecret;
    /**
     * A handle that never started or read its conversation (getConversation, in server mode every
     * request's) doesn't know the names of the details the bot's look-ups read: reads them
     * before its first send, press or setMetadata. A read that fails is left to the call itself, and tried again at the next.
     */
    private knowDetails;
    /** GET /v1/chat/:id: the handle's copy and the details' names come with it. */
    private readBlue;
    /**
     * Blue's setMetadata (§2.2, §2.7; gaps G10): everything as given kept in memory; all but
     * user_id and user_token merged into what Blue keeps, by PATCH. A call of only user_id,
     * user_token and the details' names sends nothing; one that would keep over 4 KB is refused first.
     */
    private setBlueMetadata;
    /** The bot-first greeting, once: onMessage, then onAnswer with its starters as quick replies (gaps G1). */
    private greet;
    /**
     * Gets the unique identifier of the conversation.
     * @returns The conversation ID.
     */
    getConversationId(): string;
}
export {};
