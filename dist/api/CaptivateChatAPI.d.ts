import { Conversation } from './Conversation';
/**
 * CaptivateChatAPI class for managing conversations through WebSocket connections.
 */
export declare class CaptivateChatAPI {
    private apiKey;
    private mode;
    private url;
    private socket;
    private conversations;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private reconnectDelay;
    /**
     * Creates an instance of CaptivateChatAPI.
     * @param apiKey - The API key for authentication.
     * @param mode - The mode of operation ('prod' for production or 'dev' for development).
     */
    constructor(apiKey: string, mode?: 'prod' | 'dev');
    /**
     * Sends a message through the WebSocket connection.
     * @param message - The message object to send.
     */
    private _send;
    /**
     * Connects to the WebSocket server and waits for confirmation from the API.
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
     * Deletes all conversations for a specific user.
     * @param userId - The unique identifier for the user whose conversations will be deleted.
     * @returns A promise that resolves when all conversations are successfully deleted.
     */
    deleteUserConversations(userId: string): Promise<void>;
    /**
     * Public getter for the WebSocket instance.
     */
    getSocket(): WebSocket | null;
    /**
     * Checks if the WebSocket connection is active and open.
     * @returns True if the socket is open, false otherwise.
     */
    isSocketActive(): boolean;
    /**
     * Attempts to reconnect to the WebSocket server.
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
