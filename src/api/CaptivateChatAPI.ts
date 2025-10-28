// Import the Conversation class
import { Conversation } from './Conversation';

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

// Removed unused `waitForSocketOpen` function to improve maintainability.

// Proxy guard function for automatic WebSocket state checking and reconnection
function withSocketGuard<T extends object>(instance: T): T {
  return new Proxy(instance, {
    get(target, prop, receiver) {
      const orig = target[prop as keyof T];
      if (
        typeof orig === 'function' &&
        !['isSocketActive', 'connect', 'reconnect', 'getSocket'].includes(prop as string)
      ) {
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
export class CaptivateChatAPI {
  private apiKey: string;
  private mode: 'prod' | 'dev';
  /**
   * WebSocket URL for real-time communication.
   */
  private url: string;
  /**
   * WebSocket connection for receiving real-time messages.
   */
  private socket: InstanceType<typeof WebSocketImpl> | null;
  private conversations: Map<string, Conversation>;
  /**
   * Socket ID received from socket_connected event.
   */
  private socketId: string | null = null;
  /**
   * WebSocket reconnection attempts counter.
   */
  private reconnectAttempts: number = 0;
  /**
   * Maximum number of reconnection attempts.
   */
  private maxReconnectAttempts: number = 5;
  /**
   * Delay between reconnection attempts.
   */
  private reconnectDelay: number = 3000;

  /**
   * Creates an instance of CaptivateChatAPI.
   * @param apiKey - The API key for authentication.
   * @param mode - The mode of operation ('prod' for production or 'dev' for development).
   */
  constructor(apiKey: string, mode: 'prod' | 'dev' = 'prod') {
    this.apiKey = apiKey;
    this.mode = mode;
    
    // Legacy WebSocket URL (deprecated)
    this.url =
      this.mode === 'prod'
        ? `wss://channel.wss.captivatechat.ai/dev?apiKey=${apiKey}`
        : `wss://channel-dev.wss.captivatechat.ai/dev?apiKey=${apiKey}`;
    
    this.socket = null;
    this.conversations = new Map();
    
    console.log('CaptivateChatAPI: Using HTTP for sending messages and WebSocket for receiving real-time updates.');
  }

  /**
   * Sends a message via HTTP API.
   * @param message - The message object to send.
   * @returns A promise that resolves to the response data.
   */
  private async _send(message: object): Promise<any> {
    if (!this.apiKey) {
      throw new Error('API key is required for HTTP communication');
    }

    const baseUrl = this.mode === 'prod'
      ? 'https://channel.prod.captivat.io'
      : 'https://channel.dev.captivat.io';
    
    const url = `${baseUrl}/api/custom-channel/sockets/message`;

    // Add socket_id to the event if available
    const messageWithSocketId = {
      ...message,
      event: {
        ...(message as any).event,
        socket_id: this.socketId
      }
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(messageWithSocketId)
      });

      if (!response.ok) {
        throw new Error(`HTTP request failed: ${response.status} ${response.statusText}`);
      }

      // Check if response is JSON or plain text
      const contentType = response.headers.get('content-type');
      let responseData;
      
      if (contentType && contentType.includes('application/json')) {
        responseData = await response.json();
      } else {
        // Handle plain text response (like "OK")
        const textResponse = await response.text();
        console.log('Server returned plain text:', textResponse);
        // Return a mock response structure for plain text responses
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
      
      console.log('Message received from server via HTTP:', responseData);
      return responseData;
    } catch (error) {
      console.error('HTTP request failed:', error);
      throw new Error(`Failed to send message via HTTP: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Connects to the WebSocket server for real-time communication.
   * @returns A promise that resolves once the connection is successfully established.
   */
  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocketImpl(this.url);

        const timeoutId = setTimeout(() => {
          reject(new Error('Connection timeout: socket_connected not received'));
        }, 10000);

        this.socket.onopen = () => {
          // WebSocket connected, waiting for API confirmation
        };

        this.socket.onmessage = (event: MessageEvent) => {
          try {
            const message = JSON.parse(event.data.toString());
            if (message.event?.event_type === 'socket_connected') {
              // Capture socket_id from the event payload
              this.socketId = message.event.event_payload?.socket_id || null;
              console.log('Socket connected with ID:', this.socketId);
              // API Successfully Connected
              clearTimeout(timeoutId);
              resolve();
            }
          } catch (err) {
            console.error('Error parsing message:', err);
          }
        };

        this.socket.onerror = (event: any) => {
          console.error('WebSocket Error:', event.message || event);
          clearTimeout(timeoutId);
          reject(new Error(event.message || 'WebSocket error'));
        };

        this.socket.onclose = (event) => {
          // WebSocket connection closed
          if (event.code !== 1000) { 
            // Attempting to reconnect
            setTimeout(() => this.connect(), 3000); // Reconnect after 3 seconds
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Creates a new conversation or starts a bot-first/user-first conversation.
   * @param userId - The unique identifier for the user.
   * @param userBasicInfo - Basic information about the user (e.g., name, email).
   * @param userData - Additional optional user data.
   * @param autoConversationStart - Mode to auto-start the conversation ('bot-first' or 'user-first').
   * @returns A promise that resolves to the created Conversation instance.
   */
  public async createConversation(
    userId: string,
    userBasicInfo: object = {},
    metadata: Record<string, any> = {},
    autoConversationStart: 'bot-first' | 'user-first' = 'bot-first',
    privateMetadata: object = {}
  ): Promise<Conversation> {
    return new Promise(async (resolve, reject) => {
      try {
        // Merge privateMetadata into metadata under the 'private' key if provided
        const fullMetadata: Record<string, any> = { ...metadata };
        if (privateMetadata) {
          fullMetadata.private = privateMetadata;
        }
        
        // Listen for conversation_start_success from WebSocket to get conversation_id
        // Set up listener BEFORE sending the HTTP request to avoid race conditions
        const onMessage = (event: MessageEvent) => {
          try {
            console.log('messagereceived:', event.data.toString());
            const message = JSON.parse(event.data.toString());
            if (message.event?.event_type === 'conversation_start_success') {
              const conversationId = message.event.event_payload?.conversation_id;
              if (!conversationId) {
                this.socket?.removeEventListener('message', onMessage);
                reject(new Error('No conversation_id received in WebSocket response'));
                return;
              }
              
              this.socket?.removeEventListener('message', onMessage);
              
              const conversation = withSocketGuard(new Conversation(conversationId, this.socket!, {}, this.apiKey, this.mode, this.socketId));
              this.conversations.set(conversationId, conversation);
              
              if (autoConversationStart === 'bot-first') {
                conversation.sendMessage({ type: 'text', text: '' })
                  .then(() => resolve(conversation))
                  .catch(reject);
              } else {
                resolve(conversation);
              }
            }
          } catch (err) {
            console.error('Error processing message:', err);
          }
        };

        this.socket?.addEventListener('message', onMessage);
        
        // Timeout if no WebSocket confirmation received
        setTimeout(() => {
          this.socket?.removeEventListener('message', onMessage);
          reject(new Error('Timeout: No conversation_start_success received from WebSocket'));
        }, 10000);
        
        // Send HTTP request AFTER setting up the listener
        await this._send({
          action: 'sendMessage',
          event: {
            event_type: 'conversation_start',
            event_payload: {
              userId,
              userBasicInfo,
              metadata: fullMetadata
            },
          },
        });
        
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Retrieves an existing conversation by its ID or creates a new one if not found.
   * @param conversationId - The unique ID of the conversation.
   * @returns The Conversation instance associated with the given ID.
   */
  getConversation(conversationId: string): Conversation | void {
    let conversation = this.conversations.get(conversationId);

    if (!conversation) {
      // If conversation is not found, check if socket is initialized
      if (this.socket !== null) {
        // If socket is initialized, create the conversation
        conversation = withSocketGuard(new Conversation(conversationId, this.socket,{},this.apiKey, this.mode, this.socketId));
        this.conversations.set(conversationId, conversation);
      } else {
        // Handle the case where socket is not initialized
        console.error('Socket is not initialized');
        throw new Error('WebSocket connection not established');
      }
    }

    conversation?.restartListeners();
    return conversation;
  }

  /**
   * Retrieves user conversations. Uses v2 if filter, search, or pagination is provided, otherwise uses v1.
   * Supports both legacy API (userId string) and new API (options object) for backward compatibility.
   * @param userIdOrOptions - Either a userId string (legacy) or options object containing userId and optional filter, search, and pagination.
   * @returns A promise resolving to an object with a list of Conversation instances and optional pagination data.
   */
  public async getUserConversations(
    userIdOrOptions: string | {
      userId: string;
      filter?: object;
      search?: object;
      pagination?: { page?: string | number; limit?: string | number };
      apiKeys?: string[]; // Restore multi-api-key support
    }
  ): Promise<{ conversations: Conversation[]; pagination?: {
    hasNextPage: boolean;
    hasPrevPage: boolean;
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  } }> {
    // Handle backward compatibility - if string is passed, treat as userId
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
    const useV2 = (filter && Object.keys(filter).length > 0) || (search && Object.keys(search).length > 0) || (pagination && Object.keys(pagination).length > 0) || (apiKeys && Array.isArray(apiKeys) && apiKeys.length > 0);
    return new Promise(async (resolve, reject) => {
      try {
        // Set up listener BEFORE sending the HTTP request to avoid race conditions
        const onMessage = (event: MessageEvent) => {
          try {
            const message = JSON.parse(event.data.toString());
            if (message.event?.event_type === 'user_conversations') {
              this.socket?.removeEventListener('message', onMessage);
              const payload = message.event.event_payload.conversations;
              for (const conv of payload) {
                const { conversation_id, metadata, apiKey } = conv;
                if (this.socket !== null) {
                  conversations.push(withSocketGuard(new Conversation(conversation_id, this.socket, metadata, apiKey || this.apiKey, this.mode, this.socketId)));
                }
              }
              // Extract pagination data if present
              if (message.event.event_payload.pagination) {
                paginationData = message.event.event_payload.pagination;
              }
              resolve({ conversations, pagination: paginationData });
            }
          } catch (err) {
            console.error('Error processing message:', err);
            reject(err);
          }
        };

        this.socket?.addEventListener('message', onMessage);

        setTimeout(() => {
          this.socket?.removeEventListener('message', onMessage);
          reject(new Error('Timeout: No response for getUserConversations'));
        }, 10000);

        // Send HTTP request AFTER setting up the listener
        if (useV2) {
          const eventPayload: any = { userId };
          if (filter && Object.keys(filter).length > 0) {
            eventPayload.filter = filter;
          }
          if (search && Object.keys(search).length > 0) {
            eventPayload.search = search;
          }
          if (pagination && Object.keys(pagination).length > 0) {
            eventPayload.pagination = pagination;
          }
          if (apiKeys && Array.isArray(apiKeys) && apiKeys.length > 0) {
            eventPayload.apiKeys = apiKeys;
          }
          await this._send({
            action: 'sendMessage',
            event: {
              event_type: 'get_user_conversations_v2',
              event_payload: eventPayload,
            },
          });
        } else {
          await this._send({
            action: 'sendMessage',
            event: {
              event_type: 'get_user_conversations',
              event_payload: {
                userId,
              },
            },
          });
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Deletes all conversations for a specific user using HTTP request with direct response.
   * @param userId - The unique identifier for the user whose conversations will be deleted.
   * @param options - Delete options object with softDelete property.
   * @param options.softDelete - Whether to perform a soft delete (true) or hard delete (false). Defaults to true.
   * @returns A promise that resolves when all conversations are successfully deleted.
   */
  public async deleteUserConversations(userId: string, options: { softDelete?: boolean } = {}): Promise<void> {
    if (!userId) {
      throw new Error('User ID must be provided.');
    }

    const { softDelete = true } = options;

    const deleteRequest = {
      action: 'sendMessage',
      event: {
        event_type: 'delete_user_conversations',
        event_payload: { 
          userId: userId,
          softdelete: softDelete
        },
      },
    };

    // Send the delete request via HTTP and get response
    const response = await this._send(deleteRequest);
    
    // The HTTP response confirms the conversations were deleted successfully
    console.log(`User conversations ${softDelete ? 'soft' : 'hard'} delete confirmed via HTTP response:`, response);
  }

  /**
   * Gets the WebSocket instance for real-time communication.
   */
  public getSocket() {
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
   * @returns True if the socket is open, false otherwise.
   */
  public isSocketActive(): boolean {
    return !!this.socket && this.socket.readyState === WebSocketImpl.OPEN;
  }

  /**
   * Attempts to reconnect to the WebSocket server for real-time communication.
   * @returns A promise that resolves when reconnection is successful.
   */
  public async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      throw new Error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
    }
    this.reconnectAttempts++;
    // Attempting to reconnect
    try {
      await this.connect();
      this.reconnectAttempts = 0; // Reset on successful connection
      // Reconnection successful
    } catch (error) {
      console.error(`Reconnection attempt ${this.reconnectAttempts} failed:`, error);
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        // Wait before next attempt
        await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
        return this.reconnect();
      } else {
        throw error;
      }
    }
  }

  /**
   * Static factory method to create and connect a CaptivateChatAPI instance.
   * The returned instance is automatically guarded: all method calls will check socket state and auto-reconnect if needed.
   * @param apiKey - The API key for authentication.
   * @param mode - The mode of operation ('prod' or 'dev').
   * @returns A promise that resolves to a connected and guarded CaptivateChatAPI instance.
   */
  static async create(apiKey: string, mode: 'prod' | 'dev' = 'prod'): Promise<CaptivateChatAPI> {
    const api = new CaptivateChatAPI(apiKey, mode);
    await api.connect();
    return withSocketGuard(api);
  }

}


