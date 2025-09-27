import { CaptivateChatAPI } from './api/CaptivateChatAPI';
import { CaptivateChatManager } from './api/CaptivateChatManager';
import { CaptivateChatFileInput } from './api/CaptivateChatFileInput';



// Attach to window for browser global usage
if (typeof window !== 'undefined') {
  // @ts-ignore
  window.CaptivateChatAPI = CaptivateChatAPI;
  // @ts-ignore
  window.CaptivateChatManager = CaptivateChatManager;
  // @ts-ignore
  window.CaptivateChatFileInput = CaptivateChatFileInput;
}

export { CaptivateChatAPI, CaptivateChatManager, CaptivateChatFileInput };