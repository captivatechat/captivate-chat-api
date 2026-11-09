import { Conversation, ConversationSocketProvider } from './Conversation';
import { BlueOptions } from './blue/transport';
export declare const captivateLogger: {
    log: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
};
/**
 * Tunables. All optional; the defaults match the previous hardcoded values. Blue mode's
 * members (blueUrl, fetch, stream, storage, randomValues, userSecret) are read for Blue's
 * keys alone.
 */
export interface CaptivateChatAPIOptions extends BlueOptions {
    /** How long to wait for socket_connected during connect(). Default 10000. */
    connectTimeoutMs?: number;
    /** How long to wait for conversation_start_success. Default 20000. */
    conversationStartTimeoutMs?: number;
    /** Maximum automatic reconnection attempts. Default 5. */
    maxReconnectAttempts?: number;
    /** Delay between reconnection attempts, in ms. Default 3000. */
    reconnectDelay?: number;
}
/**
 * A key as logs and errors may name it, never the key itself: a Blue key by its id, a core key by
 * its last 4 characters, or by a short hash for a key under 16 characters, where 4 would give away
 * too much of it. The package's index doesn't export it.
 */
export declare function keyLabel(apiKey: string): string;
export declare class CaptivateChatAPI implements ConversationSocketProvider {
    /**
     * Static registry to track instances by API key and mode.
     * Enforces singleton pattern: one instance per unique (apiKey, mode) combination.
     */
    private static instances;
    /**
     * Generates a unique instance key for the registry. A Blue key's is a sha256 of key and mode,
     * so a server key's secret never sits in the registry (first-channels-server-key-spec §3.1);
     * core's keys keep today's, which Engage reads.
     */
    private static getInstanceKey;
    /** How the registry's log lines name an instance, never by the key itself (keyLabel). */
    private static nameOf;
    private apiKey;
    private mode;
    private url;
    private socket;
    private conversations;
    private socketId;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private reconnectDelay;
    private connectTimeoutMs;
    /**
     * Default wait for conversation_start_success. Raised from the old hardcoded 10s
     * because conversation_start routinely takes longer than that on cold paths, and the
     * old timer also fired on success — see createConversation.
     */
    private conversationStartTimeoutMs;
    /** Set by dispose(); stops auto-reconnect and rejects further use. */
    private isDisposed;
    /** In-flight connect, so concurrent callers share one handshake. */
    private connectPromise;
    /** In-flight reconnect cycle, so concurrent callers share one. */
    private reconnectPromise;
    /** Blue mode's transport, set when the key is one of Blue's: no socket is opened then. */
    private blue;
    /** Blue mode's users and their secrets (first-channels-library-spec §2.6). */
    private blueUsers;
    /** The timers Blue's conversations use: the runtime's unless a test sets one. */
    private blueClock;
    static setDebugMode(enabled: boolean): void;
    static getDebugMode(): boolean;
    /**
     * Creates an instance of CaptivateChatAPI.
     * Enforces singleton pattern: returns existing instance if one exists for the given API key and mode.
     * Note that when an existing instance is returned, `options` is ignored — use
     * configure() to change tunables on a live instance.
     */
    constructor(apiKey: string, mode?: 'prod' | 'dev', options?: CaptivateChatAPIOptions);
    /** Updates tunables on a live instance. */
    configure(options?: CaptivateChatAPIOptions): void;
    private getBaseUrl;
    /**
     * Builds an Error carrying the HTTP status so callers can act on 401 vs 429 vs 500
     * without string-matching. Note a rate-limited response served without CORS headers
     * never reaches this path — the browser rejects the fetch with an opaque TypeError.
     */
    private buildHttpError;
    /**
     * Sends a message via HTTP API.
     */
    private _send;
    /**
     * Closes the current socket without triggering the auto-reconnect path.
     */
    private teardownSocket;
    /**
     * Connects to the WebSocket server for real-time communication.
     * Concurrent callers share a single handshake.
     */
    connect(): Promise<void>;
    /**
     * Creates a new conversation or starts a bot-first/user-first conversation.
     *
     * @param options.timeoutMs - Overrides the instance conversationStartTimeoutMs.
     */
    createConversation(userId: string, userBasicInfo?: object, metadata?: Record<string, any>, autoConversationStart?: 'bot-first' | 'user-first', privateMetadata?: object, options?: {
        timeoutMs?: number;
    }): Promise<Conversation>;
    /**
     * Retrieves an existing conversation by its ID, creating a local handle if not cached.
     *
     * Returns a Conversation rather than `Conversation | void`: the old union forced every
     * caller into a null check that could never be satisfied on the success path.
     *
     * @param userId - Server mode: the user the call is for, on every call. A fresh handle each
     *                 time, never kept, so one user's request never acts as another's. With an app
     *                 key: the user whose secret a conversation this instance doesn't know is
     *                 opened with. Unused with a core key.
     * @param metadata - Server mode: this request's metadata, held in memory only (nothing is sent), so
     *                   its user_id names the customer and its details go with each message. Unused otherwise.
     */
    getConversation(conversationId: string, userId?: string, metadata?: Record<string, any>): Conversation;
    /**
     * Drops a conversation from the local cache and detaches its socket listener.
     * Does not delete it server-side — use conversation.delete() for that.
     */
    releaseConversation(conversationId: string): void;
    /**
     * Retrieves user conversations. Uses v2 if filter, search, or pagination is provided, otherwise uses v1.
     */
    getUserConversations(userIdOrOptions: string | {
        userId: string;
        filter?: object;
        search?: object;
        pagination?: {
            page?: string | number;
            limit?: string | number;
        };
        apiKeys?: string[];
    }): Promise<{
        conversations: Conversation[];
        pagination?: {
            hasNextPage: boolean;
            hasPrevPage: boolean;
            page: number;
            pageSize: number;
            total: number;
            totalPages: number;
        };
    }>;
    /**
     * Deletes all conversations for a specific user using HTTP request with direct response.
     */
    deleteUserConversations(userId: string, options?: {
        softDelete?: boolean;
    }): Promise<void | {
        deleted: number;
        busy: number;
    }>;
    /**
     * Blue mode: forgets a user on this device, their stored secret and their conversations'
     * handles. Call it when the user signs out. Nothing with a core key.
     */
    forgetUser(userId: string): void;
    /** A Blue conversation's handle, guarded as core's are. */
    private blueConversation;
    /** getConversation(id, userId)'s user, when this device knows their secret. */
    private secretOfUser;
    /** getConversation(id)'s user: the one kept with the conversation, else the last one named here (§2.2). */
    private secretOfConversation;
    /**
     * Blue's createConversation (§2.2): the user's secret, then POST /v1/chat/conversations with the
     * metadata as given but its user_id and user_token, which stay in memory. userBasicInfo and
     * private metadata are never sent. A bot-first greeting comes to onMessage on the next tick.
     */
    private createBlueConversation;
    /**
     * Blue's getUserConversations (§2.2; gaps G13): none without the user's secret; else a page of
     * GET /v1/chat/conversations, newest first, each a handle whose metadata.channelMetadata holds
     * its dates, last message, preview and kept metadata (`custom`), with core's pagination.
     */
    private blueUserConversations;
    /** Blue's deleteUserConversations (§2.2; gaps G13): every one of the user's, those still answering left and counted in `busy`. */
    private deleteBlueUserConversations;
    /**
     * Gets the WebSocket instance for real-time communication.
     */
    getSocket(): WebSocket | null;
    /**
     * Gets the socket ID for HTTP requests.
     */
    getSocketId(): string | null;
    /**
     * Checks if the WebSocket connection is active and open for real-time communication.
     */
    isSocketActive(): boolean;
    /**
     * Attempts to reconnect to the WebSocket server, then re-binds every cached
     * conversation to the new socket.
     *
     * Each call starts a fresh cycle of at most maxReconnectAttempts tries; callers while one is
     * running (the guard, the auto-reconnect, the app) share it.
     */
    reconnect(): Promise<void>;
    /**
     * Static factory method to create and connect a CaptivateChatAPI instance.
     */
    static create(apiKey: string, mode?: 'prod' | 'dev', options?: CaptivateChatAPIOptions): Promise<CaptivateChatAPI>;
    static getInstance(apiKey: string, mode?: 'prod' | 'dev'): CaptivateChatAPI | undefined;
    static hasInstance(apiKey: string, mode?: 'prod' | 'dev'): boolean;
    /**
     * Disposes of this instance, closing the WebSocket and removing it from the registry.
     * After calling dispose(), a new instance can be created for the same API key/mode combination.
     */
    dispose(): void;
}
