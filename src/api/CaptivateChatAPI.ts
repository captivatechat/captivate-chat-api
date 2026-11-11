// Import the Conversation class
import { BlueHandle, Conversation, ConversationSocketProvider, blueStateOf, takeBlueCopy, takeListedDetails } from './Conversation';
import { SERVER_USER_FORM, blueKeyKind, hideFromJson, isBlueKey, keyIdOf, serverModeRefused } from './blue/keys';
import { BlueUsers, base64url, sha256, utf8Bytes } from './blue/secrets';
import { CorePagination, ListedConversation, copyOfListed, isRecord, keptPart, listQuery, paginationOf, tooBig } from './blue/shapes';
import { Clock } from './blue/stream';
import { BlueOptions, BlueTransport, blueError } from './blue/transport';
import { CONSOLE_WORDS, METADATA_TOO_BIG, SETUP_WORDS, WORDS } from './blue/words';

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
  // dispose and connect call it through the instance they were called on: guarded, it
  // reconnected a disposed instance and rejected with nobody to hear it.
  'teardownSocket',
  // Synchronous and local. Guarded, configure() on a dead instance reconnected with the settings it
  // was about to change before changing them, and either rejected with nobody to hear it.
  'configure',
  'releaseConversation',
  // registry + local lookups
  'getConversation',
  'getConversationId',
  // local listener management
  'restartListeners',
  'detachListeners',
  'removeAllListeners',
  'off',
  // A field, not a method: detachListeners removes it by identity, and a wrapper never matched
  // the handler attachSocketListener added, so a released handle kept hearing its socket.
  'boundHandleMessage',
  // Blue mode's listeners and its local calls: synchronous, as their types say
  'onDelta',
  'onAnswer',
  'onStep',
  'resume',
  'forgetUser',
  // Blue mode's handle maker, called from getConversation through the guarded instance
  'blueConversation',
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
 * Server mode's user for a call: the ID as given, checked against X-Blue-User's form before
 * anything is sent (first-channels-server-key-spec §2.2, §3.3). A function, not a method, since
 * withSocketGuard would make a method async.
 */
function serverUser(userId: unknown): string {
  if (typeof userId !== 'string' || !SERVER_USER_FORM.test(userId)) throw new Error(SETUP_WORDS.serverUserForm);
  return userId;
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
 * A key as logs and errors may name it, never the key itself: a server key by its id, an app key
 * (whose id is the whole key) and a core key by their last 4 characters, or by a short hash for a
 * key under 16 characters, where 4 would give away too much of it. The package's index doesn't
 * export it.
 */
export function keyLabel(apiKey: string): string {
  if (blueKeyKind(apiKey) === 'app') return `vba_…${apiKey.slice(-4)}`;
  if (isBlueKey(apiKey)) return keyIdOf(apiKey);
  return apiKey.length >= 16 ? `…${apiKey.slice(-4)}` : `#${base64url(sha256(utf8Bytes(apiKey))).slice(0, 8)}`;
}

export class CaptivateChatAPI implements ConversationSocketProvider {
  /**
   * Static registry to track instances by API key and mode.
   * Enforces singleton pattern: one instance per unique (apiKey, mode) combination.
   */
  private static instances: Map<string, CaptivateChatAPI> = new Map();

  /**
   * Generates a unique instance key for the registry. A Blue key's is a sha256 of key and mode,
   * so a server key's secret never sits in the registry (first-channels-server-key-spec §3.1);
   * core's keys keep today's, which Engage reads.
   */
  private static getInstanceKey(apiKey: string, mode: 'prod' | 'dev'): string {
    if (isBlueKey(apiKey)) return `blue:${base64url(sha256(utf8Bytes(`${apiKey}\n${mode}`)))}`;
    return `${apiKey}-${mode}`;
  }

  /** How the registry's log lines name an instance, never by the key itself (keyLabel). */
  private static nameOf(apiKey: string, mode: 'prod' | 'dev'): string {
    return `${keyLabel(apiKey)}-${mode}`;
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
  /** In-flight reconnect cycle, so concurrent callers share one. */
  private reconnectPromise: Promise<void> | null = null;
  /** Blue mode's transport, set when the key is one of Blue's: no socket is opened then. */
  private blue: BlueTransport | null = null;
  /** Blue mode's users and their secrets (first-channels-library-spec §2.6). */
  private blueUsers: BlueUsers | null = null;
  /** The timers Blue's conversations use: the runtime's unless a test sets one. */
  private blueClock: Clock | undefined = undefined;
  /**
   * The conversation a reply naming none goes to, since core's gateway names none in its replies
   * yet: the last one here that sent a message or an action (Conversation.becomeActive) or was
   * just created. Listing, opening, metadata and reconnects leave it; releasing it clears it.
   * Null until then, and every handle hears such a reply, as before.
   */
  private activeConversationId: string | null = null;

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
      captivateLogger.log(`Reusing existing CaptivateChatAPI instance for ${CaptivateChatAPI.nameOf(apiKey, mode)}`);
      return existingInstance;
    }

    // Initialize new instance
    this.apiKey = apiKey;
    this.mode = mode;

    // A key shaped vb?_ is one of Blue's (first-channels-library-spec §2.1); every other key
    // keeps core's path below. A refused key is never registered.
    const blueKind = blueKeyKind(apiKey);
    if (blueKind === 'website') throw new Error(SETUP_WORDS.websiteKey);
    if (blueKind === 'other') throw new Error(SETUP_WORDS.notForApps);
    if (blueKind === 'server-partial') throw new Error(SETUP_WORDS.serverKeyNotWhole);
    // A whole vbk_ key is server mode, refused where the library can tell it runs in an app, a page
    // or a browser worker (first-channels-server-key-spec §3.1; K-D4 (a)).
    if (blueKind === 'server') {
      if (serverModeRefused()) throw new Error(SETUP_WORDS.serverKeyInApp);
      this.blue = new BlueTransport(apiKey, mode, options, captivateLogger, true);
    }
    if (blueKind === 'app') {
      this.blue = new BlueTransport(apiKey, mode, options, captivateLogger);
      this.blueUsers = new BlueUsers(this.blue);
    }

    this.url =
      this.mode === 'prod'
        ? `wss://channel.wss.captivatechat.ai/dev?apiKey=${apiKey}`
        : `wss://channel-dev.wss.captivatechat.ai/dev?apiKey=${apiKey}`;

    this.socket = null;
    // Core's key too, and the socket, whose address carries it as ?apiKey= (ws's own, on Node 20):
    // a handle's provider is this instance, so JSON.stringify of a handle would list them.
    // Blue's transport and users too: a user's secret and ID sit in the users' maps, which console.log
    // and util.inspect of the instance would otherwise list at Node's default depth.
    hideFromJson(this, 'apiKey', 'url', 'socket', 'blue', 'blueUsers');
    this.conversations = new Map();
    this.configure(options);

    // Store in registry
    CaptivateChatAPI.instances.set(instanceKey, this);

    captivateLogger.log(`Created new CaptivateChatAPI instance for ${CaptivateChatAPI.nameOf(apiKey, mode)}`);
    captivateLogger.log(
      this.blue
        ? 'CaptivateChatAPI: Blue mode, every call one HTTPS request and no socket.'
        : 'CaptivateChatAPI: Using HTTP for sending messages and WebSocket for receiving real-time updates.'
    );
  }

  /** Updates tunables on a live instance. */
  public configure(options: CaptivateChatAPIOptions = {}): void {
    if (this.blue) this.blue.configure(options);
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
    // The message is 7.0.0's, since apps show or match it; the server's own words are on `.body`.
    const error = new Error(`${prefix}: ${response.status} ${response.statusText}`) as Error & {
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
      throw this.buildHttpError('Failed to send message via HTTP: HTTP request failed', response, body);
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
    // The id goes with its socket. The close handler that used to clear it bails here, so a
    // replaced or abandoned socket's id stayed and sends went out with a dead socket_id.
    this.socketId = null;
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
    // Blue mode has no socket to open.
    if (this.blue) return;
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
        // Give the socket up: open without socket_connected (core's gateway does this to about
        // 1 socket in 4), it can't be sent replies, yet it kept isSocketActive() true, so neither
        // create() nor the guard ever replaced it.
        if (this.socket === socket) this.teardownSocket('Connection timeout');
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
        // Only the instance's own socket names the id: a late frame on a socket replaced or
        // given up would put back an id nothing can reach.
        if (this.socket !== socket) return;

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
    if (this.blue) return this.createBlueConversation(userId, metadata, autoConversationStart, privateMetadata, options);
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
        // socketId live instead of freezing whatever they happen to be right now. It holds
        // the metadata as given, without the private part, which the server never gives back.
        const conversation = withSocketGuard(
          new Conversation(conversationId, this.socket, { ...metadata }, this.apiKey, this.mode, this.socketId, this)
        );
        this.conversations.set(conversationId, conversation);
        // The bot-first greeting names no conversation: it goes to this one.
        this.activeConversationId = conversationId;

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
   *
   * @param userId - Server mode: the user the call is for, on every call. A fresh handle each
   *                 time, never kept, so one user's request never acts as another's. With an app
   *                 key: the user whose secret a conversation this instance doesn't know is
   *                 opened with. Unused with a core key.
   * @param metadata - Server mode: this request's metadata, held in memory only (nothing is sent), so
   *                   its user_id names the customer and its details go with each message. Unused otherwise.
   */
  public getConversation(conversationId: string, userId?: string, metadata?: Record<string, any>): Conversation {
    if (this.blue?.serverMode) {
      if (userId === undefined) throw new Error(SETUP_WORDS.nameTheUser);
      const user = serverUser(userId);
      return this.blueConversation(conversationId, { secret: user, userId: user, given: isRecord(metadata) ? { ...metadata } : {} });
    }
    let conversation = this.conversations.get(conversationId);

    if (!conversation && this.blue) {
      const named = typeof userId === 'string' && userId !== '' ? userId : null;
      conversation = this.blueConversation(conversationId, {
        findSecret: named ? () => this.secretOfUser(named) : () => this.secretOfConversation(conversationId),
        ...(named ? { userId: named } : {}),
      });
      this.conversations.set(conversationId, conversation);
    }
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
    if (this.activeConversationId === conversationId) this.activeConversationId = null;
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
    if (this.blue) return this.blueUserConversations(isRecord(options) ? options : { userId: options as unknown as string });

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
      // the caller are not silently dropped and duplicate handles are not created. It takes
      // the list's details, as a fresh handle would: one created or opened here held {}.
      const existing = this.conversations.get(conversation_id);
      if (existing) {
        takeListedDetails(existing, metadata, apiKey || this.apiKey);
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
  public async deleteUserConversations(
    userId: string,
    options: { softDelete?: boolean } = {}
  ): Promise<void | { deleted: number; busy: number }> {
    // Server mode checks the user's ID in its own words (first-channels-server-key-spec §3.3).
    if (this.blue?.serverMode) return this.deleteBlueUserConversations(userId);
    if (!userId) {
      throw new Error('User ID must be provided.');
    }
    if (this.blue) return this.deleteBlueUserConversations(userId);

    const { softDelete = true } = options;

    const response = await this._send({
      action: 'sendMessage',
      event: {
        event_type: 'delete_user_conversations',
        event_payload: { userId, softdelete: softDelete },
      },
    });

    // Local handles stay as 7.0.0 left them: this instance serves other users too, and a
    // handle of theirs released here would go quiet with no error.

    captivateLogger.log(`User conversations ${softDelete ? 'soft' : 'hard'} delete confirmed via HTTP response:`, response);
  }

  /**
   * Blue mode: forgets a user on this device, their stored secret and their conversations'
   * handles. Call it when the user signs out. Nothing with a core key.
   */
  public forgetUser(userId: string): void {
    const users = this.blueUsers;
    if (!users) return;
    const theirs = new Set(users.conversationsOf(userId));
    // As releaseConversation does: called on a guarded instance, that would go through the guard.
    for (const [id, conversation] of [...this.conversations]) {
      if (!theirs.has(id) && blueStateOf(conversation)?.userId !== userId) continue;
      conversation.detachListeners();
      this.conversations.delete(id);
    }
    users.forget(userId).catch((error) => captivateLogger.warn('Blue mode: a user could not be forgotten on this device', error));
  }

  /** A Blue conversation's handle, guarded as core's are. */
  private blueConversation(conversationId: string, handle: Omit<BlueHandle, 'transport' | 'clock'>): Conversation {
    const conversation = new Conversation(conversationId, null, {}, this.apiKey, this.mode, null, this, {
      transport: this.blue!,
      clock: this.blueClock,
      ...handle,
    });
    return withSocketGuard(conversation);
  }

  /** getConversation(id, userId)'s user, when this device knows their secret. */
  private async secretOfUser(userId: string): Promise<{ secret: string; userId: string | null } | null> {
    const secret = await this.blueUsers!.secretFor(userId, false);
    return secret === null ? null : { secret, userId };
  }

  /** getConversation(id)'s user: the one kept with the conversation, else the last one named here (§2.2). */
  private async secretOfConversation(conversationId: string): Promise<{ secret: string; userId: string | null } | null> {
    const users = this.blueUsers!;
    const own = users.userOf(conversationId);
    if (own) return own;
    const kept = await users.secretOfConversation(conversationId);
    if (kept) return { secret: kept, userId: null };
    const last = users.lastUser;
    if (last === null) return null;
    const secret = await users.secretFor(last, false);
    return secret === null ? null : { secret, userId: last };
  }

  /**
   * Blue's createConversation (§2.2): the user's secret, then POST /v1/chat/conversations with the
   * metadata as given but its user_id and user_token, which stay in memory. userBasicInfo and
   * private metadata are never sent. A bot-first greeting comes to onMessage on the next tick.
   */
  private async createBlueConversation(
    userId: string,
    metadata: Record<string, any>,
    autoConversationStart: 'bot-first' | 'user-first',
    privateMetadata: object,
    options: { timeoutMs?: number }
  ): Promise<Conversation> {
    const transport = this.blue!;
    const server = transport.serverMode;
    if (server) serverUser(userId);
    else if (typeof userId !== 'string' || !userId) throw new Error('User ID must be provided.');
    const given = isRecord(metadata) ? { ...metadata } : {};
    const kept = keptPart(given);
    if (tooBig(kept)) throw new Error(METADATA_TOO_BIG);
    if (isRecord(privateMetadata) && Object.keys(privateMetadata).length > 0) {
      transport.warnOnce('privateMetadata', CONSOLE_WORDS.privateMetadata);
    }
    const secret = server ? userId : (await this.blueUsers!.secretFor(userId, true))!;
    const answer = await transport.request<{
      conversationId?: unknown;
      greeting?: { text?: unknown; starters?: unknown } | null;
      details?: unknown;
    }>('POST', '/v1/chat/conversations', {
      call: 'start',
      secret,
      body: { metadata: kept, greeting: autoConversationStart === 'bot-first' },
      timeoutMs: options.timeoutMs ?? this.conversationStartTimeoutMs,
    });
    const conversationId = answer?.conversationId;
    if (typeof conversationId !== 'string' || !conversationId) throw blueError(WORDS.couldntAnswer);
    const opening = answer?.greeting;
    const greeting =
      autoConversationStart === 'bot-first' && opening && typeof opening.text === 'string'
        ? {
            text: opening.text,
            starters: Array.isArray(opening.starters) ? opening.starters.filter((s): s is string => typeof s === 'string') : [],
            at: new Date().toISOString(),
          }
        : null;
    const details = Array.isArray(answer?.details) ? answer!.details.filter((d): d is string => typeof d === 'string') : [];
    const conversation = this.blueConversation(conversationId, { secret, userId, copy: { kept }, greeting, given, details });
    // Server mode keeps no handle: it lasts the request that made it.
    if (server) return conversation;
    this.conversations.set(conversationId, conversation);
    await this.blueUsers!.bind([conversationId], userId);
    return conversation;
  }

  /**
   * Blue's getUserConversations (§2.2; gaps G13): none without the user's secret; else a page of
   * GET /v1/chat/conversations, newest first, each a handle whose metadata.channelMetadata holds
   * its dates, last message, preview and kept metadata (`custom`), with core's pagination.
   */
  private async blueUserConversations(options: {
    userId: string;
    filter?: object;
    search?: object;
    pagination?: { page?: string | number; limit?: string | number };
    apiKeys?: string[];
  }): Promise<{ conversations: Conversation[]; pagination: CorePagination }> {
    const { userId, filter, search, apiKeys } = options;
    const server = this.blue!.serverMode;
    if (server) serverUser(userId);
    else if (typeof userId !== 'string' || !userId) throw new Error('User ID must be provided.');
    const asked = (value: unknown) => isRecord(value) && Object.keys(value).length > 0;
    if (asked(filter) || asked(search) || (Array.isArray(apiKeys) && apiKeys.length > 0)) {
      this.blue!.warnOnce('listFilters', CONSOLE_WORDS.listFilters);
    }
    const query = listQuery(options.pagination);
    const users = this.blueUsers;
    const secret = server ? userId : await users!.secretFor(userId, false);
    if (secret === null) return { conversations: [], pagination: paginationOf(0, query.page, query.limit) };
    const answer = await this.blue!.request<{ total?: unknown; page?: unknown; pageSize?: unknown; items?: unknown }>(
      'GET',
      `/v1/chat/conversations?page=${query.page}&limit=${query.limit}`,
      { call: 'conversation', secret }
    );
    const items = (Array.isArray(answer?.items) ? answer!.items : []).filter(
      (item): item is ListedConversation => isRecord(item) && typeof item.conversationId === 'string' && item.conversationId !== ''
    );
    const conversations = items.map((item) => {
      const copy = copyOfListed(item);
      // Server mode: fresh handles carrying this user, kept nowhere.
      if (server) return this.blueConversation(item.conversationId, { secret, userId, copy });
      const existing = this.conversations.get(item.conversationId);
      if (existing) {
        const state = blueStateOf(existing);
        if (state && !state.secret) {
          state.secret = secret;
          state.userId = userId;
        }
        takeBlueCopy(existing, copy);
        return existing;
      }
      const conversation = this.blueConversation(item.conversationId, { secret, userId, copy });
      this.conversations.set(item.conversationId, conversation);
      return conversation;
    });
    if (users) await users.bind(items.map((item) => item.conversationId), userId);
    const number = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
    return {
      conversations,
      pagination: paginationOf(number(answer?.total, items.length), number(answer?.page, query.page), number(answer?.pageSize, query.limit)),
    };
  }

  /** Blue's deleteUserConversations (§2.2; gaps G13): every one of the user's, those still answering left and counted in `busy`. */
  private async deleteBlueUserConversations(userId: string): Promise<{ deleted: number; busy: number }> {
    const users = this.blueUsers;
    const secret = users ? await users.secretFor(userId, false) : serverUser(userId);
    if (secret === null) return { deleted: 0, busy: 0 };
    const done = await this.blue!.request<{ deleted?: unknown; busy?: unknown }>('DELETE', '/v1/chat/conversations', {
      call: 'delete',
      secret,
    });
    const theirs = new Set(users?.conversationsOf(userId) ?? []);
    for (const [id, conversation] of [...this.conversations]) {
      if (theirs.has(id) || blueStateOf(conversation)?.userId === userId) this.releaseConversation(id);
    }
    const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
    return { deleted: count(done?.deleted), busy: count(done?.busy) };
  }

  /**
   * Gets the WebSocket instance for real-time communication.
   */
  public getSocket(): WebSocket | null {
    if (this.blue) return null;
    return this.socket;
  }

  /**
   * Gets the socket ID for HTTP requests.
   */
  public getSocketId(): string | null {
    if (this.blue) return null;
    return this.socketId;
  }

  /**
   * Checks if the WebSocket connection is active and open for real-time communication.
   */
  public isSocketActive(): boolean {
    // In Blue mode it stays true until dispose(), so the guard never reconnects and apps on
    // 7.0 that stop sending while it's false keep sending (§0, rule 4).
    if (this.blue) return !this.isDisposed;
    // Open is not enough: until socket_connected names its id, a socket can't be sent replies, so
    // create() and the guard treat it as not active and wait for (or start) a handshake.
    return !!this.socket && this.socket.readyState === WebSocketImpl.OPEN && !!this.socketId;
  }

  /**
   * Attempts to reconnect to the WebSocket server, then re-binds every cached
   * conversation to the new socket.
   *
   * Each call starts a fresh cycle of at most maxReconnectAttempts tries; callers while one is
   * running (the guard, the auto-reconnect, the app) share it.
   */
  public async reconnect(): Promise<void> {
    if (this.isDisposed) {
      throw new Error('This CaptivateChatAPI instance has been disposed. Create a new one.');
    }
    if (this.blue) return;
    if (this.reconnectPromise) return this.reconnectPromise;
    if (this.maxReconnectAttempts < 1) {
      throw new Error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
    }

    // The counter used to reset only on success, so after one failed cycle every later reconnect,
    // the guard's and the auto-reconnect's among them, threw at once and the instance never recovered.
    this.reconnectAttempts = 0;
    // A closure, not a private method: called through create()'s guarded instance, a method would
    // be wrapped by the guard, which reconnects first.
    const cycle = async (): Promise<void> => {
      for (;;) {
        this.reconnectAttempts++;
        try {
          await this.connect();
          this.reconnectAttempts = 0;

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
          return;
        } catch (error) {
          captivateLogger.error(`Reconnection attempt ${this.reconnectAttempts} failed:`, error);
          if (this.reconnectAttempts >= this.maxReconnectAttempts || this.isDisposed) throw error;
          await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
          if (this.isDisposed) {
            throw new Error('This CaptivateChatAPI instance has been disposed. Create a new one.');
          }
        }
      }
    };
    this.reconnectPromise = cycle().finally(() => {
      this.reconnectPromise = null;
    });
    return this.reconnectPromise;
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
    const name = CaptivateChatAPI.nameOf(this.apiKey, this.mode);
    this.isDisposed = true;
    // Ends every Blue call in flight; the answers themselves go on in the backend.
    this.blue?.dispose();

    for (const conversation of this.conversations.values()) {
      try {
        conversation.detachListeners();
      } catch (_) { /* ignore */ }
    }
    this.conversations.clear();
    this.activeConversationId = null;

    // Closes with code 1000, which the close handler treats as intentional. Blue mode has no
    // socket. teardownSocket is in UNGUARDED_METHODS, so a guarded instance never reconnects here.
    if (!this.blue) this.teardownSocket('Instance disposed');
    this.socketId = null;

    CaptivateChatAPI.instances.delete(key);

    captivateLogger.log(`Disposed CaptivateChatAPI instance for ${name}`);
  }
}