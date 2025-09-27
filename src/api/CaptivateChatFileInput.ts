/**
 * Represents a file attachment with both file data and extracted text content.
 * Supports both direct file uploads and external storage URLs (like S3).
 */
export class CaptivateChatFileInput {
  private static readonly FILE_TO_TEXT_API_URL = 'https://file-to-text.prod.captivat.io/api/file-to-text';
  
  public readonly type: 'files' = 'files';
  public readonly files: Array<{
    filename: string;
    type: string;
    file?: File | Blob; // For direct file uploads
    url?: string; // For external storage URLs (S3, etc.)
    textContent: {
      type: 'file_content';
      text: string;
      metadata: {
        source: 'file_attachment';
        originalFileName: string;
        storageType?: 'direct' | 'external'; // Indicates if file is direct or external URL
      };
    };
  }>;

  constructor(
    fileOrUrl: File | Blob | string,
    textContent: {
      type: 'file_content';
      text: string;
      metadata: {
        source: 'file_attachment';
        originalFileName: string;
        storageType?: 'direct' | 'external';
      };
    },
    type: string
  ) {
    // Process file information
    const finalFileName = textContent.metadata.originalFileName;
    const storageType = textContent.metadata.storageType || 'direct';

    // Set up files array based on storage type
    if (storageType === 'external' && typeof fileOrUrl === 'string') {
      // External storage URL (S3, etc.)
      this.files = [{
        filename: finalFileName,
        type: type,
        url: fileOrUrl,
        textContent: textContent
      }];
    } else if (storageType === 'direct' && (fileOrUrl instanceof File || fileOrUrl instanceof Blob)) {
      // Direct file upload
      this.files = [{
        filename: finalFileName,
        type: type,
        file: fileOrUrl,
        textContent: textContent
      }];
    } else {
      throw new Error('Invalid file or URL type for the specified storage type');
    }
  }

  /**
   * Factory method to create a CaptivateChatFileInput with automatic file-to-text conversion for direct file uploads.
   * @param file - The file to convert.
   * @param options - Configuration options for the file input.
   * @returns A promise that resolves to a CaptivateChatFileInput instance with converted text.
   */
  static async create(
    file: File | Blob,
    options?: {
      fileName?: string;
      fileType?: string;
      includeMetadata?: boolean;
    }
  ): Promise<CaptivateChatFileInput>;
  
  /**
   * Factory method to create a CaptivateChatFileInput with automatic file-to-text conversion for external storage URLs.
   * @param options - Configuration options for the file input (must include url).
   * @returns A promise that resolves to a CaptivateChatFileInput instance with converted text.
   */
  static async create(
    options: {
      fileName: string;
      fileType: string;
      includeMetadata?: boolean;
      url: string; // External storage URL (S3, etc.)
    }
  ): Promise<CaptivateChatFileInput>;
  
  /**
   * Implementation of the factory method.
   */
  static async create(
    fileOrOptions: File | Blob | {
      fileName?: string;
      fileType?: string;
      includeMetadata?: boolean;
      url?: string;
    },
    options?: {
      fileName?: string;
      fileType?: string;
      includeMetadata?: boolean;
    }
  ): Promise<CaptivateChatFileInput> {
    // Determine if this is a file upload or URL-based call
    const isFileUpload = fileOrOptions instanceof File || fileOrOptions instanceof Blob;
    
    if (isFileUpload) {
      // Direct file upload
      const file = fileOrOptions as File | Blob;
      const finalFileName = options?.fileName || (file instanceof File ? file.name : `attachment_${Date.now()}`);
      const finalType = options?.fileType || (file instanceof File ? file.type : file.type || 'application/octet-stream');

      // Convert file to text
      const extractedText = await CaptivateChatFileInput.convertFileToText(
        file, 
        finalFileName, 
        options?.includeMetadata || false
      );

      // Create and return the instance
      return new CaptivateChatFileInput(file, {
        type: 'file_content',
        text: extractedText,
        metadata: {
          source: 'file_attachment',
          originalFileName: finalFileName,
          storageType: 'direct'
        }
      }, finalType);
    } else {
      // External storage URL
      const urlOptions = fileOrOptions as {
        fileName: string;
        fileType: string;
        includeMetadata?: boolean;
        url: string;
      };

      if (!urlOptions.fileName || !urlOptions.fileType || !urlOptions.url) {
        throw new Error('fileName, fileType, and url are required when using external URL');
      }

      // Convert URL to text
      const extractedText = await CaptivateChatFileInput.convertUrlToText(
        urlOptions.url,
        urlOptions.fileName,
        urlOptions.includeMetadata || false
      );

      // Create and return the instance
      return new CaptivateChatFileInput(urlOptions.url, {
        type: 'file_content',
        text: extractedText,
        metadata: {
          source: 'file_attachment',
          originalFileName: urlOptions.fileName,
          storageType: 'external'
        }
      }, urlOptions.fileType);
    }
  }

  /**
   * Converts a file to text using the file-to-text API endpoint.
   * @param file - The file to convert (File or Blob).
   * @param fileName - The name of the file.
   * @param includeMetadata - Whether to include additional metadata in the response.
   * @returns A promise that resolves to the extracted text.
   */
  private static async convertFileToText(file: File | Blob, fileName: string, includeMetadata: boolean): Promise<string> {
    const url = CaptivateChatFileInput.FILE_TO_TEXT_API_URL;

    // Create FormData for multipart/form-data request
    const formData = new FormData();
    formData.append('file', file, fileName);
    formData.append('includeMetadata', includeMetadata.toString());

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`File conversion failed: ${response.status} ${response.statusText}. ${errorData.error || ''}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(`File conversion failed: ${data.error || 'Unknown error'}`);
      }

      return data.text || '';

    } catch (error: any) {
      if (error.message.includes('File conversion failed')) {
        throw error;
      }
      throw new Error(`Failed to convert file to text: ${error.message}`);
    }
  }

  /**
   * Converts a URL to text using the file-to-text API endpoint.
   * @param url - The external storage URL to convert.
   * @param fileName - The name of the file.
   * @param includeMetadata - Whether to include additional metadata in the response.
   * @returns A promise that resolves to the extracted text.
   */
  private static async convertUrlToText(url: string, fileName: string, includeMetadata: boolean): Promise<string> {
    const apiUrl = CaptivateChatFileInput.FILE_TO_TEXT_API_URL;

    // Create FormData for multipart/form-data request with URL
    const formData = new FormData();
    formData.append('url', url);
    formData.append('fileName', fileName);
    formData.append('includeMetadata', includeMetadata.toString());

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`File conversion failed: ${response.status} ${response.statusText}. ${errorData.error || ''}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(`File conversion failed: ${data.error || 'Unknown error'}`);
      }

      return data.text || '';

    } catch (error: any) {
      if (error.message.includes('File conversion failed')) {
        throw error;
      }
      throw new Error(`Failed to convert URL to text: ${error.message}`);
    }
  }
}
