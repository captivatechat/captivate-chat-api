import { CaptivateChatAPI } from './api/CaptivateChatAPI';
import { CaptivateChatManager } from './api/CaptivateChatManager';
import { CaptivateChatFileManager } from './api/CaptivateChatFileManager';



// Attach to window for browser global usage
if (typeof window !== 'undefined') {
  // @ts-ignore
  window.CaptivateChatAPI = CaptivateChatAPI;
  // @ts-ignore
  window.CaptivateChatManager = CaptivateChatManager;
  // @ts-ignore
  window.CaptivateChatFileManager = CaptivateChatFileManager;
}

export { CaptivateChatAPI, CaptivateChatManager, CaptivateChatFileManager };