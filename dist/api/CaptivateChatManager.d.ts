import { CaptivateChatAPI } from './CaptivateChatAPI';
import { Conversation } from './Conversation';
type ApiKey = string;
export declare class CaptivateChatManager {
    private apiInstances;
    constructor(apiKeys: ApiKey[], mode?: 'prod' | 'dev');
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
