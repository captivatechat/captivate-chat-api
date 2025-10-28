import { Conversation } from './Conversation';
export declare const captivateLogger: {
    log: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
};
export declare class CaptivateChatAPI {
    private apiKey;
    private mode;
    /**
     * WebSocket URL for real-time communication.
     */
    private url;
    /**
     * WebSocket connection for receiving real-time messages.
     */
    private socket;
    private conversations;
    /**
     * Socket ID received from socket_connected event.
     */
    private socketId;
    /**
     * WebSocket reconnection attempts counter.
     */
    private reconnectAttempts;
    /**
     * Maximum number of reconnection attempts.
     */
    private maxReconnectAttempts;
    /**
     * Delay between reconnection attempts.
     */
    private reconnectDelay;
    /**
     * Sets the debug mode for CaptivateChatAPI logging.
     * @param enabled - Whether to enable debug logging for CaptivateChatAPI.
     */
    static setDebugMode(enabled: boolean): void;
    /**
     * Gets the current debug mode state for CaptivateChatAPI.
     * @returns True if debug mode is enabled, false otherwise.
     */
    static getDebugMode(): boolean;
    /**
     * Creates an instance of CaptivateChatAPI.
     * @param apiKey - The API key for authentication.
     * @param mode - The mode of operation ('prod' for production or 'dev' for development).
     */
    constructor(apiKey: string, mode?: 'prod' | 'dev');
    /**
     * Sends a message via HTTP API.
     * @param message - The message object to send.
     * @returns A promise that resolves to the response data.
     */
    private _send;
    /**
     * Connects to the WebSocket server for real-time communication.
     * @returns A promise that resolves once the connection is successfully established.
     */
    connect(): Promise<void>;
    /**
     * Creates a new conversation or starts a bot-first/user-first conversation.
     * @param userId - The unique identifier for the user.
     * @param userBasicInfo - Basic information about the user (e.g., name, email).
     * @param userData - Additional optional user data.
     * @param autoConversationStart - Mode to auto-start the conversation ('bot-first' or 'user-first').
     * @returns A promise that resolves to the created Conversation instance.
     */
    createConversation(userId: string, userBasicInfo?: object, metadata?: Record<string, any>, autoConversationStart?: 'bot-first' | 'user-first', privateMetadata?: object): Promise<Conversation>;
    /**
     * Retrieves an existing conversation by its ID or creates a new one if not found.
     * @param conversationId - The unique ID of the conversation.
     * @returns The Conversation instance associated with the given ID.
     */
    getConversation(conversationId: string): Conversation | void;
    /**
     * Retrieves user conversations. Uses v2 if filter, search, or pagination is provided, otherwise uses v1.
     * Supports both legacy API (userId string) and new API (options object) for backward compatibility.
     * @param userIdOrOptions - Either a userId string (legacy) or options object containing userId and optional filter, search, and pagination.
     * @returns A promise resolving to an object with a list of Conversation instances and optional pagination data.
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
     * @param userId - The unique identifier for the user whose conversations will be deleted.
     * @param options - Delete options object with softDelete property.
     * @param options.softDelete - Whether to perform a soft delete (true) or hard delete (false). Defaults to true.
     * @returns A promise that resolves when all conversations are successfully deleted.
     */
    deleteUserConversations(userId: string, options?: {
        softDelete?: boolean;
    }): Promise<void>;
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
     * @returns True if the socket is open, false otherwise.
     */
    isSocketActive(): boolean;
    /**
     * Attempts to reconnect to the WebSocket server for real-time communication.
     * @returns A promise that resolves when reconnection is successful.
     */
    reconnect(): Promise<void>;
    /**
     * Static factory method to create and connect a CaptivateChatAPI instance.
     * The returned instance is automatically guarded: all method calls will check socket state and auto-reconnect if needed.
     * @param apiKey - The API key for authentication.
     * @param mode - The mode of operation ('prod' or 'dev').
     * @returns A promise that resolves to a connected and guarded CaptivateChatAPI instance.
     */
    static create(apiKey: string, mode?: 'prod' | 'dev'): Promise<CaptivateChatAPI>;
}
