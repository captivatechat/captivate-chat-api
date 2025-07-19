import { CaptivateChatAPI } from './api/CaptivateChatAPI';
import { CaptivateChatManager } from './api/CaptivateChatManager';



// Attach to window for browser global usage
if (typeof window !== 'undefined') {
  // @ts-ignore
  window.CaptivateChatAPI = CaptivateChatAPI;
  // @ts-ignore
  window.CaptivateChatManager = CaptivateChatManager;
}

export { CaptivateChatAPI, CaptivateChatManager };