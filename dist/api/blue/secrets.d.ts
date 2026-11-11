import { BlueTransport } from './transport';
/** The backend's rule for X-Blue-Conversation, with a 43-character floor: base64url only. */
export declare const SECRET_FORM: RegExp;
/** The conversations whose user is kept on the device; past it the oldest go. */
export declare const KEPT_CONVERSATIONS = 500;
/** Bytes as base64url, without padding. */
export declare function base64url(bytes: Uint8Array): string;
/** Text as UTF-8; by hand where TextEncoder is missing (Hermes), a lone surrogate as U+FFFD, as TextEncoder does. */
export declare function utf8Bytes(text: string): Uint8Array;
/**
 * SHA-256 (FIPS 180-4), synchronous and in plain JavaScript: crypto.subtle is async, missing in
 * React Native and, in browsers, on pages that aren't secure.
 */
export declare function sha256(data: Uint8Array): Uint8Array;
/** The part of a storage name that stands for a user: base64url(sha256(userId)). */
export declare function userHash(userId: string): string;
/** A user named on this instance: their ID and secret, in memory. */
interface KnownUser {
    userId: string;
    secret: string;
}
/**
 * One instance's users: their secrets (memory first, then the device's storage), the user each
 * conversation belongs to, and the last user named. Every storage call goes through one queue, in
 * order, so a forgetUser() is done before a later call reads; a store that fails is left for memory.
 */
export declare class BlueUsers {
    private readonly transport;
    /** By user hash. */
    private readonly known;
    /** Conversation id to user hash, in memory. */
    private readonly owners;
    /** What a failed or missing store would have held. */
    private readonly memory;
    /** A device secret being made, so two calls at once make one. */
    private readonly making;
    private queue;
    /** How many times each user hash was forgotten: a lookup begun before a forget doesn't bring the user back. */
    private readonly forgotten;
    /** The last user a call named on this instance: a handle without a user of its own takes theirs. */
    lastUser: string | null;
    constructor(transport: BlueTransport);
    private get prefix();
    /** The store: options.storage, else localStorage, else none (memory). */
    private get store();
    /** Runs `step` after every storage call before it. */
    private inTurn;
    private read;
    private write;
    /** The user's secret: their own server's (options.userSecret), else the device's, made on first use when `make`. Null when there is none. */
    secretFor(userId: string, make: boolean): Promise<string | null>;
    private fromServer;
    /** The kept list of conversation id to user hash, oldest first. */
    private owned;
    /** Keeps each conversation's user: in memory, and on the device unless `keep` is false. */
    bind(conversationIds: string[], userId: string, keep?: boolean): Promise<void>;
    /** The user a conversation belongs to, known on this instance or kept on the device; null when neither knows. */
    userOf(conversationId: string): KnownUser | null;
    /** The secret of a conversation's user, from memory, then the device; null when nothing here knows it. */
    secretOfConversation(conversationId: string): Promise<string | null>;
    /** The conversations kept here for a user, in memory. */
    conversationsOf(userId: string): string[];
    /** forgetUser: the user's secret and their conversations' users, in memory and on the device. */
    forget(userId: string): Promise<void>;
}
export {};
