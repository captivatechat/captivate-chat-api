import { CaptivateChatFileManager, TtlDays } from './CaptivateChatFileManager';
import { captivateLogger } from './CaptivateChatAPI';
import { BLUE_EVENTS, BlueAnswer, BlueAnswers } from './blue/answer';
import { blueFileManager } from './blue/files';
import { BlueUser, customerOf, detailsOf } from './blue/identity';
import {
  BlueCopy,
  BlueGreeting,
  ReadBack,
  channelMetadataOf,
  copyOfReadBack,
  isRecord,
  keptPart,
  merged,
  metadataWrapper,
  tooBig,
  transcriptOf,
} from './blue/shapes';
import { Clock, RUNTIME_CLOCK } from './blue/stream';
import { BlueTransport } from './blue/transport';
import { CONSOLE_WORDS, METADATA_TOO_BIG, NOT_HERE, SETUP_WORDS } from './blue/words';

const ALLOWED_TTL_DAYS: TtlDays[] = [1, 7, 30, 90];

/** stop() with a core key, warned once (first-channels-library-spec §2.2). */
const STOP_IN_CORE = 'stop() works only with a key for your app from Blue, so nothing was stopped.';
let stopWarned = false;

interface Action {
  id: string;
  data: any;
}

/** What a Blue conversation's handle is made with (first-channels-library-spec §2.2). */
export interface BlueHandle {
  transport: BlueTransport;
  /** The user's secret, as X-Blue-Conversation; without it, found by findSecret at the handle's first call. */
  secret?: string;
  /** The user's ID, when the call that made the handle named one. */
  userId?: string | null;
  /** For a handle from getConversation(id): the secret of the conversation's user, or null when nothing here knows it. */
  findSecret?: () => Promise<{ secret: string; userId: string | null } | null>;
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
export function blueStateOf(conversation: Conversation): BlueState | null {
  return (conversation as any).blueState ?? null;
}

/** Gives a handle what a list or a read-back says of its conversation, its runtime `metadata` too. */
export function takeBlueCopy(conversation: Conversation, copy: BlueCopy): void {
  const state = blueStateOf(conversation);
  if (!state) return;
  state.copy = copy;
  (conversation as any).metadata = { channelMetadata: channelMetadataOf(copy) };
}

/** What Blue mode doesn't do, as an Error with status 501 and its words. */
function notHere(words: string): Error {
  const error = new Error(words) as Error & { status: number; errorDesc: string };
  error.status = 501;
  error.errorDesc = words;
  return error;
}

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

/**
 * Represents a conversation session, handling HTTP communication for sending and WebSocket for receiving.
 * Client-side sending uses HTTP, while server-side real-time communication uses WebSocket listeners.
 */
export class Conversation {
  public apiKey: string;
  private conversationId: string;
  private metadata: object;
  public fileManager: any;
  /**
   * Fallback WebSocket, used only when no provider was supplied (legacy callers).
   */
  private socket: WebSocket | null;
  /**
   * Live connection view. Preferred over the captured socket/socketId above.
   */
  private provider?: ConversationSocketProvider;
  /**
   * Event listeners for real-time WebSocket communication.
   */
  private listeners: Map<string, Function[]>;
  private mode: 'prod' | 'dev';
  /**
   * Fallback socket ID, used only when no provider was supplied (legacy callers).
   */
  private socketId: string | null = null;
  /**
   * Bound message handler, kept so it can be added and removed by identity.
   */
  private readonly boundHandleMessage: (event: MessageEvent) => void;
  /**
   * The socket this instance currently has a listener on, so re-attaching is idempotent.
   */
  private attachedSocket: WebSocket | null = null;
  /**
   * Default TTL (days) for file uploads in this conversation. Set via setTimeToLive(); used when uploading files.
   */
  private defaultTtlDays: TtlDays | undefined;
  /**
   * Blue mode's answers, set when the conversation is one of Blue's (first-channels-library-spec
   * §2.2): its methods then take their Blue branch, and no socket is listened to.
   */
  private blue: BlueAnswers | null = null;
  private blueState: BlueState | null = null;
  private blueTransport: BlueTransport | null = null;
  private findBlueSecret: BlueHandle['findSecret'];

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
  constructor(
    conversation_id: string,
    socket: WebSocket | null,
    metadata?: object,
    apiKey?: string,
    mode?: 'prod' | 'dev',
    socketId?: string | null,
    provider?: ConversationSocketProvider,
    blue?: BlueHandle
  ) {
    this.apiKey = apiKey || '';
    this.conversationId = conversation_id;
    this.socket = socket ?? null;
    this.provider = provider;
    this.metadata = metadata || {};
    this.listeners = new Map();
    this.mode = mode || 'prod'; // Default to 'prod' if not specified
    this.socketId = socketId || null;
    this.defaultTtlDays = undefined;
    this.boundHandleMessage = this.handleMessage.bind(this);
    if (blue) {
      const state: BlueState = {
        userId: blue.userId ?? null,
        secret: blue.secret ?? null,
        copy: null,
        greeting: blue.greeting ?? null,
        given: { ...(blue.given ?? {}) },
        details: blue.details ?? null,
        user: { id: null },
      };
      const warnOnce = (name: string, words: string) => blue.transport.warnOnce(name, words);
      state.user = customerOf(state.given, warnOnce) ?? { id: null };
      this.blueState = state;
      this.blueTransport = blue.transport;
      this.findBlueSecret = blue.findSecret;
      if (blue.copy) takeBlueCopy(this, blue.copy);
      this.blue = new BlueAnswers({
        transport: blue.transport,
        clock: blue.clock,
        conversationId: conversation_id,
        // Read at each call: a handle from getConversation(id) finds its user's secret at its first.
        get secret() {
          return state.secret ?? '';
        },
        emit: (name, ...args) => this.emitBlue(name, args),
        has: (name) => (this.listeners.get(name)?.length ?? 0) > 0,
        customer: () => {
          const details = detailsOf(state.given, state.details, warnOnce);
          return { user: state.user, ...(details ? { details } : {}) };
        },
      });
      // On the next tick, so an app that registers onMessage once createConversation resolves gets it (§2.2).
      const greeting = state.greeting;
      if (greeting) (blue.clock ?? RUNTIME_CLOCK).setTimeout(() => this.greet(greeting), 0);
    }

    // Attach via addEventListener, never `socket.onmessage = ...`.
    // The old code assigned onmessage, which meant each new Conversation silently
    // destroyed the previous one's handler AND the API's own socket_connected handler —
    // so after the first Conversation was built the API could never refresh socketId.
    this.attachSocketListener();

    if (!this.apiKey) {
      console.warn('API key is required for HTTP communication. Some features may not work properly.');
    }

    // Blue mode: each file checked, given a place in Blue and PUT there by the app (§2.9).
    if (this.blueTransport) {
      this.fileManager = blueFileManager(this.blueTransport, conversation_id, () => this.blueSecret());
      return;
    }

    // Instantiate fileManager bound to this conversation context (uses this.defaultTtlDays for uploads)
    this.fileManager = {
      create: async (options: {
        file: File | Blob;
        fileName?: string;
        fileType?: string;
        storage?: boolean;
        url?: string;
      }): Promise<CaptivateChatFileManager> => {
        return CaptivateChatFileManager.create({
          file: options.file,
          fileName: options.fileName,
          fileType: options.fileType,
          storage: options.storage,
          url: options.url,
          apiKey: this.apiKey,
          conversationId: this.conversationId,
          ttlDays: this.defaultTtlDays
        } as any);
      },
      createFile: async (options: {
        file: File | Blob;
        fileName?: string;
        fileType?: string;
        storage?: boolean;
        url?: string;
      }): Promise<{
        filename: string;
        type: string;
        file?: File | Blob;
        textContent: {
          type: 'file_content';
          text: string;
          metadata: {
            source: 'file_attachment';
            originalFileName: string;
            storageType?: 'direct';
          };
        };
      }> => {
        return CaptivateChatFileManager.createFile({
          file: options.file,
          fileName: options.fileName,
          fileType: options.fileType,
          storage: options.storage,
          url: options.url,
          apiKey: this.apiKey,
          conversationId: this.conversationId,
          ttlDays: this.defaultTtlDays
        } as any);
      },
      createMultiple: async (options: {
        files: (File | Blob)[];
        storage?: boolean;
        urls?: string[];
      }): Promise<CaptivateChatFileManager> => {
        return CaptivateChatFileManager.createMultiple({
          files: options.files,
          storage: options.storage,
          urls: options.urls,
          apiKey: this.apiKey,
          conversationId: this.conversationId,
          ttlDays: this.defaultTtlDays
        } as any);
      }
    };
  }

  /**
   * The socket this conversation should currently be listening on.
   */
  private get liveSocket(): WebSocket | null {
    return this.provider ? this.provider.getSocket() : this.socket;
  }

  /**
   * The socket ID that outbound HTTP requests should carry.
   */
  private get liveSocketId(): string | null {
    return this.provider ? this.provider.getSocketId() : this.socketId;
  }

  /**
   * Sets the default time-to-live (TTL) for file uploads in this conversation and stores it in metadata.
   * When files are uploaded via conversation.fileManager.create(), this value is sent as ttlDays (1, 7, 30, or 90).
   * Does not call any path-TTL API; the value is applied only at upload time.
   * @param days - Must be 1, 7, 30, or 90. Other values are ignored.
   */
  public async setTimeToLive(days: number): Promise<void> {
    // Blue keeps a conversation's files with it for 90 days (§2.2).
    if (this.blue) {
      if (days === 90) return;
      throw notHere(days < 90 ? NOT_HERE.shorterTimeToLive : NOT_HERE.longerTimeToLive);
    }
    const d = days as TtlDays;
    if (ALLOWED_TTL_DAYS.includes(d)) {
      this.defaultTtlDays = d;
      await this.setMetadata({ timeToLive: days });
    }
  }

  /**
   * Handles incoming WebSocket messages for real-time communication.
   * @param event - The WebSocket message event.
   */
  private handleMessage(event: MessageEvent) {
    let message: any;
    try {
      message = JSON.parse(String(event.data));
    } catch (err) {
      // Not JSON, or a frame meant for something else — ignore rather than throw
      // out of a WebSocket event handler.
      return;
    }

    const eventType = message?.event?.event_type;
    if (!eventType || !this.listeners.has(eventType)) return;

    const payload = message.event.event_payload;
    // Copy before iterating: a callback may register or remove listeners.
    const callbacks = [...(this.listeners.get(eventType) ?? [])];
    for (const callback of callbacks) {
      try {
        callback(payload);
      } catch (err) {
        captivateLogger.error(`Listener for "${eventType}" threw:`, err);
      }
    }
  }

  /**
   * Attaches the message handler to the current socket, moving it if the socket changed.
   * Idempotent: calling this repeatedly never stacks duplicate handlers.
   */
  private attachSocketListener(): void {
    const socket = this.liveSocket;
    if (!socket) return;
    if (this.attachedSocket === socket) return;

    if (this.attachedSocket) {
      try {
        this.attachedSocket.removeEventListener('message', this.boundHandleMessage);
      } catch (_) { /* socket already gone */ }
    }

    socket.addEventListener('message', this.boundHandleMessage);
    this.attachedSocket = socket;
  }

  /**
   * Re-binds this conversation to the current socket. Call after a reconnect.
   * Safe to call any number of times.
   */
  public restartListeners(): void {
    this.attachSocketListener();
  }

  /**
   * Detaches this conversation's socket listener. Call when discarding the instance.
   */
  public detachListeners(): void {
    if (!this.attachedSocket) return;
    try {
      this.attachedSocket.removeEventListener('message', this.boundHandleMessage);
    } catch (_) { /* socket already gone */ }
    this.attachedSocket = null;
  }

  /**
   * Adds an event listener for a specific event type.
   * @param eventType - The type of event to listen for.
   * @param callback - The function to invoke when the event occurs.
   */
  private addListener(eventType: string, callback: Function): void {
    this.attachSocketListener();
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType)?.push(callback);
  }

  /**
   * Registers a listener for messages from the bot or live chat.
   * @param callback - The function to handle incoming messages.
   */
  public onMessage(callback: (message: string, type: string) => void): void {
    // Blue mode keeps the callback itself, so off('bot_message', callback) removes it.
    if (this.blue) return this.addListener(BLUE_EVENTS.message, callback);
    this.addListener('bot_message', (payload: any) => callback(payload.content, 'ai_agent'));
    this.addListener('livechat_message', (payload: any) => callback(payload.content, 'human_agent'));

    // Handle large messages that are too big for WebSocket usually from AI Agents
    this.addListener('general_error', async (payload: any) => {

      if (payload.error_code === 413 && payload.message_link) {
        try {
          const response = await fetch(payload.message_link, {
            method: 'GET',
            headers: {
              'x-api-key': this.apiKey,
              'Accept': 'application/json'
            }
          });
          if (!response.ok) {
            throw new Error(`Failed to fetch large message: ${response.status} ${response.statusText}`);
          }
          const messageData = await response.json();
          callback(messageData.botMessage.content, 'ai_agent');
        } catch (error: any) {
          console.error('Error fetching large message:', error);
          callback(`[Error fetching large message: ${error.message}]`, 'error');
        }
      } else {
        // Handle other general errors
        callback(`[Error: ${payload.error_desc || 'Unknown error'}]`, 'error');
      }
    });
  }

  /**
   * Registers a listener for receiving actions.
   * @param callback - The function to handle incoming action.
   */
  public onActionReceived(callback: (actions: [Action]) => void): void {
    if (this.blue) return this.addListener(BLUE_EVENTS.action, callback);
    this.addListener('action', (payload: any) => callback(payload.actions));
  }

  /**
   * Registers a listener for updates to the conversation.
   * @param callback - The function to handle conversation updates.
   */
  public onConversationUpdate(callback: (update: any) => void): void {
    if (this.blue) return this.addListener(BLUE_EVENTS.update, callback);
    this.addListener('conversation_update', (payload: any) => {
      callback({
        type: payload.type,
        conversationId: payload.conversation_id,
        data: payload.data,
      });
    });
  }

  /**
   * Registers a listener for error events.
   * @param callback - The function to handle errors.
   */
  public onError(callback: (error: any) => void): void {
    if (this.blue) return this.addListener(BLUE_EVENTS.error, callback);
    this.addListener('general_error', (payload: any) => {
      callback({
        conversationId: payload.conversation_id,
        errorCode: payload.error_code,
        errorDesc: payload.error_desc,
      });
    });
  }

  /**
   * Blue mode: the answer so far while it is written, its [n] markers out, once per network
   * chunk; `reset` when what was shown is dropped. Never called for a core key.
   */
  public onDelta(callback: (draft: string, info: { reset: boolean }) => void): void {
    if (this.blue) this.addListener(BLUE_EVENTS.delta, callback);
  }

  /**
   * Blue mode: the final answer once, with the sources its [n] point at and any quick replies.
   * Never called for a core key.
   */
  public onAnswer(callback: (answer: BlueAnswer) => void): void {
    if (this.blue) this.addListener(BLUE_EVENTS.answer, callback);
  }

  /** Blue mode: what the bot is doing, for a typing line ("Looking into it"). Never called for a core key. */
  public onStep(callback: (label: string) => void): void {
    if (this.blue) this.addListener(BLUE_EVENTS.step, callback);
  }

  /** Calls a Blue list's listeners in order; one that throws doesn't stop the others. */
  private emitBlue(name: string, args: unknown[]): void {
    for (const callback of [...(this.listeners.get(name) ?? [])]) {
      try {
        callback(...args);
      } catch (err) {
        captivateLogger.error(`Listener for "${name}" threw:`, err);
      }
    }
  }

  /**
   * Removes a previously registered listener.
   * @param eventType - The type of event.
   * @param callback - The callback function to remove.
   */
  public off(eventType: string, callback: Function): void {
    const callbacks = this.listeners.get(eventType);
    if (!callbacks) return;
    this.listeners.set(eventType, callbacks.filter((cb) => cb !== callback));
  }

  /**
   * Removes every listener registered on this conversation.
   */
  public removeAllListeners(): void {
    this.listeners.clear();
  }

  /**
   * Sends a message to the conversation.
   * @param content - The message content to send.
   * @returns A promise that resolves when the message is sent.
   */
  public async sendMessage(content: object | string): Promise<void> {
    if (this.blue) {
      const blue = this.blue;
      if (this.blueState?.secret) return blue.send(content);
      return this.blueSecret().then(() => blue.send(content));
    }
    // Check if content is a string and transform it into a default object
    if (typeof content === 'string') {
      content = { type: 'text', text: content };
    }

    return this.sendPayload('user_message', {
      type: 'message_create',
      client_msg_id: `unique-message-id-${Date.now()}`,
      conversation_id: this.conversationId,
      content,
    });
  }

  /**
   * Blue mode: stops the answer being written. `stopped: false` means nothing was being
   * answered, or the answer had just ended. A core key has nothing to stop.
   */
  public async stop(): Promise<{ stopped: boolean }> {
    if (this.blue) {
      const blue = this.blue;
      if (this.blueState?.secret) return blue.stop();
      return this.blueSecret().then(() => blue.stop());
    }
    if (!stopWarned) {
      stopWarned = true;
      captivateLogger.warn(STOP_IN_CORE);
    }
    return { stopped: false };
  }

  /**
   * Blue mode: call when the app comes back to the foreground, so an answer still pending is
   * read back. Nothing for a core key.
   */
  public resume(): void {
    this.blue?.resume();
  }

  /**
  * Sets metadata for the conversation and uses HTTP response for confirmation.
  * @param metadata - An object containing the metadata to set.
  * @returns A promise that resolves when the metadata update is successful.
  */
  public async setMetadata(metadata: object): Promise<void> {
    if (typeof metadata !== 'object' || metadata === null) {
      throw new Error('Metadata must be a non-null object.');
    }
    if (this.blueState) return this.setBlueMetadata(metadata as Record<string, unknown>);

    const metadataRequest = {
      action: 'sendMessage',
      event: {
        event_type: 'metadata',
        event_payload: {
          metadata,
          client_msg_id: `metadata-${Date.now()}`,
          conversation_id: this.conversationId,
        },
      },
    };

    // Send the metadata update request via HTTP and get response
    const response = await this.sendPayloadViaHttp(metadataRequest);

    // The HTTP response confirms the metadata was set successfully
    captivateLogger.log('Metadata update confirmed via HTTP response:', response);
  }

  /**
 * Sets private metadata for the conversation (not visible to frontend).
 * @param privateMeta - An object containing the private metadata to set.
 * @returns A promise that resolves when the metadata update is successful.
 */
  public async setPrivateMetadata(privateMeta: object): Promise<void> {
    if (typeof privateMeta !== 'object' || privateMeta === null) {
      throw new Error('Private metadata must be a non-null object.');
    }
    if (this.blueTransport) return this.blueTransport.warnOnce('privateMetadata', CONSOLE_WORDS.privateMetadata);
    // Reuse the setMetadata logic, but wrap in { private: ... }
    return this.setMetadata({ private: privateMeta });
  }

  /**
   * Sends an action to the conversation.
   * @param actionId - The unique ID of the action to send.
   * @param data - Optional data associated with the action.
   * @returns A promise that resolves when the action is sent.
   */
  public async sendAction(actionId: string, data: object = {}): Promise<void> {
    // Blue mode: a press on one of the bot's offers, `{ choice, values }` (§2.8).
    if (this.blue) {
      await this.blueSecret();
      return this.blue.press(actionId, data);
    }
    const response = await this.sendPayload('action', {
      type: 'normal',
      id: actionId,
      data,
      conversation_id: this.conversationId,
    });

    // The HTTP response confirms the action was sent successfully
    captivateLogger.log('Action sent confirmed via HTTP response:', response);
  }

  /**
   * Requests the transcript of the conversation with automatic file URL refresh.
   * @returns A promise that resolves to the conversation transcript with refreshed file URLs.
   */
  public async getTranscript(): Promise<object[]> {
    // Blue's read-back in core's shape; it never writes (core's refresh of file links is core's alone).
    if (this.blueState) {
      const back = await this.readBlue();
      return transcriptOf(this.conversationId, back, this.blueState.greeting);
    }
    if (!this.apiKey) {
      throw new Error('API key is required to fetch transcript via REST.');
    }
    const url = `${this.getBaseUrl()}/api/transcript?conversation_id=${encodeURIComponent(this.conversationId)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey,
        'Accept': 'application/json'
      }
    });
    if (!response.ok) {
      throw this.buildHttpError('Failed to fetch transcript', response, await response.text().catch(() => ''));
    }
    const data = await response.json();

    // Refresh expired file URLs in the transcript
    const refreshedTranscript = await this.refreshExpiredFileUrls(data.transcript);
    return refreshedTranscript;
  }

  /**
   * Refreshes expired file URLs in the transcript.
   * @param transcript - The transcript array to process.
   * @returns A promise that resolves to the transcript with refreshed file URLs.
   */
  private async refreshExpiredFileUrls(transcript: any[]): Promise<object[]> {
    if (!Array.isArray(transcript)) return [];
    const now = Math.floor(Date.now() / 1000);

    // Process all messages in parallel
    const refreshedMessages = await Promise.all(
      transcript.map(async (message) => {
        if (!message.files || message.files.length === 0) {
          return message;
        }

        // Process all files in parallel for this message
        const refreshedFiles = await Promise.all(
          message.files.map(async (file: any) => {
            if (!file.storage || !file.storage.fileKey) {
              return file; // No storage info, keep as is
            }

            try {
              const timeUntilExpiry = file.storage.expiresIn - now;

              if (timeUntilExpiry < 300) { // Less than 5 minutes
                // Refresh expired URL
                const refreshedUrl = await CaptivateChatFileManager.getSecureFileUrl(
                  file.storage.fileKey,
                  7200 // 2 hours
                );

                return {
                  ...file,
                  storage: {
                    ...file.storage,
                    presignedUrl: refreshedUrl,
                    expiresIn: now + 7200
                  }
                };
              } else {
                // URL is still valid
                return file;
              }
            } catch (error) {
              console.error(`Failed to refresh file ${file.filename}:`, error);
              return file; // Keep original file even if refresh failed
            }
          })
        );

        // Check if any files were refreshed
        const anyFileRefreshed = refreshedFiles.some((file, index) =>
          file !== message.files[index]
        );

        // If any file was refreshed, send an edit to update the message on the server
        if (anyFileRefreshed) {
          try {
            const messageId = message.message_id || message.id;
            if (messageId) {
              // Prefer existing content object if present; otherwise, construct minimal content
              const updatedContent = message.content
                ? { ...message.content, files: refreshedFiles }
                : { text: message.text || '', files: refreshedFiles };

              await this.editMessage(String(messageId), updatedContent);
            }
          } catch (err) {
            console.error('Failed to push refreshed URLs via editMessage:', err);
          }
        }

        return {
          ...message,
          files: refreshedFiles
        };
      })
    );

    return refreshedMessages;
  }

  /**
 * Requests metadata for the conversation using HTTP request with direct response.
 * @returns A promise that resolves to the conversation metadata.
 */
  public async getMetadata(): Promise<object> {
    if (this.blueState) {
      if (!this.blueState.copy) await this.readBlue();
      return metadataWrapper(this.conversationId, this.blueState.copy ?? { kept: {} });
    }
    const metadataRequest = {
      action: 'sendMessage',
      event: {
        event_type: 'metadata_request',
        event_payload: {
          conversation_id: this.conversationId,
        },
      },
    };

    // Send the metadata request via HTTP and get response
    const response = await this.sendPayloadViaHttp(metadataRequest);

    // The HTTP response contains the metadata
    captivateLogger.log('Metadata retrieved via HTTP response:', response);
    return response.metadata || response;
  }

  /**
   * Deletes this conversation using HTTP request with direct response.
   * @param options - Delete options object with softDelete property.
   * @param options.softDelete - Whether to perform a soft delete (true) or hard delete (false). Defaults to true.
   * @returns A promise that resolves when the conversation is deleted successfully.
   */
  public async delete(options: { softDelete?: boolean } = {}): Promise<void> {
    const { softDelete = true } = options;
    // A delete is a delete in Blue (apps own choice 12).
    if (this.blueTransport) {
      await this.blueTransport.request('DELETE', this.bluePath, { call: 'conversation', secret: await this.blueSecret() });
      return;
    }

    const deleteRequest = {
      action: 'sendMessage',
      event: {
        event_type: 'delete_conversation',
        event_payload: {
          conversation_id: this.conversationId,
          softdelete: softDelete
        },
      },
    };

    // Send the delete request via HTTP and get response
    const response = await this.sendPayloadViaHttp(deleteRequest);

    // The HTTP response confirms the conversation was deleted successfully
    captivateLogger.log(`Conversation ${softDelete ? 'soft' : 'hard'} delete confirmed via HTTP response:`, response);
  }

  /**
   * Edits a message in the conversation using HTTP request with direct response.
   * @param messageId - The ID of the message to edit.
   * @param content - The new content for the message (object or string).
   * @returns A promise that resolves when the edit is confirmed via HTTP response.
   */
  public async editMessage(messageId: string, content: object | string): Promise<void> {
    if (this.blue) throw notHere(NOT_HERE.editing);
    // If content is a string, wrap it in a default object
    if (typeof content === 'string') {
      content = { type: 'text', text: content };
    }

    const editRequest = {
      action: 'sendMessage',
      event: {
        event_type: 'edit_message',
        event_payload: {
          type: 'message_create',
          client_msg_id: `edit-message-id-${Date.now()}`,
          conversation_id: this.conversationId,
          message_id: messageId,
          content,
        },
      },
    };

    // Send the edit request via HTTP and get response
    const response = await this.sendPayloadViaHttp(editRequest);

    // The HTTP response confirms the message was edited successfully
    captivateLogger.log('Message edit confirmed via HTTP response:', response);
  }

  /**
   * Sends a payload via HTTP API (primary method).
   * @param eventType - The type of event being sent.
   * @param payload - The payload data to include with the event.
   * @returns A promise that resolves to the response data.
   */
  private async sendPayload(eventType: string, payload: object): Promise<any> {
    const message = {
      action: 'sendMessage',
      event: {
        event_type: eventType,
        event_payload: payload,
      },
    };

    return this.sendPayloadViaHttp(message);
  }

  /**
   * Builds an Error carrying the HTTP status, so callers can distinguish 401 from 429
   * from 500 instead of string-matching a message.
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
   * Sends a payload via HTTP API (primary communication method).
   * @param message - The message to send via HTTP.
   * @returns A promise that resolves to the response data.
   */
  private async sendPayloadViaHttp(message: object): Promise<any> {
    if (!this.apiKey) {
      throw new Error('API key is required for HTTP communication');
    }

    const url = `${this.getBaseUrl()}/api/custom-channel/sockets/message`;

    // Read socket_id LIVE. Capturing it at construction was the cause of 410 Gone:
    // after a reconnect the captured id pointed at a closed API Gateway connection.
    const socketId = this.liveSocketId;
    if (!socketId) {
      captivateLogger.warn(
        `No socket_id available for conversation ${this.conversationId}; the server may be unable to deliver the reply.`
      );
    }

    const messageWithSocketId = {
      ...message,
      event: {
        ...(message as any).event,
        socket_id: socketId
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
      // Network-level failure. Note that a rate-limited response without CORS headers
      // also lands here as an opaque TypeError, with no status available to JS.
      console.error('HTTP request failed:', error);
      throw new Error(
        `Failed to send payload via HTTP: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw this.buildHttpError('HTTP request failed', response, body);
    }

    // Check if response is JSON or plain text
    const contentType = response.headers.get('content-type');
    let responseData;

    if (contentType && contentType.includes('application/json')) {
      responseData = await response.json();
    } else {
      // Handle plain text response (like "OK")
      const textResponse = await response.text();
      captivateLogger.log('Server returned plain text:', textResponse);
      // Return a mock response structure for plain text responses
      responseData = {
        status: 'success',
        message: textResponse
      };
    }

    captivateLogger.log('Payload received from server via HTTP:', responseData);
    return responseData;
  }

  /**
   * Gets the base URL for API requests based on the current mode.
   * @returns The base URL for the API.
   */
  private getBaseUrl(): string {
    return this.mode === 'prod'
      ? 'https://channel.prod.captivat.io'
      : 'https://channel.dev.captivat.io';
  }

  private get bluePath(): string {
    return `/v1/chat/${encodeURIComponent(this.conversationId)}`;
  }

  /** The user's secret: the handle's, else found once (getConversation(id)); else each call refuses in §2.2's words. */
  private async blueSecret(): Promise<string> {
    const state = this.blueState!;
    if (state.secret) return state.secret;
    const found = await this.findBlueSecret?.();
    if (!found) throw new Error(SETUP_WORDS.userUnknown);
    state.secret = found.secret;
    if (found.userId !== null) state.userId = found.userId;
    return found.secret;
  }

  /** GET /v1/chat/:id: the handle's copy and the details' names come with it. */
  private async readBlue(): Promise<ReadBack> {
    const back =
      (await this.blueTransport!.request<ReadBack>('GET', this.bluePath, { call: 'conversation', secret: await this.blueSecret() })) ?? {};
    takeBlueCopy(this, copyOfReadBack(back));
    if (Array.isArray(back.details)) this.blueState!.details = back.details.filter((d) => typeof d === 'string');
    // A press on an offer read back knows its kind and fields.
    for (const message of Array.isArray(back.messages) ? back.messages : []) this.blue?.remember((message as any)?.offer);
    return back;
  }

  /**
   * Blue's setMetadata (§2.2, §2.7; gaps G10): everything as given kept in memory; all but
   * user_id and user_token merged into what Blue keeps, by PATCH. A call of only user_id,
   * user_token and the details' names sends nothing; one that would keep over 4 KB is refused first.
   */
  private async setBlueMetadata(metadata: Record<string, unknown>): Promise<void> {
    const state = this.blueState!;
    state.given = { ...state.given, ...metadata };
    // A call naming user_id names the customer anew (a token left out is no token); one that doesn't keeps them.
    const user = customerOf(metadata, (name, words) => this.blueTransport!.warnOnce(name, words));
    if (user) state.user = user;
    const sent = keptPart(metadata);
    const details = new Set(state.details ?? []);
    if (Object.keys(sent).every((name) => details.has(name))) return;
    if (tooBig(merged(state.copy?.kept ?? {}, sent))) throw new Error(METADATA_TOO_BIG);
    const answer = await this.blueTransport!.request<{ metadata?: unknown }>('PATCH', `${this.bluePath}/metadata`, {
      call: 'metadata',
      secret: await this.blueSecret(),
      body: { metadata: sent },
    });
    const kept = isRecord(answer?.metadata) ? answer!.metadata : merged(state.copy?.kept ?? {}, sent);
    takeBlueCopy(this, { ...(state.copy ?? {}), kept });
  }

  /** The bot-first greeting, once: onMessage, then onAnswer with its starters as quick replies (gaps G1). */
  private greet(greeting: BlueGreeting): void {
    if (this.blueTransport?.isDisposed) return;
    if (greeting.text) this.emitBlue(BLUE_EVENTS.message, [[{ type: 'text', text: greeting.text }], 'ai_agent']);
    const answer: BlueAnswer = { text: greeting.text, sources: [], ...(greeting.starters.length ? { choices: greeting.starters } : {}) };
    this.emitBlue(BLUE_EVENTS.answer, [answer]);
  }

  /**
   * Gets the unique identifier of the conversation.
   * @returns The conversation ID.
   */
  public getConversationId(): string {
    return this.conversationId;
  }
}