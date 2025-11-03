import { CaptivateChatFileManager } from './CaptivateChatFileManager';
import { captivateLogger } from './CaptivateChatAPI';

interface Action {
  id: string;
  data: any;
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
   * WebSocket connection for receiving real-time messages from server.
   */
  private socket: WebSocket;
  /**
   * Event listeners for real-time WebSocket communication.
   */
  private listeners: Map<string, Function[]>;
  private mode: 'prod' | 'dev';
  /**
   * Socket ID for HTTP requests.
   */
  private socketId: string | null = null;
  /**
   * Initializes a new Conversation instance.
   * @param conversationId - The unique identifier of the conversation.
   * @param socket - WebSocket instance for receiving real-time messages.
   * @param metadata - Optional metadata for the conversation.
   * @param apiKey - API key for HTTP communication (required).
   * @param mode - The mode of operation ('prod' or 'dev').
   * @param socketId - Socket ID for HTTP requests.
   */
  constructor(conversation_id: string, socket: WebSocket, metadata?: object, apiKey?: string, mode?: 'prod' | 'dev', socketId?: string | null) {
    this.apiKey = apiKey || '';
    this.conversationId = conversation_id;
    this.socket = socket;
    this.metadata = metadata || {};
    this.listeners = new Map();
    this.mode = mode || 'prod'; // Default to 'prod' if not specified
    this.socketId = socketId || null;

    // WebSocket listeners for real-time communication from server
    if (this.socket) {
      this.socket.onmessage = this.handleMessage.bind(this);
    }

    if (!this.apiKey) {
      console.warn('API key is required for HTTP communication. Some features may not work properly.');
    }

    // Instantiate fileManager bound to this conversation context
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
          conversationId: this.conversationId
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
          conversationId: this.conversationId
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
          conversationId: this.conversationId
        } as any);
      }
    };
  }

  /**
   * Handles incoming WebSocket messages for real-time communication.
   * @param event - The WebSocket message event.
   */
  private handleMessage(event: MessageEvent) {
    
    const message = JSON.parse(event.data);
    const eventType = message.event?.event_type;
    if (eventType && this.listeners.has(eventType)) {
      const payload = message.event.event_payload;
      this.listeners.get(eventType)?.forEach((callback) => callback(payload));
    }
  }

  /**
   * Restarts WebSocket listeners for real-time communication.
   */
  public restartListeners() {
    // Listen to WebSocket messages and handle events.
    this.socket.onmessage = this.handleMessage.bind(this);
  }

  /**
   * Adds an event listener for a specific event type.
   * @param eventType - The type of event to listen for.
   * @param callback - The function to invoke when the event occurs.
   */
  private addListener(eventType: string, callback: Function): void {
    this.restartListeners();
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
    this.addListener('action', (payload: any) => callback(payload.actions));
  }

  /**
   * Registers a listener for updates to the conversation.
   * @param callback - The function to handle conversation updates.
   */
  public onConversationUpdate(callback: (update: any) => void): void {
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
    this.addListener('general_error', (payload: any) => {
      callback({
        conversationId: payload.conversation_id,
        errorCode: payload.error_code,
        errorDesc: payload.error_desc,
      });
    });
  }

  /**
   * Sends a message to the conversation.
   * @param content - The message content to send.
   * @returns A promise that resolves when the message is sent.
   */
  public async sendMessage(content: object | string): Promise<void> {
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
  * Sets metadata for the conversation and uses HTTP response for confirmation.
  * @param metadata - An object containing the metadata to set.
  * @returns A promise that resolves when the metadata update is successful.
  */
  public async setMetadata(metadata: object): Promise<void> {
    if (typeof metadata !== 'object' || metadata === null) {
      throw new Error('Metadata must be a non-null object.');
    }

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
    // Reuse the setMetadata logic, but wrap in { private: ... }
    return this.setMetadata({ private: privateMeta });
  }

  /**
   * Sets the time-to-live (TTL) for the conversation path and updates metadata.
   * @param days - The number of days for the time-to-live.
   * @returns A promise that resolves when the TTL is set successfully.
   */
  public async setTimeToLive(days: number): Promise<void> {
    // Use the file manager method to set path TTL
    await CaptivateChatFileManager.setTimeToLive(this.apiKey, this.conversationId, days);
    
    // Also set timeToLive as metadata
    await this.setMetadata({ timeToLive: days });
  }


  /**
   * Sends an action to the conversation.
   * @param actionId - The unique ID of the action to send.
   * @param data - Optional data associated with the action.
   * @returns A promise that resolves when the action is sent.
   */
  public async sendAction(actionId: string, data: object = {}): Promise<void> {
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
      throw new Error(`Failed to fetch transcript: ${response.status} ${response.statusText}`);
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
   * Sends a payload via HTTP API (primary communication method).
   * @param message - The message to send via HTTP.
   * @returns A promise that resolves to the response data.
   */
  private async sendPayloadViaHttp(message: object): Promise<any> {
    if (!this.apiKey) {
      throw new Error('API key is required for HTTP communication');
    }

    const url = `${this.getBaseUrl()}/api/custom-channel/sockets/message`;

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
        captivateLogger.log('Server returned plain text:', textResponse);
        // Return a mock response structure for plain text responses
        responseData = {
          status: 'success',
          message: textResponse
        };
      }
      
      captivateLogger.log('Payload received from server via HTTP:', responseData);
      return responseData;
    } catch (error) {
      console.error('HTTP request failed:', error);
      throw new Error(`Failed to send payload via HTTP: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Removes a specific event listener.
   * @param eventType - The type of event.
   * @param callback - The callback function to remove.
   */
  private removeListener(eventType: string, callback: Function): void {
    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      this.listeners.set(
        eventType,
        callbacks.filter((cb) => cb !== callback)
      );
    }
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

  /**
   * Gets the unique identifier of the conversation.
   * @returns The conversation ID.
   */
  public getConversationId(): string {
    return this.conversationId;
  }




}
