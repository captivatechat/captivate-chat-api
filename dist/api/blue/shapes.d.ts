import { BlueSource } from './ndjson';
/** Blue keeps at most this many UTF-8 bytes of a conversation's metadata, as JSON (gaps G10). */
export declare const METADATA_MAX_BYTES = 4096;
/** Top-level metadata names never kept: held in memory and sent with each call instead (decision 6 (b)). */
export declare const UNKEPT: readonly ["user_id", "user_token"];
/** A page of the list at most, and its size when none is asked (gaps G13). */
export declare const LIST_PAGE_MAX = 50;
export declare function isRecord(value: unknown): value is Record<string, unknown>;
/** The metadata as given, less its top-level user_id and user_token: what Blue keeps. */
export declare function keptPart(metadata: Record<string, unknown>): Record<string, unknown>;
/** `sent` over `base` a top-level key at a time, a null removing one: the backend's merge for a PATCH (gaps G10). */
export declare function merged(base: Record<string, unknown>, sent: Record<string, unknown>): Record<string, unknown>;
/** Over 4 KB, counted as the backend counts: the UTF-8 bytes of its JSON. */
export declare function tooBig(metadata: Record<string, unknown>): boolean;
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
export declare function channelMetadataOf(copy: BlueCopy): Record<string, unknown>;
/**
 * getMetadata's answer in core's wrapper, channelMetadata where apps on 7.0 look for it (§0 rule
 * 5): Engage reads `metadata.event.event_payload.content.channelMetadata`, then
 * `metadata.channelMetadata`, then `channelMetadata` (useCaptivateChat.ts:1426-1436), and after a
 * reply `event.event_payload.content.channelMetadata` (:726).
 */
export declare function metadataWrapper(conversationId: string, copy: BlueCopy): Record<string, unknown>;
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
export declare function copyOfListed(item: ListedConversation): BlueCopy;
/** core's pagination, from the list's `{ total, page, pageSize }`. */
export interface CorePagination {
    hasNextPage: boolean;
    hasPrevPage: boolean;
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
}
export declare function paginationOf(total: number, page: number, pageSize: number): CorePagination;
/** core's `pagination: { page, limit }` as the list's query: page 1 and up, limit 1 to 50 (gaps G13). */
export declare function listQuery(pagination?: {
    page?: string | number;
    limit?: string | number;
}): {
    page: number;
    limit: number;
};
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
export declare function copyOfReadBack(back: ReadBack): BlueCopy;
/** A transcript entry in core's shape, with `from` and `createdAt` beside it, which Engage reads. */
export interface TranscriptEntry {
    message_id: string;
    /** "user" or "bot", as core's transcript's `from`. */
    sender: 'user' | 'bot';
    from: 'user' | 'bot';
    content: {
        type: 'text';
        text: string;
    }[];
    text: string;
    sources: BlueSource[];
    /** Unix milliseconds. */
    timestamp: number;
    createdAt: string;
    files?: {
        filename: string;
        type: string;
        size?: number;
        url?: string;
    }[];
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
export declare function transcriptOf(conversationId: string, back: ReadBack, greeting: BlueGreeting | null): TranscriptEntry[];
