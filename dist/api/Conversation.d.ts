import { EndpointConfig } from './CaptivateChatAPI';
interface Action {
    id: string;
    data: any;
}
/**
 * Represents a conversation session, handling HTTP communication for sending and WebSocket for receiving.
 * Client-side sending uses HTTP, while server-side real-time communication uses WebSocket listeners.
 */
export declare class Conversation {
    apiKey: string;
    private conversationId;
    /**
     * WebSocket connection for receiving real-time messages from server.
     */
    private socket;
    /**
     * Event listeners for real-time WebSocket communication.
     */
    private listeners;
    private mode;
    /**
     * Custom endpoint configuration.
     */
    private endpoints;
    /**
     * Socket ID for HTTP requests.
     */
    private socketId;
    /**
     * Initializes a new Conversation instance.
     * @param conversationId - The unique identifier of the conversation.
     * @param socket - WebSocket instance for receiving real-time messages.
     * @param metadata - Optional metadata for the conversation.
     * @param apiKey - API key for HTTP communication (required).
     * @param mode - The mode of operation ('prod' or 'dev').
     * @param socketId - Socket ID for HTTP requests.
     * @param endpoints - Optional custom endpoint configuration.
     */
    constructor(conversation_id: string, socket: WebSocket, metadata?: object, apiKey?: string, mode?: 'prod' | 'dev', socketId?: string | null, endpoints?: EndpointConfig);
    /**
     * Handles incoming WebSocket messages for real-time communication.
     * @param event - The WebSocket message event.
     */
    private handleMessage;
    /**
     * Restarts WebSocket listeners for real-time communication.
     */
    restartListeners(): void;
    /**
     * Adds an event listener for a specific event type.
     * @param eventType - The type of event to listen for.
     * @param callback - The function to invoke when the event occurs.
     */
    private addListener;
    /**
     * Registers a listener for messages from the bot or live chat.
     * @param callback - The function to handle incoming messages.
     */
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
     * Sends a message to the conversation.
     * @param content - The message content to send.
     * @returns A promise that resolves when the message is sent.
     */
    sendMessage(content: object | string): Promise<void>;
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
     * Sends a payload via HTTP API (primary method).
     * @param eventType - The type of event being sent.
     * @param payload - The payload data to include with the event.
     * @returns A promise that resolves to the response data.
     */
    private sendPayload;
    /**
     * Sends a payload via HTTP API (primary communication method).
     * @param message - The message to send via HTTP.
     * @returns A promise that resolves to the response data.
     */
    private sendPayloadViaHttp;
    /**
     * Removes a specific event listener.
     * @param eventType - The type of event.
     * @param callback - The callback function to remove.
     */
    private removeListener;
    /**
     * Gets the base URL for API requests based on custom endpoints or mode.
     * @returns The base URL for the API.
     */
    private getBaseUrl;
    /**
     * Gets the unique identifier of the conversation.
     * @returns The conversation ID.
     */
    getConversationId(): string;
}
export {};
