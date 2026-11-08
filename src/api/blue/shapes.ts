// Blue's answers in core's shapes (first-channels-library-spec §2.2): the list's items and pages,
// the metadata wrapper apps on 7.0 read, and the transcript, so an app reads Blue mode's
// conversations where it reads core's. The metadata kept with a conversation is the app's own
// (decision 6 (b)): at most 4 KB, never its user_id or user_token.
import { BlueSource, utf8Length } from './ndjson';

/** Blue keeps at most this many UTF-8 bytes of a conversation's metadata, as JSON (gaps G10). */
export const METADATA_MAX_BYTES = 4096;
/** Top-level metadata names never kept: held in memory and sent with each call instead (decision 6 (b)). */
export const UNKEPT = ['user_id', 'user_token'] as const;
/** A page of the list at most, and its size when none is asked (gaps G13). */
export const LIST_PAGE_MAX = 50;
/** A listed conversation's last message, as the backend cuts it. */
const LAST_MESSAGE_CHARS = 120;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The metadata as given, less its top-level user_id and user_token: what Blue keeps. */
export function keptPart(metadata: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(metadata)) {
    if (!(UNKEPT as readonly string[]).includes(name)) kept[name] = value;
  }
  return kept;
}

/** `sent` over `base` a top-level key at a time, a null removing one: the backend's merge for a PATCH (gaps G10). */
export function merged(base: Record<string, unknown>, sent: Record<string, unknown>): Record<string, unknown> {
  const out = new Map(Object.entries(base));
  for (const [name, value] of Object.entries(sent)) {
    if (value === null) out.delete(name);
    else out.set(name, value);
  }
  return Object.fromEntries(out);
}

/** Over 4 KB, counted as the backend counts: the UTF-8 bytes of its JSON. */
export function tooBig(metadata: Record<string, unknown>): boolean {
  return utf8Length(JSON.stringify(metadata)) > METADATA_MAX_BYTES;
}

/** What a handle knows of its conversation, for its metadata (getMetadata, and its runtime `metadata`). */
export interface BlueCopy {
  /** The metadata Blue keeps. */
  kept: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  lastMessage?: string;
  preview?: string;
}

/** core's channelMetadata: the dates, the last message and the kept metadata as `custom`. */
export function channelMetadataOf(copy: BlueCopy): Record<string, unknown> {
  return {
    ...(copy.createdAt !== undefined ? { conversationCreatedAt: copy.createdAt } : {}),
    ...(copy.updatedAt !== undefined ? { conversationUpdatedAt: copy.updatedAt } : {}),
    ...(copy.lastMessage !== undefined ? { lastChatMessage: copy.lastMessage } : {}),
    ...(copy.preview !== undefined ? { preview: copy.preview } : {}),
    custom: copy.kept,
  };
}

/**
 * getMetadata's answer in core's wrapper, channelMetadata where apps on 7.0 look for it (§0 rule
 * 5): Engage reads `metadata.event.event_payload.content.channelMetadata`, then
 * `metadata.channelMetadata`, then `channelMetadata` (useCaptivateChat.ts:1426-1436), and after a
 * reply `event.event_payload.content.channelMetadata` (:726).
 */
export function metadataWrapper(conversationId: string, copy: BlueCopy): Record<string, unknown> {
  const channelMetadata = channelMetadataOf(copy);
  const event = {
    event_type: 'metadata',
    event_payload: { conversation_id: conversationId, content: { conversation_id: conversationId, channelMetadata } },
  };
  return {
    conversationId,
    action: 'receiveMessage',
    event,
    channelMetadata,
    metadata: { action: 'receiveMessage', event, channelMetadata },
  };
}

/** One item of GET /v1/chat/conversations. */
export interface ListedConversation {
  conversationId: string;
  createdAt?: string;
  updatedAt?: string;
  preview?: string;
  lastMessage?: string;
  metadata?: Record<string, unknown>;
}

/** A listed item as a handle's copy. */
export function copyOfListed(item: ListedConversation): BlueCopy {
  return {
    kept: isRecord(item.metadata) ? item.metadata : {},
    ...(typeof item.createdAt === 'string' ? { createdAt: item.createdAt } : {}),
    ...(typeof item.updatedAt === 'string' ? { updatedAt: item.updatedAt } : {}),
    lastMessage: typeof item.lastMessage === 'string' ? item.lastMessage : '',
    ...(typeof item.preview === 'string' ? { preview: item.preview } : {}),
  };
}

/** core's pagination, from the list's `{ total, page, pageSize }`. */
export interface CorePagination {
  hasNextPage: boolean;
  hasPrevPage: boolean;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function paginationOf(total: number, page: number, pageSize: number): CorePagination {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  return { hasNextPage: page < totalPages, hasPrevPage: page > 1, page, pageSize, total, totalPages };
}

/** core's `pagination: { page, limit }` as the list's query: page 1 and up, limit 1 to 50 (gaps G13). */
export function listQuery(pagination: { page?: string | number; limit?: string | number } = {}): { page: number; limit: number } {
  const page = Math.floor(Number(pagination.page));
  const limit = Math.floor(Number(pagination.limit));
  return {
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    limit: Number.isFinite(limit) && limit >= 1 ? Math.min(limit, LIST_PAGE_MAX) : LIST_PAGE_MAX,
  };
}

/** A message of the read-back (GET /v1/chat/:id), the parts read here: Blue's ChatReadBackMessage. */
export interface ReadBackMessage {
  _id?: string;
  role?: string;
  content?: unknown;
  sources?: unknown;
  attachments?: unknown;
  at?: string;
  stopped?: boolean;
}

/** The read-back, the parts read here: Blue's ChatReadBack. */
export interface ReadBack {
  createdAt?: string;
  updatedAt?: string;
  answering?: boolean;
  messages?: ReadBackMessage[];
  metadata?: Record<string, unknown>;
  details?: string[];
}

/** A read-back as a handle's copy: the last message as the list gives it (its words, or a files-only one's names). */
export function copyOfReadBack(back: ReadBack): BlueCopy {
  const messages = Array.isArray(back.messages) ? back.messages : [];
  const last = messages[messages.length - 1];
  const names = last && Array.isArray(last.attachments) ? last.attachments.map((a: any) => a?.name).filter((n) => typeof n === 'string') : [];
  const words = last ? (typeof last.content === 'string' && last.content) || names.join(', ') : '';
  return {
    kept: isRecord(back.metadata) ? back.metadata : {},
    ...(typeof back.createdAt === 'string' ? { createdAt: back.createdAt } : {}),
    ...(typeof back.updatedAt === 'string' ? { updatedAt: back.updatedAt } : {}),
    lastMessage: Array.from(words).slice(0, LAST_MESSAGE_CHARS).join(''),
  };
}

/** A transcript entry in core's shape, with `from` and `createdAt` beside it, which Engage reads. */
export interface TranscriptEntry {
  message_id: string;
  /** "user" or "bot", as core's transcript's `from`. */
  sender: 'user' | 'bot';
  from: 'user' | 'bot';
  content: { type: 'text'; text: string }[];
  text: string;
  sources: BlueSource[];
  /** Unix milliseconds. */
  timestamp: number;
  createdAt: string;
  files?: { filename: string; type: string; size?: number; url?: string }[];
  stopped?: true;
}

/** The bot-first greeting, never stored: first in the transcript until the conversation's first message. */
export interface BlueGreeting {
  text: string;
  starters: string[];
  /** When the handle got it. */
  at: string;
}

/** getTranscript's answer: the read-back's messages in core's shape, the greeting first while there are none. */
export function transcriptOf(conversationId: string, back: ReadBack, greeting: BlueGreeting | null): TranscriptEntry[] {
  const messages = Array.isArray(back.messages) ? back.messages : [];
  if (messages.length === 0) {
    if (!greeting || !greeting.text) return [];
    return [entryOf({ _id: `greeting-${conversationId}`, role: 'assistant', content: greeting.text, at: greeting.at })];
  }
  return messages.map(entryOf);
}

function entryOf(message: ReadBackMessage): TranscriptEntry {
  const text = typeof message.content === 'string' ? message.content : '';
  const sender = message.role === 'user' ? 'user' : 'bot';
  const at = typeof message.at === 'string' ? message.at : '';
  const parsed = Date.parse(at);
  const files = Array.isArray(message.attachments)
    ? message.attachments
        .filter((a: any) => isRecord(a) && typeof a.name === 'string')
        .map((a: any) => ({
          filename: a.name as string,
          type: typeof a.type === 'string' ? a.type : '',
          ...(typeof a.size === 'number' ? { size: a.size } : {}),
          ...(typeof a.url === 'string' ? { url: a.url } : {}),
        }))
    : [];
  return {
    message_id: typeof message._id === 'string' ? message._id : '',
    sender,
    from: sender,
    content: [{ type: 'text', text }],
    text,
    sources: Array.isArray(message.sources) ? (message.sources as BlueSource[]) : [],
    timestamp: Number.isNaN(parsed) ? 0 : parsed,
    createdAt: at,
    ...(files.length ? { files } : {}),
    ...(message.stopped === true ? { stopped: true as const } : {}),
  };
}
