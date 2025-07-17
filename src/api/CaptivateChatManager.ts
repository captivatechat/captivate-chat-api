import { CaptivateChatAPI } from './CaptivateChatAPI';
import { Conversation } from './Conversation';

type ApiKey = string;

export class CaptivateChatManager {
  private apiInstances: { [apiKey: string]: CaptivateChatAPI } = {};

  constructor(apiKeys: ApiKey[], mode: 'prod' | 'dev' = 'prod') {
    for (const key of apiKeys) {
      this.apiInstances[key] = new CaptivateChatAPI(key, mode);
    }
  }

  // Connect all API instances
  async connectAll(): Promise<void> {
    await Promise.all(
      Object.values(this.apiInstances).map(api => api.connect())
    );
  }

  // Unified getUserConversations supporting multi-api-key
  async getUserConversations(options: {
    userId: string;
    apiKeys?: string[];
    filter?: object;
    search?: object;
    pagination?: { page?: string | number; limit?: string | number };
  }): Promise<{ conversations: Conversation[]; pagination?: any }> {
    // Use the first API instance to make the merged request
    const apiKeys = options.apiKeys || Object.keys(this.apiInstances);
    const api = this.apiInstances[apiKeys[0]];
    // Always include apiKeys in the options passed to getUserConversations
    const { apiKeys: _apiKeys, ...rest } = options;
    const result = await api.getUserConversations({ ...rest, apiKeys });

    // Build Conversation objects with correct sockets
    const conversations = result.conversations.map((conv: any) => {
      const apiKey = conv.apiKey;
      const apiInstance = this.apiInstances[apiKey];
      if (!apiInstance) throw new Error(`No CaptivateChatAPI instance for apiKey: ${apiKey}`);
      if (!apiInstance.getSocket()) throw new Error(`WebSocket not initialized for apiKey: ${apiKey}`);
      // Re-create the Conversation with the correct socket if needed
      return new Conversation(conv.conversationId, apiInstance.getSocket()!, conv.metadata, apiKey);
    });

    return {
      conversations,
      pagination: result.pagination,
    };
  }

  // Optionally, expose access to individual API instances if needed
  getApiInstance(apiKey: string): CaptivateChatAPI | undefined {
    return this.apiInstances[apiKey];
  }
} 