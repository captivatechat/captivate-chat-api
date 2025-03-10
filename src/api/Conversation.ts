interface Action {
  id: string;
  data: any;
}

/**
 * Represents a conversation session, handling WebSocket communication and event management.
 */
export class Conversation {
  private conversationId: string;
  private socket: WebSocket;
  private listeners: Map<string, Function[]>;
  private metadata: object | null;
  private local_id: Number;
  /**
   * Initializes a new Conversation instance.
   * @param conversationId - The unique identifier of the conversation.
   * @param socket - The WebSocket instance for communication.
   */
  constructor(conversationId: string, socket: WebSocket, metadata?: object) {
    this.conversationId = conversationId;
    this.socket = socket;
    this.listeners = new Map();
    this.metadata = metadata || null; // If metadata is provided, use it; otherwise, set to null.
    this.local_id = Math.floor(Math.random() * 10000); // Simple random id for local instance tracking
    
    this.socket.onmessage = this.handleMessage.bind(this);

  }

  private handleMessage(event: MessageEvent) {
    console.log('local_id_onEvent', this.local_id);
    const message = JSON.parse(event.data);
    const eventType = message.event?.event_type;

    if (eventType && this.listeners.has(eventType)) {
      const payload = message.event.event_payload;
      this.listeners.get(eventType)?.forEach((callback) => callback(payload));
    }
  }
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
  * Sets metadata for the conversation and listens for success confirmation.
  * @param metadata - An object containing the metadata to set.
  * @returns A promise that resolves when the metadata update is successful.
  */
  public async setMetadata(metadata: object): Promise<void> {
    if (typeof metadata !== 'object' || metadata === null) {
      throw new Error('Metadata must be a non-null object.');
    }

    return new Promise((resolve, reject) => {
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

      // Send the metadata update request
      this.socket.send(JSON.stringify(metadataRequest));

      // Listener function for metadata update success
      const onMetadataSuccess = (payload: any) => {

        if (payload.conversation_id === this.conversationId) {
          this.removeListener('metadata_update_success', onMetadataSuccess);
          resolve(payload);
        }
      };

      // Add the success listener
      this.addListener('metadata_update_success', onMetadataSuccess);

      // Timeout for failure case
      setTimeout(() => {
        this.removeListener('metadata_update_success', onMetadataSuccess);
        reject(new Error('Timeout: No response for metadata update'));
      }, 15000);
    });
  }


  /**
   * Sends an action to the conversation.
   * @param actionId - The unique ID of the action to send.
   * @param data - Optional data associated with the action.
   * @returns A promise that resolves when the action is sent.
   */
  public async sendAction(actionId: string, data: object = {}): Promise<void> {
    return this.sendPayload('action', {
      type: 'normal',
      id: actionId,
      data,
      conversation_id: this.conversationId,
    });
  }

  /**
   * Requests the transcript of the conversation.
   * @returns A promise that resolves to the conversation transcript.
   */
  public async getTranscript(): Promise<object[]> {
    return new Promise((resolve, reject) => {
      const transcriptRequest = {
        action: 'sendMessage',
        event: {
          event_type: 'conversation_transcript_request',
          event_payload: {
            conversation_id: this.conversationId,
          },
        },
      };

      this.socket.send(JSON.stringify(transcriptRequest));

      const onMessage = (payload: any) => {
        if (payload.conversation_id === this.conversationId) {
          this.removeListener('conversation_transcript', onMessage);
          resolve(payload.transcript);
        }
      };
      console.log('local_id_onGetTranscript', this.local_id);
      this.addListener('conversation_transcript', onMessage);

      setTimeout(() => {
        this.removeListener('conversation_transcript', onMessage);
        reject(new Error('Timeout: No response for transcript request'));
      }, 10000);
    });
  }

  /**
 * Requests metadata for the conversation.
 * @returns A promise that resolves to the conversation metadata.
 */
  public async getMetadata(): Promise<object> {
    return new Promise((resolve, reject) => {
      const metadataRequest = {
        action: 'sendMessage',
        event: {
          event_type: 'metadata_request',
          event_payload: {
            conversation_id: this.conversationId,
          },
        },
      };
      this.socket.send(JSON.stringify(metadataRequest));

      const onMessage = (payload: any) => {

        if (payload.conversation_id === this.conversationId) {
          this.removeListener('conversation_metadata', onMessage);
          resolve(payload.content);
        }
      };

      this.addListener('conversation_metadata', onMessage);

      setTimeout(() => {
        this.removeListener('conversation_metadata', onMessage);
        reject(new Error('Timeout: No response for metadata request'));
      }, 10000);
    });
  }
  /**
    * Deletes this conversation.
    * @returns A promise that resolves when the conversation is deleted successfully.
    */
  public async delete(): Promise<void> {
    return new Promise((resolve, reject) => {

      try {
        const deleteRequest = {
          action: 'sendMessage',
          event: {
            event_type: 'delete_conversation',
            event_payload: { conversation_id: this.conversationId },
          },
        };
        this.socket.send(JSON.stringify(deleteRequest));

        const onDeleteSuccess = (event: MessageEvent) => {
          const message = JSON.parse(event.data);
          if (
            message.event?.event_type === 'delete_conversation_success' &&
            message.event.event_payload.conversation_id === this.conversationId
          ) {
            this.socket.removeEventListener('message', onDeleteSuccess);
            resolve();
          }
        };

        this.socket.addEventListener('message', onDeleteSuccess);

        setTimeout(() => {
          this.socket.removeEventListener('message', onDeleteSuccess);
          reject(new Error(`Timeout: No response for deleting conversation ${this.conversationId}`));
        }, 10000);
      } catch (error) {
        reject(error);
      }
    });
  }


  /**
   * Sends a payload to the WebSocket.
   * @param eventType - The type of event being sent.
   * @param payload - The payload data to include with the event.
   * @returns A promise that resolves when the payload is sent.
   */
  private async sendPayload(eventType: string, payload: object): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const message = {
          action: 'sendMessage',
          event: {
            event_type: eventType,
            event_payload: payload,
          },
        };
        this.socket.send(JSON.stringify(message));
        resolve();
      } catch (error) {
        reject(error);
      }
    });
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
   * Gets the unique identifier of the conversation.
   * @returns The conversation ID.
   */
  public getConversationId(): string {
    return this.conversationId;
  }
}
