/**
 * Represents a file attachment with both file data and extracted text content.
 * Supports both direct file uploads and external storage URLs (like S3).
 */
export declare class CaptivateChatFileInput {
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
