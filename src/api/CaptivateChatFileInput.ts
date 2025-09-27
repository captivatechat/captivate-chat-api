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

      // Create and return the instance with proxy for array-like behavior
      const instance = new CaptivateChatFileInput(file, {
        type: 'file_content',
        text: extractedText,
        metadata: {
          source: 'file_attachment',
          originalFileName: finalFileName,
          storageType: 'direct'
        }
      }, finalType);
      
      return CaptivateChatFileInput.createProxy(instance);
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

      // Create and return the instance with proxy for array-like behavior
      const instance = new CaptivateChatFileInput(urlOptions.url, {
        type: 'file_content',
        text: extractedText,
        metadata: {
          source: 'file_attachment',
          originalFileName: urlOptions.fileName,
          storageType: 'external'
        }
      }, urlOptions.fileType);
      
      return CaptivateChatFileInput.createProxy(instance);
    }
  }

  /**
   * Gets the first file from the files array for convenience.
   * @returns The first file object, or undefined if no files exist.
   */
  getFirstFile() {
    return this.files[0];
  }

  /**
   * Gets the filename of the first file.
   * @returns The filename, or undefined if no files exist.
   */
  getFilename() {
    return this.files[0]?.filename;
  }

  /**
   * Gets the text content of the first file.
   * @returns The text content, or empty string if no files exist.
   */
  getTextContent() {
    return this.files[0]?.textContent?.text || '';
  }

  /**
   * Gets the file type of the first file.
   * @returns The file type, or undefined if no files exist.
   */
  getFileType() {
    return this.files[0]?.type;
  }

  /**
   * Returns the files array directly for compatibility with the files property.
   * This allows using fileInputObj directly as the files value.
   * @returns The files array.
   */
  toFilesArray() {
    return this.files;
  }

  /**
   * Makes the class iterable so it can be used directly as an array.
   */
  *[Symbol.iterator]() {
    yield* this.files;
  }

  /**
   * Getter that returns the files array, allowing the class to be used directly as files.
   * This enables: files: fileInputObj instead of files: fileInputObj.files
   */
  get [Symbol.toStringTag]() {
    return 'Array';
  }

  /**
   * Returns the length of the files array for array-like behavior.
   */
  get length() {
    return this.files.length;
  }

  /**
   * Proxy handler to make the class behave like the files array.
   * This allows using fileInputObj directly as files: fileInputObj
   */
  static createProxy(instance: CaptivateChatFileInput) {
    return new Proxy(instance, {
      get(target, prop) {
        // If accessing the files array directly, return the files
        if (prop === Symbol.iterator || prop === 'length' || typeof prop === 'number') {
          return target.files[prop as any];
        }
        // Otherwise, return the property from the instance
        return (target as any)[prop];
      }
    });
  }

  /**
   * Factory method to create a single file object with automatic file-to-text conversion.
   * Returns just the file object instead of the full CaptivateChatFileInput wrapper.
   * @param file - The file to convert.
   * @param options - Configuration options for the file input.
   * @returns A promise that resolves to a single file object.
   */
  static async createFile(
    file: File | Blob,
    options?: {
      fileName?: string;
      fileType?: string;
      includeMetadata?: boolean;
    }
  ): Promise<{
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
  static async createFile(
    options: {
      fileName: string;
      fileType: string;
      includeMetadata?: boolean;
      url: string;
    }
  ): Promise<{
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
   * Implementation of the createFile factory method.
   */
  static async createFile(
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
  ): Promise<{
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
  }> {
    const fileInput = await CaptivateChatFileInput.create(fileOrOptions as any, options);
    return fileInput.getFirstFile()!;
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
