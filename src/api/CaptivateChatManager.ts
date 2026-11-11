import { CaptivateChatAPI, CaptivateChatAPIOptions, keyLabel } from './CaptivateChatAPI';
import { Conversation, takeListedDetails } from './Conversation';
import { hideFromJson, isBlueKey } from './blue/keys';
import { SETUP_WORDS } from './blue/words';

type ApiKey = string;

/** The manager merges several keys' lists on core's server, which knows no Blue key (first-channels-library-spec §2.2). */
function refuseBlueKeys(apiKeys: ApiKey[]): void {
  if (apiKeys.some((key) => isBlueKey(key))) throw new Error(SETUP_WORDS.managerBlueKey);
}

export class CaptivateChatManager {
  private apiInstances: { [apiKey: string]: CaptivateChatAPI } = {};

  constructor(apiKeys: ApiKey[], mode: 'prod' | 'dev' = 'prod', options: CaptivateChatAPIOptions = {}) {
    refuseBlueKeys(apiKeys);
    // Deduplicate API keys to prevent duplicate instances
    const uniqueKeys = [...new Set(apiKeys)];

    for (const key of uniqueKeys) {
      // Constructor now returns singleton automatically
      this.apiInstances[key] = new CaptivateChatAPI(key, mode, options);
    }
    // The instances are filed under their core keys: an app that logs the manager must not print them.
    hideFromJson(this, 'apiInstances');
  }

  /**
   * Static factory method to create and connect all CaptivateChatAPI instances.
   * All apiInstances are created using CaptivateChatAPI.create, so they are guarded and connected.
   * Automatically deduplicates API keys to prevent duplicate instances.
   */
  static async create(
    apiKeys: ApiKey[],
    mode: 'prod' | 'dev' = 'prod',
    options: CaptivateChatAPIOptions = {}
  ): Promise<CaptivateChatManager> {
    refuseBlueKeys(apiKeys);
    const uniqueKeys = [...new Set(apiKeys)];

    const manager = Object.create(CaptivateChatManager.prototype) as CaptivateChatManager;
    manager.apiInstances = {};
    for (const key of uniqueKeys) {
      manager.apiInstances[key] = await CaptivateChatAPI.create(key, mode, options);
    }
    hideFromJson(manager, 'apiInstances');
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
    if (!api) throw new Error('No CaptivateChatAPI instance available for the requested API keys');

    // What the first instance held before the list: it caches a handle for each conversation it
    // lists, those of other keys too, and only the strays are let go below.
    const heldBefore = new Set<string>((api as any).conversations?.keys?.() ?? []);

    const { apiKeys: _apiKeys, ...rest } = options;
    const result = await api.getUserConversations({ ...rest, apiKeys });

    // The previous implementation rebuilt every result with
    //   new Conversation(id, socket, metadata, apiKey)
    // dropping `mode` and `socketId`. That silently forced mode back to 'prod' (wrong
    // base URL on dev) and sent socket_id: null, so the server had nowhere to deliver
    // replies. Ask each owning instance for the conversation instead — it builds them
    // with a live socket provider and reuses cached handles.
    const conversations = result.conversations.map((conv: Conversation) => {
      const ownerKey = conv.apiKey || apiKeys[0];
      const apiInstance = this.apiInstances[ownerKey];
      // Named by keyLabel: an app's error report would otherwise carry the key itself.
      if (!apiInstance) throw new Error(`No CaptivateChatAPI instance for apiKey: ${keyLabel(ownerKey)}`);
      const id = conv.getConversationId();
      const handle = apiInstance.getConversation(id);
      // The owning instance's handle starts at {} or holds what it last knew: it takes the list's
      // metadata and its key, as the handle the list built for the first instance did.
      takeListedDetails(handle, (conv as any).metadata, ownerKey);
      // The first instance listed this one only to ask for it: it doesn't keep a handle it never held.
      if (apiInstance !== api && !heldBefore.has(id)) api.releaseConversation(id);
      return handle;
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

  /**
   * Disposes of a single API instance by its API key.
   */
  dispose(apiKey: string): void {
    const api = this.apiInstances[apiKey];
    if (api) {
      api.dispose();
      delete this.apiInstances[apiKey];
    }
  }

  /**
   * Disposes of all API instances managed by this manager.
   */
  disposeAll(): void {
    for (const api of Object.values(this.apiInstances)) {
      api.dispose();
    }
    this.apiInstances = {};
  }
}