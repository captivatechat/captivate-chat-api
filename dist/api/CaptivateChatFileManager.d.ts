/**
 * File manager for handling file uploads, storage, and presigned URL generation.
 * Supports direct file uploads with automatic text extraction and storage management.
 */
export declare class CaptivateChatFileManager {
    private static readonly FILE_TO_TEXT_API_URL;
    private static readonly PRESIGNED_URL_API_URL;
    private static readonly PATH_TTL_API_URL;
    readonly type: 'files';
    readonly files: Array<{
        filename: string;
        type: string;
        file?: File | Blob;
        url?: string;
        storage?: {
            fileKey: string;
            presignedUrl: string;
            expiresIn: number;
            fileSize: number;
            processingTime: number;
        };
        textContent: {
            type: 'file_content';
            text: string;
            metadata: {
                source: 'file_attachment';
                originalFileName: string;
                storageType?: 'direct';
            };
        };
    }>;
    constructor(file: File | Blob, textContent: {
        type: 'file_content';
        text: string;
        metadata: {
            source: 'file_attachment';
            originalFileName: string;
            storageType?: 'direct';
        };
    }, type: string);
    /**
     * Factory method to create a CaptivateChatFileManager with automatic file-to-text conversion for direct file uploads.
     * @param options - Configuration options for the file input.
     * @param options.file - The file to convert.
     * @param options.fileName - Optional custom file name.
     * @param options.fileType - Optional custom file type.
     * @param options.storage - Whether to store the file for future reference (default: true).
     * @param options.url - URL to reference the file when storage is false (required when storage is false).
     * @param options.apiKey - Optional API key for constructing the path parameter.
     * @param options.conversationId - Optional conversation ID for constructing the path parameter.
     * @returns A promise that resolves to a CaptivateChatFileManager instance with converted text.
     */
    static create(options: {
        file: File | Blob;
        fileName?: string;
        fileType?: string;
        storage?: boolean;
        url?: string;
        apiKey?: string;
        conversationId?: string;
    }): Promise<CaptivateChatFileManager>;
    /**
     * Gets the first file from the files array for convenience.
     * @returns The first file object, or undefined if no files exist.
     */
    getFirstFile(): {
        filename: string;
        type: string;
        file?: File | Blob;
        url?: string;
        storage?: {
            fileKey: string;
            presignedUrl: string;
            expiresIn: number;
            fileSize: number;
            processingTime: number;
        };
        textContent: {
            type: "file_content";
            text: string;
            metadata: {
                source: "file_attachment";
                originalFileName: string;
                storageType?: "direct";
            };
        };
    };
    /**
     * Gets the filename of the first file.
     * @returns The filename, or undefined if no files exist.
     */
    getFilename(): string;
    /**
     * Gets the text content of the first file.
     * @returns The text content, or empty string if no files exist.
     */
    getTextContent(): string;
    /**
     * Gets the file type of the first file.
     * @returns The file type, or undefined if no files exist.
     */
    getFileType(): string;
    /**
     * Returns the files array directly for compatibility with the files property.
     * This allows using fileInputObj directly as the files value.
     * @returns The files array.
     */
    toFilesArray(): {
        filename: string;
        type: string;
        file?: File | Blob;
        url?: string;
        storage?: {
            fileKey: string;
            presignedUrl: string;
            expiresIn: number;
            fileSize: number;
            processingTime: number;
        };
        textContent: {
            type: "file_content";
            text: string;
            metadata: {
                source: "file_attachment";
                originalFileName: string;
                storageType?: "direct";
            };
        };
    }[];
    /**
     * Makes the class iterable so it can be used directly as an array.
     */
    [Symbol.iterator](): Generator<{
        filename: string;
        type: string;
        file?: File | Blob;
        url?: string;
        storage?: {
            fileKey: string;
            presignedUrl: string;
            expiresIn: number;
            fileSize: number;
            processingTime: number;
        };
        textContent: {
            type: "file_content";
            text: string;
            metadata: {
                source: "file_attachment";
                originalFileName: string;
                storageType?: "direct";
            };
        };
    }, void, unknown>;
    /**
     * Getter that returns the files array, allowing the class to be used directly as files.
     * This enables: files: fileInputObj instead of files: fileInputObj.files
     */
    get [Symbol.toStringTag](): string;
    /**
     * Returns the length of the files array for array-like behavior.
     */
    get length(): number;
    /**
     * Refreshes the secure URL for the first file (if it has storage information).
     * @param expiresIn - Expiration time in seconds (default: 7200 = 2 hours).
     * @returns A promise that resolves to the refreshed secure URL, or undefined if no storage info.
     */
    refreshSecureUrl(expiresIn?: number): Promise<string | undefined>;
    /**
     * Proxy handler to make the class behave like the files array.
     * This allows using fileInputObj directly as files: fileInputObj
     */
    static createProxy(instance: CaptivateChatFileManager): CaptivateChatFileManager;
    /**
     * Factory method to create a single file object with automatic file-to-text conversion.
     * Returns just the file object instead of the full CaptivateChatFileManager wrapper.
     * @param options - Configuration options for the file input.
     * @param options.file - The file to convert.
     * @param options.fileName - Optional custom file name.
     * @param options.fileType - Optional custom file type.
     * @param options.storage - Whether to store the file for future reference (default: true).
     * @param options.url - URL to reference the file when storage is false (required when storage is false).
     * @returns A promise that resolves to a single file object.
     */
    static createFile(options: {
        file: File | Blob;
        fileName?: string;
        fileType?: string;
        storage?: boolean;
        url?: string;
        apiKey?: string;
        conversationId?: string;
    }): Promise<{
        filename: string;
        type: string;
        file?: File | Blob;
        textContent: {
            type: 'file_content';
            text: string;
            metadata: {
                source: 'file_attachment';
                originalFileName: string;
                storageType?: 'direct';
            };
        };
    }>;
    /**
     * Factory method to create multiple file inputs from an array of files.
     * Processes all files in parallel and returns a single CaptivateChatFileManager with all files.
     * @param options - Configuration options for all files.
     * @param options.files - Array of files to process.
     * @param options.storage - Whether to store the files for future reference (default: true).
     * @param options.urls - Array of URLs to reference files when storage is false (required when storage is false).
     * @returns A promise that resolves to a CaptivateChatFileManager instance with all processed files.
     */
    static createMultiple(options: {
        files: (File | Blob)[];
        storage?: boolean;
        urls?: string[];
        apiKey?: string;
        conversationId?: string;
    }): Promise<CaptivateChatFileManager>;
    /**
     * Generates a secure URL for accessing a stored file.
     * @param fileKey - The file key from the storage response.
     * @param expiresIn - Expiration time in seconds (default: 7200 = 2 hours).
     * @returns A promise that resolves to the secure URL.
     */
    static getSecureFileUrl(fileKey: string, expiresIn?: number): Promise<string>;
    /**
     * Sets the time-to-live (TTL) for a conversation path.
     * @param apiKey - The API key for authentication.
     * @param conversationId - The conversation ID.
     * @param days - The number of days for the time-to-live.
     * @returns A promise that resolves when the TTL is set successfully.
     */
    static setTimeToLive(apiKey: string, conversationId: string, days: number): Promise<void>;
    /**
     * Converts a file to text using the file-to-text API endpoint.
     * @param file - The file to convert (File or Blob).
     * @param fileName - The name of the file.
     * @param includeMetadata - Whether to include additional metadata in the response.
     * @param storage - Whether to store the file for future reference.
     * @param apiKey - Optional API key for constructing the path parameter.
     * @param conversationId - Optional conversation ID for constructing the path parameter.
     * @returns A promise that resolves to the extracted text.
     */
    private static convertFileToText;
}
