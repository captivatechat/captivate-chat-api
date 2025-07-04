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
    createConversation(userId: string, userBasicInfo?: object, metadata?: object, autoConversationStart?: 'bot-first' | 'user-first'): Promise<Conversation>;
    /**
     * Retrieves an existing conversation by its ID or creates a new one if not found.
     * @param conversationId - The unique ID of the conversation.
     * @returns The Conversation instance associated with the given ID.
     */
    getConversation(conversationId: string): Conversation | void;
    /**
     * Retrieves user conversations. Uses v2 if filter, search, or pagination is provided, otherwise uses v1.
     * @param options - Options object containing userId and optional filter, search, and pagination.
     * @returns A promise resolving to a list of Conversation instances.
     */
    getUserConversations(options: {
        userId: string;
        filter?: object;
        search?: object;
        pagination?: {
            page?: string | number;
            limit?: string | number;
        };
    }): Promise<Conversation[]>;
    /**
     * Deletes all conversations for a specific user.
     * @param userId - The unique identifier for the user whose conversations will be deleted.
     * @returns A promise that resolves when all conversations are successfully deleted.
     */
    deleteUserConversations(userId: string): Promise<void>;
}
