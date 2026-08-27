// Import the Conversation class
import { Conversation, ConversationSocketProvider } from './Conversation';

// Determine the WebSocket implementation based on the environment (browser, Node.js, or React Native)
let WebSocketImpl: typeof WebSocket;

// Browser environment (web)
if (typeof window !== 'undefined' && window.WebSocket) {
  WebSocketImpl = window.WebSocket;
}
// React Native environment
else if (typeof global !== 'undefined' && global.WebSocket) {
  WebSocketImpl = global.WebSocket;
}
// Node.js environment
else {
  try {
    WebSocketImpl = require('ws');
  } catch (error) {
    throw new Error('WebSocket not available in this environment and ws module could not be loaded');
  }
}

/**
 * Methods that must NOT be wrapped by withSocketGuard.
 *
 * The guard turns a method into an async function that reconnects first. That is right
 * for anything doing network I/O and wrong for everything else, because it (a) changes
 * the declared return type into a Promise and (b) can trigger a reconnect from a plain
 * accessor.
 *
 * Previously `getSocketId` and `getConversation` were missing here — one character away
 * from `getSocket` and `getConversationId`, which were present — so both silently
 * returned Promises that contradicted their own type declarations. `dispose` was missing
 * too, which meant disposing a dead instance first reconnected it.
 */
const UNGUARDED_METHODS = [
  // connection state / accessors
  'isSocketActive',
  'connect',
  'reconnect',
  'disconnect',
  'getSocket',
  'getSocketId',
  'dispose',
  // registry + local lookups
  'getConversation',
  'getConversationId',
  // local listener management
  'restartListeners',
  'detachListeners',
  'removeAllListeners',
  'off',
];

// Proxy guard function for automatic WebSocket state checking and reconnection
function withSocketGuard<T extends object>(instance: T): T {
  return new Proxy(instance, {
    get(target, prop, receiver) {
      const orig = target[prop as keyof T];
      if (typeof orig === 'function' && !UNGUARDED_METHODS.includes(prop as string)) {
        return async function (...args: any[]) {
          if (typeof (target as any)['isSocketActive'] === 'function' && !(target as any)['isSocketActive']()) {
            // Socket not active, attempting to reconnect
            try {
              if (typeof (target as any)['reconnect'] === 'function') {
                await (target as any)['reconnect']();
              } else {
                throw new Error('Reconnect method not available');
              }
            } catch (error: any) {
              throw new Error(`Socket reconnection failed. Cannot execute ${String(prop)}: ${error.message}`);
            }
          }
          return (orig as Function).apply(target, args);
        };
      }
      return orig;
    }
  });
}

/**
 * CaptivateChatAPI class for managing conversations through HTTP connections for sending and WebSocket for receiving.
 * Client-side sending uses HTTP, while server-side real-time communication uses WebSocket listeners.
 */
// Global debug flag for CaptivateChatAPI only
let captivateDebugMode = false;

// Store original console methods
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error
};

// Custom debug logger that only affects CaptivateChatAPI logs
export const captivateLogger = {
  log: (...args: any[]) => {
    if (captivateDebugMode) {
      originalConsole.log('[CaptivateChatAPI]', ...args);
    }
  },
  warn: (...args: any[]) => {
    originalConsole.warn('[CaptivateChatAPI]', ...args);
  },
  error: (...args: any[]) => {
    originalConsole.error('[CaptivateChatAPI]', ...args);
  }
};

/** Tunables. All optional; the defaults match the previous hardcoded values. */
export interface CaptivateChatAPIOptions {
  /** How long to wait for socket_connected during connect(). Default 10000. */
  connectTimeoutMs?: number;
  /** How long to wait for conversation_start_success. Default 20000. */
  conversationStartTimeoutMs?: number;
  /** Maximum automatic reconnection attempts. Default 5. */
  maxReconnectAttempts?: number;
  /** Delay between reconnection attempts, in ms. Default 3000. */
  reconnectDelay?: number;
}

export class CaptivateChatAPI implements ConversationSocketProvider {
  /**
   * Static registry to track instances by API key and mode.
   * Enforces singleton pattern: one instance per unique (apiKey, mode) combination.
   */
  private static instances: Map<string, CaptivateChatAPI> = new Map();

  /**
   * Generates a unique instance key for the registry.
   */
  private static getInstanceKey(apiKey: string, mode: 'prod' | 'dev'): string {
    return `${apiKey}-${mode}`;
  }

  private apiKey!: string;
  private mode!: 'prod' | 'dev';
  private url!: string;
  private socket!: WebSocket | null;
  private conversations!: Map<string, Conversation>;
  private socketId: string | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 3000;
  private connectTimeoutMs: number = 10000;
  /**
   * Default wait for conversation_start_success. Raised from the old hardcoded 10s
   * because conversation_start routinely takes longer than that on cold paths, and the
   * old timer also fired on success — see createConversation.
   */
  private conversationStartTimeoutMs: number = 20000;
  /** Set by dispose(); stops auto-reconnect and rejects further use. */
  private isDisposed: boolean = false;
  /** In-flight connect, so concurrent callers share one handshake. */
  private connectPromise: Promise<void> | null = null;

  static setDebugMode(enabled: boolean): void {
    captivateDebugMode = enabled;
  }

  static getDebugMode(): boolean {
    return captivateDebugMode;
  }

  /**
   * Creates an instance of CaptivateChatAPI.
   * Enforces singleton pattern: returns existing instance if one exists for the given API key and mode.
   * Note that when an existing instance is returned, `options` is ignored — use
   * configure() to change tunables on a live instance.
   */
  constructor(apiKey: string, mode: 'prod' | 'dev' = 'prod', options: CaptivateChatAPIOptions = {}) {
    const instanceKey = CaptivateChatAPI.getInstanceKey(apiKey, mode);

    // Check if instance already exists (singleton enforcement)
    const existingInstance = CaptivateChatAPI.instances.get(instanceKey);
    if (existingInstance) {
      captivateLogger.log(`Reusing existing CaptivateChatAPI instance for ${instanceKey}`);
      return existingInstance;
    }

    // Initialize new instance
    this.apiKey = apiKey;
    this.mode = mode;

    this.url =
      this.mode === 'prod'
        ? `wss://channel.wss.captivatechat.ai/dev?apiKey=${apiKey}`
        : `wss://channel-dev.wss.captivatechat.ai/dev?apiKey=${apiKey}`;

    this.socket = null;
    this.conversations = new Map();
    this.configure(options);

    // Store in registry
    CaptivateChatAPI.instances.set(instanceKey, this);

    captivateLogger.log(`Created new CaptivateChatAPI instance for ${instanceKey}`);
    captivateLogger.log('CaptivateChatAPI: Using HTTP for sending messages and WebSocket for receiving real-time updates.');
  }

  /** Updates tunables on a live instance. */
  public configure(options: CaptivateChatAPIOptions = {}): void {
    if (options.connectTimeoutMs !== undefined) this.connectTimeoutMs = options.connectTimeoutMs;
    if (options.conversationStartTimeoutMs !== undefined) this.conversationStartTimeoutMs = options.conversationStartTimeoutMs;
    if (options.maxReconnectAttempts !== undefined) this.maxReconnectAttempts = options.maxReconnectAttempts;
    if (options.reconnectDelay !== undefined) this.reconnectDelay = options.reconnectDelay;
  }

  private getBaseUrl(): string {
    return this.mode === 'prod'
      ? 'https://channel.prod.captivat.io'
      : 'https://channel.dev.captivat.io';
  }

  /**
   * Builds an Error carrying the HTTP status so callers can act on 401 vs 429 vs 500
   * without string-matching. Note a rate-limited response served without CORS headers
   * never reaches this path — the browser rejects the fetch with an opaque TypeError.
   */
  private buildHttpError(prefix: string, response: Response, body: string): Error {
    const detail = body ? `: ${body.slice(0, 300)}` : '';
    const error = new Error(`${prefix}: ${response.status} ${response.statusText}${detail}`) as Error & {
      status?: number;
      body?: string;
    };
    error.status = response.status;
    error.body = body;
    return error;
  }

  /**
   * Sends a message via HTTP API.
   */
  private async _send(message: object): Promise<any> {
    if (!this.apiKey) {
      throw new Error('API key is required for HTTP communication');
    }

    const url = `${this.getBaseUrl()}/api/custom-channel/sockets/message`;

    const messageWithSocketId = {
      ...message,
      event: {
        ...(message as any).event,
        socket_id: this.socketId
      }
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(messageWithSocketId)
      });
    } catch (error) {
      captivateLogger.error('HTTP request failed:', error);
      throw new Error(
        `Failed to send message via HTTP: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw this.buildHttpError('HTTP request failed', response, body);
    }

    const contentType = response.headers.get('content-type');
    let responseData;

    if (contentType && contentType.includes('application/json')) {
      responseData = await response.json();
    } else {
      const textResponse = await response.text();
      captivateLogger.log('Server returned plain text:', textResponse);
      responseData = {
        status: 'success',
        message: textResponse,
        event: {
          event_payload: {
            conversation_id: null // Will be handled by WebSocket
          }
        }
      };
    }

    captivateLogger.log('Message received from server via HTTP:', responseData);
    return responseData;
  }

  /**
   * Closes the current socket without triggering the auto-reconnect path.
   */
  private teardownSocket(reason: string): void {
    const socket = this.socket;
    // Null it first: the close handler checks identity against this.socket and bails
    // when it no longer matches, which is what suppresses the auto-reconnect.
    this.socket = null;
    if (!socket) return;
    try {
      if (socket.readyState === WebSocketImpl.OPEN || socket.readyState === WebSocketImpl.CONNECTING) {
        socket.close(1000, reason);
      }
    } catch (_) { /* already closing */ }
  }

  /**
   * Connects to the WebSocket server for real-time communication.
   * Concurrent callers share a single handshake.
   */
  public async connect(): Promise<void> {
    if (this.isDisposed) {
      throw new Error('This CaptivateChatAPI instance has been disposed. Create a new one.');
    }
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      let socket: WebSocket;

      try {
        this.teardownSocket('Reconnecting');
        socket = new WebSocketImpl(this.url);
      } catch (error) {
        reject(error);
        return;
      }

      this.socket = socket;

      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Connection timeout: socket_connected not received within ${this.connectTimeoutMs}ms`));
      }, this.connectTimeoutMs);

      // addEventListener, not `onmessage =`. Conversations attach their own handlers to
      // this same socket; the old assignment meant the first Conversation constructed
      // wiped this handler out, after which socketId could never be refreshed.
      socket.addEventListener('message', (event: MessageEvent) => {
        let message: any;
        try {
          message = JSON.parse(String(event.data));
        } catch (_) {
          return;
        }
        if (message?.event?.event_type !== 'socket_connected') return;

        this.socketId = message.event.event_payload?.socket_id || null;
        captivateLogger.log('Socket connected with ID:', this.socketId);

        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve();
      });

      socket.addEventListener('error', (event: any) => {
        captivateLogger.error('WebSocket Error:', event?.message || event);
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        reject(new Error(event?.message || 'WebSocket error'));
      });

      socket.addEventListener('close', (event: CloseEvent) => {
        // A socket we already replaced — ignore, and never reconnect from it.
        if (this.socket !== socket) return;
        this.socket = null;
        this.socketId = null;

        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          reject(new Error(`WebSocket closed during handshake (code ${event.code})`));
          return;
        }

        if (this.isDisposed || event.code === 1000) return;

        captivateLogger.warn(`WebSocket closed unexpectedly (code ${event.code}); reconnecting.`);
        // Route through reconnect() so the attempt counter applies. The old code called
        // connect() directly on a bare setTimeout, which bypassed the cap entirely and
        // could loop forever against a failing endpoint.
        void this.reconnect().catch((err) => {
          captivateLogger.error('Automatic reconnection failed:', err);
        });
      });
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  /**
   * Creates a new conversation or starts a bot-first/user-first conversation.
   *
   * @param options.timeoutMs - Overrides the instance conversationStartTimeoutMs.
   */
  public async createConversation(
    userId: string,
    userBasicInfo: object = {},
    metadata: Record<string, any> = {},
    autoConversationStart: 'bot-first' | 'user-first' = 'bot-first',
    privateMetadata: object = {},
    options: { timeoutMs?: number } = {}
  ): Promise<Conversation> {
    if (!this.isSocketActive()) {
      await this.connect();
    }
    const socket = this.socket;
    if (!socket) {
      throw new Error('WebSocket connection not established');
    }

    const timeoutMs = options.timeoutMs ?? this.conversationStartTimeoutMs;
    const fullMetadata: Record<string, any> = { ...metadata };
    if (privateMetadata) {
      fullMetadata.private = privateMetadata;
    }

    return new Promise<Conversation>((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout>;

      // Single exit point. The old code armed a 10s timer and never cleared it, so a
      // response arriving near the deadline resolved the listener AND rejected the
      // promise — the conversation existed, was cached and had its opener sent, while
      // the caller saw a timeout and retried, creating a second real conversation.
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        socket.removeEventListener('message', onMessage);
        fn();
      };

      const onMessage = (event: MessageEvent) => {
        if (settled) return;
        let message: any;
        try {
          message = JSON.parse(String(event.data));
        } catch (_) {
          return;
        }
        captivateLogger.log('messagereceived:', String(event.data));
        if (message?.event?.event_type !== 'conversation_start_success') return;

        const conversationId = message.event.event_payload?.conversation_id;
        if (!conversationId) {
          settle(() => reject(new Error('No conversation_id received in WebSocket response')));
          return;
        }

        // `this` is passed as the socket provider so the Conversation reads socket and
        // socketId live instead of freezing whatever they happen to be right now.
        const conversation = withSocketGuard(
          new Conversation(conversationId, this.socket, {}, this.apiKey, this.mode, this.socketId, this)
        );
        this.conversations.set(conversationId, conversation);

        // Resolve as soon as the conversation exists. The bot-first opener is dispatched
        // in the background: waiting for its HTTP round-trip delayed every caller for no
        // benefit, and a failure there should surface as a missing greeting, not as a
        // failure to create the conversation.
        settle(() => resolve(conversation));

        if (autoConversationStart === 'bot-first') {
          Promise.resolve(conversation.sendMessage({ type: 'text', text: '' })).catch((err) => {
            captivateLogger.error('bot-first opening message failed to send:', err);
          });
        }
      };

      socket.addEventListener('message', onMessage);

      timeoutId = setTimeout(() => {
        settle(() =>
          reject(new Error(`Timeout: No conversation_start_success received from WebSocket within ${timeoutMs}ms`))
        );
      }, timeoutMs);

      this._send({
        action: 'sendMessage',
        event: {
          event_type: 'conversation_start',
          event_payload: {
            userId,
            userBasicInfo,
            metadata: fullMetadata
          },
        },
      }).catch((error) => {
        settle(() => reject(error));
      });
    });
  }

  /**
   * Retrieves an existing conversation by its ID, creating a local handle if not cached.
   *
   * Returns a Conversation rather than `Conversation | void`: the old union forced every
   * caller into a null check that could never be satisfied on the success path.
   */
  public getConversation(conversationId: string): Conversation {
    let conversation = this.conversations.get(conversationId);

    if (!conversation) {
      conversation = withSocketGuard(
        new Conversation(conversationId, this.socket, {}, this.apiKey, this.mode, this.socketId, this)
      );
      this.conversations.set(conversationId, conversation);
    }

    conversation.restartListeners();
    return conversation;
  }

  /**
   * Drops a conversation from the local cache and detaches its socket listener.
   * Does not delete it server-side — use conversation.delete() for that.
   */
  public releaseConversation(conversationId: string): void {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;
    try {
      conversation.detachListeners();
    } catch (_) { /* ignore */ }
    this.conversations.delete(conversationId);
  }

  /**
   * Retrieves user conversations. Uses v2 if filter, search, or pagination is provided, otherwise uses v1.
   */
  public async getUserConversations(
    userIdOrOptions: string | {
      userId: string;
      filter?: object;
      search?: object;
      pagination?: { page?: string | number; limit?: string | number };
      apiKeys?: string[];
    }
  ): Promise<{ conversations: Conversation[]; pagination?: {
    hasNextPage: boolean;
    hasPrevPage: boolean;
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  } }> {
    const options = typeof userIdOrOptions === 'string'
      ? { userId: userIdOrOptions }
      : userIdOrOptions;

    const { userId, filter = {}, search = {}, pagination = {}, apiKeys } = options;
    const conversations: Conversation[] = [];
    let paginationData: {
      hasNextPage: boolean;
      hasPrevPage: boolean;
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    } | undefined = undefined;
    const useV2 = (filter && Object.keys(filter).length > 0)
      || (search && Object.keys(search).length > 0)
      || (pagination && Object.keys(pagination).length > 0)
      || (apiKeys && Array.isArray(apiKeys) && apiKeys.length > 0);

    let httpResponse: any;
    if (useV2) {
      const eventPayload: any = { userId };
      if (filter && Object.keys(filter).length > 0) eventPayload.filter = filter;
      if (search && Object.keys(search).length > 0) eventPayload.search = search;
      if (pagination && Object.keys(pagination).length > 0) eventPayload.pagination = pagination;
      if (apiKeys && Array.isArray(apiKeys) && apiKeys.length > 0) eventPayload.apiKeys = apiKeys;
      httpResponse = await this._send({
        action: 'sendMessage',
        event: { event_type: 'get_user_conversations_v2', event_payload: eventPayload },
      });
    } else {
      httpResponse = await this._send({
        action: 'sendMessage',
        event: { event_type: 'get_user_conversations', event_payload: { userId } },
      });
    }

    const payload = httpResponse?.event?.event_payload || httpResponse;
    const responseConversations = payload?.conversations || [];
    const responsePagination = payload?.pagination;

    for (const conv of responseConversations) {
      const { conversation_id, metadata, apiKey } = conv;
      if (!conversation_id) continue;

      // Reuse the cached instance when we already have one, so listeners registered by
      // the caller are not silently dropped and duplicate handles are not created.
      const existing = this.conversations.get(conversation_id);
      if (existing) {
        existing.restartListeners();
        conversations.push(existing);
        continue;
      }

      const conversation = withSocketGuard(
        new Conversation(conversation_id, this.socket, metadata, apiKey || this.apiKey, this.mode, this.socketId, this)
      );
      this.conversations.set(conversation_id, conversation);
      conversations.push(conversation);
    }

    if (responsePagination) {
      paginationData = responsePagination;
    }

    return { conversations, pagination: paginationData };
  }

  /**
   * Deletes all conversations for a specific user using HTTP request with direct response.
   */
  public async deleteUserConversations(userId: string, options: { softDelete?: boolean } = {}): Promise<void> {
    if (!userId) {
      throw new Error('User ID must be provided.');
    }

    const { softDelete = true } = options;

    const response = await this._send({
      action: 'sendMessage',
      event: {
        event_type: 'delete_user_conversations',
        event_payload: { userId, softdelete: softDelete },
      },
    });

    // Local handles for those conversations are now dead — drop them.
    for (const id of [...this.conversations.keys()]) {
      this.releaseConversation(id);
    }

    captivateLogger.log(`User conversations ${softDelete ? 'soft' : 'hard'} delete confirmed via HTTP response:`, response);
  }

  /**
   * Gets the WebSocket instance for real-time communication.
   */
  public getSocket(): WebSocket | null {
    return this.socket;
  }

  /**
   * Gets the socket ID for HTTP requests.
   */
  public getSocketId(): string | null {
    return this.socketId;
  }

  /**
   * Checks if the WebSocket connection is active and open for real-time communication.
   */
  public isSocketActive(): boolean {
    return !!this.socket && this.socket.readyState === WebSocketImpl.OPEN;
  }

  /**
   * Attempts to reconnect to the WebSocket server, then re-binds every cached
   * conversation to the new socket.
   */
  public async reconnect(): Promise<void> {
    if (this.isDisposed) {
      throw new Error('This CaptivateChatAPI instance has been disposed. Create a new one.');
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      throw new Error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
    }
    this.reconnectAttempts++;

    try {
      await this.connect();
      this.reconnectAttempts = 0; // Reset on successful connection

      // connect() creates a brand-new WebSocket, so every cached conversation is still
      // listening on the old one. Move them across, otherwise inbound messages stop
      // arriving even though the connection looks healthy.
      for (const conversation of this.conversations.values()) {
        try {
          conversation.restartListeners();
        } catch (err) {
          captivateLogger.error('Failed to re-bind conversation after reconnect:', err);
        }
      }
      captivateLogger.log('Reconnected; re-bound', this.conversations.size, 'conversation(s).');
    } catch (error) {
      captivateLogger.error(`Reconnection attempt ${this.reconnectAttempts} failed:`, error);
      if (this.reconnectAttempts < this.maxReconnectAttempts && !this.isDisposed) {
        await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
        return this.reconnect();
      }
      throw error;
    }
  }

  /**
   * Static factory method to create and connect a CaptivateChatAPI instance.
   */
  static async create(
    apiKey: string,
    mode: 'prod' | 'dev' = 'prod',
    options: CaptivateChatAPIOptions = {}
  ): Promise<CaptivateChatAPI> {
    const api = new CaptivateChatAPI(apiKey, mode, options); // Constructor handles singleton
    if (Object.keys(options).length > 0) api.configure(options);

    // Only connect if socket is not already active
    if (!api.isSocketActive()) {
      await api.connect();
    }

    return withSocketGuard(api);
  }

  static getInstance(apiKey: string, mode: 'prod' | 'dev' = 'prod'): CaptivateChatAPI | undefined {
    return this.instances.get(this.getInstanceKey(apiKey, mode));
  }

  static hasInstance(apiKey: string, mode: 'prod' | 'dev' = 'prod'): boolean {
    return this.instances.has(this.getInstanceKey(apiKey, mode));
  }

  /**
   * Disposes of this instance, closing the WebSocket and removing it from the registry.
   * After calling dispose(), a new instance can be created for the same API key/mode combination.
   */
  public dispose(): void {
    const key = CaptivateChatAPI.getInstanceKey(this.apiKey, this.mode);
    this.isDisposed = true;

    for (const conversation of this.conversations.values()) {
      try {
        conversation.detachListeners();
      } catch (_) { /* ignore */ }
    }
    this.conversations.clear();

    // Closes with code 1000, which the close handler treats as intentional.
    this.teardownSocket('Instance disposed');
    this.socketId = null;

    CaptivateChatAPI.instances.delete(key);

    captivateLogger.log(`Disposed CaptivateChatAPI instance for ${key}`);
  }
}