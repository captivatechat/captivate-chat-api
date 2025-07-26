import { CaptivateChatAPI } from './CaptivateChatAPI';
import { Conversation } from './Conversation';
type ApiKey = string;
export declare class CaptivateChatManager {
    private apiInstances;
    constructor(apiKeys: ApiKey[], mode?: 'prod' | 'dev');
    /**
     * Static factory method to create and connect all CaptivateChatAPI instances.
     * All apiInstances are created using CaptivateChatAPI.create, so they are guarded and connected.
     * @param apiKeys - Array of API keys to create instances for.
     * @param mode - The mode of operation ('prod' or 'dev').
     * @returns A promise that resolves to a connected CaptivateChatManager instance with guarded APIs.
     */
    static create(apiKeys: ApiKey[], mode?: 'prod' | 'dev'): Promise<CaptivateChatManager>;
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
