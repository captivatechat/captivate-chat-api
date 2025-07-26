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

  /**
   * Static factory method to create and connect all CaptivateChatAPI instances.
   * All apiInstances are created using CaptivateChatAPI.create, so they are guarded and connected.
   * @param apiKeys - Array of API keys to create instances for.
   * @param mode - The mode of operation ('prod' or 'dev').
   * @returns A promise that resolves to a connected CaptivateChatManager instance with guarded APIs.
   */
  static async create(apiKeys: ApiKey[], mode: 'prod' | 'dev' = 'prod'): Promise<CaptivateChatManager> {
    const manager = Object.create(CaptivateChatManager.prototype) as CaptivateChatManager;
    manager.apiInstances = {};
    for (const key of apiKeys) {
      manager.apiInstances[key] = await CaptivateChatAPI.create(key, mode);
    }
    return manager;
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