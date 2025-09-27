/**
 * Represents a file attachment with both file data and extracted text content.
 * Supports both direct file uploads and external storage URLs (like S3).
 */
export declare class CaptivateChatFileInput {
    private static readonly FILE_TO_TEXT_API_URL;
    readonly type: 'files';
    readonly files: Array<{
        filename: string;
        type: string;
        file?: File | Blob;
        url?: string;
        textContent: {
            type: 'file_content';
            text: string;
            metadata: {
                source: 'file_attachment';
                originalFileName: string;
                storageType?: 'direct' | 'external';
            };
        };
    }>;
    constructor(fileOrUrl: File | Blob | string, textContent: {
        type: 'file_content';
        text: string;
        metadata: {
            source: 'file_attachment';
            originalFileName: string;
            storageType?: 'direct' | 'external';
        };
    }, type: string);
    /**
     * Factory method to create a CaptivateChatFileInput with automatic file-to-text conversion for direct file uploads.
     * @param file - The file to convert.
     * @param options - Configuration options for the file input.
     * @returns A promise that resolves to a CaptivateChatFileInput instance with converted text.
     */
    static create(file: File | Blob, options?: {
        fileName?: string;
        fileType?: string;
        includeMetadata?: boolean;
    }): Promise<CaptivateChatFileInput>;
    /**
     * Factory method to create a CaptivateChatFileInput with automatic file-to-text conversion for external storage URLs.
     * @param options - Configuration options for the file input (must include url).
     * @returns A promise that resolves to a CaptivateChatFileInput instance with converted text.
     */
    static create(options: {
        fileName: string;
        fileType: string;
        includeMetadata?: boolean;
        url: string;
    }): Promise<CaptivateChatFileInput>;
    /**
     * Gets the first file from the files array for convenience.
     * @returns The first file object, or undefined if no files exist.
     */
    getFirstFile(): {
        filename: string;
        type: string;
        file?: File | Blob;
        url?: string;
        textContent: {
            type: "file_content";
            text: string;
            metadata: {
                source: "file_attachment";
                originalFileName: string;
                storageType?: "direct" | "external";
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
        textContent: {
            type: "file_content";
            text: string;
            metadata: {
                source: "file_attachment";
                originalFileName: string;
                storageType?: "direct" | "external";
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
        textContent: {
            type: "file_content";
            text: string;
            metadata: {
                source: "file_attachment";
                originalFileName: string;
                storageType?: "direct" | "external";
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
     * Proxy handler to make the class behave like the files array.
     * This allows using fileInputObj directly as files: fileInputObj
     */
    static createProxy(instance: CaptivateChatFileInput): CaptivateChatFileInput;
    /**
     * Factory method to create a single file object with automatic file-to-text conversion.
     * Returns just the file object instead of the full CaptivateChatFileInput wrapper.
     * @param file - The file to convert.
     * @param options - Configuration options for the file input.
     * @returns A promise that resolves to a single file object.
     */
    static createFile(file: File | Blob, options?: {
        fileName?: string;
        fileType?: string;
        includeMetadata?: boolean;
    }): Promise<{
        filename: string;
        type: string;
        file?: File | Blob;
        url?: string;
        textContent: {
            type: 'file_content';
            text: string;
            metadata: {
                source: 'file_attachment';
                originalFileName: string;
                storageType?: 'direct' | 'external';
            };
        };
    }>;
    /**
     * Factory method to create a single file object with automatic file-to-text conversion for external URLs.
     * Returns just the file object instead of the full CaptivateChatFileInput wrapper.
     * @param options - Configuration options for the file input (must include url).
     * @returns A promise that resolves to a single file object.
     */
    static createFile(options: {
        fileName: string;
        fileType: string;
        includeMetadata?: boolean;
        url: string;
    }): Promise<{
        filename: string;
        type: string;
        file?: File | Blob;
        url?: string;
        textContent: {
            type: 'file_content';
            text: string;
            metadata: {
                source: 'file_attachment';
                originalFileName: string;
                storageType?: 'direct' | 'external';
            };
        };
    }>;
    /**
     * Converts a file to text using the file-to-text API endpoint.
     * @param file - The file to convert (File or Blob).
     * @param fileName - The name of the file.
     * @param includeMetadata - Whether to include additional metadata in the response.
     * @returns A promise that resolves to the extracted text.
     */
    private static convertFileToText;
    /**
     * Converts a URL to text using the file-to-text API endpoint.
     * @param url - The external storage URL to convert.
     * @param fileName - The name of the file.
     * @param includeMetadata - Whether to include additional metadata in the response.
     * @returns A promise that resolves to the extracted text.
     */
    private static convertUrlToText;
}
