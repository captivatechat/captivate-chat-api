import { CaptivateChatAPI, CaptivateChatAPIOptions } from './CaptivateChatAPI';
import { Conversation } from './Conversation';
type ApiKey = string;
export declare class CaptivateChatManager {
    private apiInstances;
    constructor(apiKeys: ApiKey[], mode?: 'prod' | 'dev', options?: CaptivateChatAPIOptions);
    /**
     * Static factory method to create and connect all CaptivateChatAPI instances.
     * All apiInstances are created using CaptivateChatAPI.create, so they are guarded and connected.
     * Automatically deduplicates API keys to prevent duplicate instances.
     */
    static create(apiKeys: ApiKey[], mode?: 'prod' | 'dev', options?: CaptivateChatAPIOptions): Promise<CaptivateChatManager>;
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
    /**
     * Disposes of a single API instance by its API key.
     */
    dispose(apiKey: string): void;
    /**
     * Disposes of all API instances managed by this manager.
     */
    disposeAll(): void;
}
export {};
