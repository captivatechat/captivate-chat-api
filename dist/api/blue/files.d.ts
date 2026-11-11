import { CaptivateChatFileManager } from '../CaptivateChatFileManager';
import { BlueTransport } from './transport';
/** What a customer can send, as Blue's shared/published-chat/constants.ts lists them. */
export declare const FILE_EXTENSIONS: string[];
/** The biggest file, as the backend takes it. */
export declare const FILE_MAX_BYTES: number;
/** Files with one message. */
export declare const FILES_PER_MESSAGE = 5;
/** A file's place, kept on its file object for the message that sends it. */
export interface BlueUpload {
    uploadId: string;
    expiresAt: string;
}
/** What conversation.fileManager's calls take, as core's do. */
export interface BlueFileInput {
    file: Blob;
    fileName?: string;
    fileType?: string;
    /** Core's `false` (a file referenced by its URL) is refused. */
    storage?: boolean;
    url?: string;
}
/** conversation.fileManager in Blue mode: core's three calls, returning core's types. */
export declare function blueFileManager(transport: BlueTransport, conversationId: string, secret: () => Promise<string>): {
    create(options: BlueFileInput): Promise<CaptivateChatFileManager>;
    createFile(options: BlueFileInput): Promise<CaptivateChatFileManager['files'][number]>;
    createMultiple(options: {
        files: Blob[];
        storage?: boolean;
        urls?: string[];
    }): Promise<CaptivateChatFileManager>;
};
/**
 * A message's `attachments`, from what core's apps pass as `files`: a file manager, its `files`,
 * an array of either, or one file object. A file without a place from conversation.fileManager is
 * refused before sending, and so are more than 5.
 */
export declare function attachmentsOf(files: unknown): {
    uploadId: string;
}[];
