import { CaptivateChatAPI, EndpointConfig } from './CaptivateChatAPI';
import { Conversation } from './Conversation';
type ApiKey = string;
export declare class CaptivateChatManager {
    private apiInstances;
    private endpoints?;
    constructor(apiKeys: ApiKey[], mode?: 'prod' | 'dev', endpoints?: EndpointConfig);
    /**
     * Static factory method to create and connect all CaptivateChatAPI instances.
     * All apiInstances are created using CaptivateChatAPI.create, so they are guarded and connected.
     * @param apiKeys - Array of API keys to create instances for.
     * @param mode - The mode of operation ('prod' or 'dev').
     * @param endpoints - Optional custom endpoint configuration.
     * @returns A promise that resolves to a connected CaptivateChatManager instance with guarded APIs.
     */
    static create(apiKeys: ApiKey[], mode?: 'prod' | 'dev', endpoints?: EndpointConfig): Promise<CaptivateChatManager>;
    /**
     * Sets the debug mode for all CaptivateChatAPI instances managed by this manager.
     * @param enabled - Whether to enable debug logging for all API instances.
     */
    static setDebugMode(enabled: boolean): void;
    /**
     * Gets the current debug mode state for CaptivateChatAPI instances.
     * @returns True if debug mode is enabled, false otherwise.
     */
    static getDebugMode(): boolean;
    connectAll(): Promise<void>;
    getUserConversations(options: {
        userId: string;
        apiKeys?: string[];
        filter?: object;
        search?: object;
        pagination?: {
            page?: string | number;
            limit?: string | number;
        };
    }): Promise<{
        conversations: Conversation[];
        pagination?: any;
    }>;
    getApiInstance(apiKey: string): CaptivateChatAPI | undefined;
}
export {};
