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
    createConversation(userId: string, userBasicInfo?: object, userData?: object, autoConversationStart?: 'bot-first' | 'user-first'): Promise<Conversation>;
    /**
     * Retrieves an existing conversation by its ID or creates a new one if not found.
     * @param conversationId - The unique ID of the conversation.
     * @returns The Conversation instance associated with the given ID.
     */
    getConversation(conversationId: string): Conversation;
    /**
    * Retrieves user conversations based on their userId.
    * @param userId - The unique identifier for the user.
    * @returns A promise resolving to the list of conversation ids.
    */
    getUserConversations(userId: string): Promise<object[]>;
}
