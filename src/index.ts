import { CaptivateChatAPI } from './api/CaptivateChatAPI';
import { CaptivateChatManager } from './api/CaptivateChatManager';
import { CaptivateChatFileManager, TtlDays } from './api/CaptivateChatFileManager';



// Attach to window for browser global usage
if (typeof window !== 'undefined') {
  // @ts-ignore
  window.CaptivateChatAPI = CaptivateChatAPI;
  // @ts-ignore
  window.CaptivateChatManager = CaptivateChatManager;
  // @ts-ignore
  window.CaptivateChatFileManager = CaptivateChatFileManager;
}

export type { TtlDays };
export { CaptivateChatAPI, CaptivateChatManager, CaptivateChatFileManager };