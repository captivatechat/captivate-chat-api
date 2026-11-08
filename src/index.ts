import { CaptivateChatAPI } from './api/CaptivateChatAPI';
import { CaptivateChatManager } from './api/CaptivateChatManager';
import { CaptivateChatFileManager, TtlDays } from './api/CaptivateChatFileManager';
import { isBlueKey } from './api/blue/keys';
import { renumber } from './api/blue/citations';
import type { BlueAnswer } from './api/blue/answer';
import type { BlueSource } from './api/blue/ndjson';



// Attach to window for browser global usage
if (typeof window !== 'undefined') {
  // @ts-ignore
  window.CaptivateChatAPI = CaptivateChatAPI;
  // @ts-ignore
  window.CaptivateChatManager = CaptivateChatManager;
  // @ts-ignore
  window.CaptivateChatFileManager = CaptivateChatFileManager;
}

export type { TtlDays, BlueAnswer, BlueSource };
export { CaptivateChatAPI, CaptivateChatManager, CaptivateChatFileManager, isBlueKey, renumber };