/**
 * File manager for handling file uploads, storage, and presigned URL generation.
 * Supports direct file uploads with automatic text extraction and storage management.
 */
export class CaptivateChatFileManager {
  private static readonly FILE_TO_TEXT_API_URL = 'https://file-to-text.prod.captivat.io/api/file-to-text';
  private static readonly PRESIGNED_URL_API_URL = 'https://file-to-text.prod.captivat.io/api/presigned-url';
  
  public readonly type: 'files' = 'files';
  public readonly files: Array<{
    filename: string;
    type: string;
    file?: File | Blob; // For direct file uploads
    url?: string; // For referencing files when storage is false
    storage?: {
      fileKey: string;
      presignedUrl: string;
      expiresIn: number;
      fileSize: number;
      processingTime: number;
    }; // Storage information when storage is true
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

  constructor(
    file: File | Blob,
    textContent: {
      type: 'file_content';
      text: string;
      metadata: {
        source: 'file_attachment';
        originalFileName: string;
        storageType?: 'direct';
      };
    },
    type: string
  ) {
    // Set up files array for direct file upload
    this.files = [{
      filename: textContent.metadata.originalFileName,
      type: type,
      file: file,
      textContent: textContent
    }];
  }

  /**
   * Factory method to create a CaptivateChatFileManager with automatic file-to-text conversion for direct file uploads.
   * @param options - Configuration options for the file input.
   * @param options.file - The file to convert.
   * @param options.fileName - Optional custom file name.
   * @param options.fileType - Optional custom file type.
   * @param options.storage - Whether to store the file for future reference (default: true).
   * @param options.url - URL to reference the file when storage is false (required when storage is false).
   * @returns A promise that resolves to a CaptivateChatFileManager instance with converted text.
   */
  static async create(
    options: {
      file: File | Blob;
      fileName?: string;
      fileType?: string;
      storage?: boolean;
      url?: string;
    }
  ): Promise<CaptivateChatFileManager> {
    // Direct file upload
    const file = options.file;
    const storage = options.storage !== undefined ? options.storage : true; // Default to true
    
    // If storage is false, URL is required for sendMessage compatibility
    if (storage === false && !options.url) {
      throw new Error('URL is required when storage is false for sendMessage compatibility');
    }
    
    const finalFileName = options.fileName || (file instanceof File ? file.name : `attachment_${Date.now()}`);
    const finalType = options.fileType || (file instanceof File ? file.type : file.type || 'application/octet-stream');

    // Convert file to text
    const conversionResult = await CaptivateChatFileManager.convertFileToText(
      file, 
      finalFileName, 
      true, // Always include metadata
      storage
    );

    // Create and return the instance with proxy for array-like behavior
    const instance = new CaptivateChatFileManager(file, {
      type: 'file_content',
      text: conversionResult.text,
      metadata: {
        source: 'file_attachment',
        originalFileName: finalFileName,
        storageType: 'direct'
      }
    }, finalType);
    
    // Add storage information if available
    if (storage && conversionResult.storageInfo) {
      instance.files[0].storage = conversionResult.storageInfo;
    }
    
    // If storage is false and URL is provided, add URL to the file object
    if (storage === false && options.url) {
      instance.files[0].url = options.url;
    }
    
    return CaptivateChatFileManager.createProxy(instance);
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
   * Refreshes the secure URL for the first file (if it has storage information).
   * @param expiresIn - Expiration time in seconds (default: 7200 = 2 hours).
   * @returns A promise that resolves to the refreshed secure URL, or undefined if no storage info.
   */
  async refreshSecureUrl(expiresIn: number = 7200): Promise<string | undefined> {
    const firstFile = this.files[0];
    if (!firstFile || !(firstFile as any).storage?.fileKey) {
      return undefined;
    }
    
    return await CaptivateChatFileManager.getSecureFileUrl(
      (firstFile as any).storage.fileKey, 
      expiresIn
    );
  }

  /**
   * Proxy handler to make the class behave like the files array.
   * This allows using fileInputObj directly as files: fileInputObj
   */
  static createProxy(instance: CaptivateChatFileManager) {
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
   * Returns just the file object instead of the full CaptivateChatFileManager wrapper.
   * @param options - Configuration options for the file input.
   * @param options.file - The file to convert.
   * @param options.fileName - Optional custom file name.
   * @param options.fileType - Optional custom file type.
   * @param options.storage - Whether to store the file for future reference (default: true).
   * @param options.url - URL to reference the file when storage is false (required when storage is false).
   * @returns A promise that resolves to a single file object.
   */
  static async createFile(
    options: {
      file: File | Blob;
      fileName?: string;
      fileType?: string;
      storage?: boolean;
      url?: string;
    }
  ): Promise<{
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
  }> {
    const fileInput = await CaptivateChatFileManager.create({
      file: options.file,
      fileName: options.fileName,
      fileType: options.fileType,
      storage: options.storage,
      url: options.url
    });
    return fileInput.getFirstFile()!;
  }

  /**
   * Factory method to create multiple file inputs from an array of files.
   * Processes all files in parallel and returns a single CaptivateChatFileManager with all files.
   * @param options - Configuration options for all files.
   * @param options.files - Array of files to process.
   * @param options.storage - Whether to store the files for future reference (default: true).
   * @param options.urls - Array of URLs to reference files when storage is false (required when storage is false).
   * @returns A promise that resolves to a CaptivateChatFileManager instance with all processed files.
   */
  static async createMultiple(
    options: {
      files: (File | Blob)[];
      storage?: boolean;
      urls?: string[];
    }
  ): Promise<CaptivateChatFileManager> {
    const storage = options.storage !== undefined ? options.storage : true; // Default to true
    
    // If storage is false, URLs are required for sendMessage compatibility
    if (storage === false && (!options.urls || options.urls.length !== options.files.length)) {
      throw new Error('URLs array is required when storage is false and must match the number of files');
    }
    
    // Process multiple files
    const files = options.files;
    const fileInputs = await Promise.all(
      files.map((file, index) => CaptivateChatFileManager.create({
        file: file,
        storage: storage,
        url: storage === false ? options.urls![index] : undefined
      }))
    );

    // Combine all files into a single array
    const allFiles = fileInputs.flatMap(input => input.files);

    // Create a new instance with all files
    const combinedInstance = new CaptivateChatFileManager(
      files[0], // Use first file as placeholder
      {
        type: 'file_content',
        text: '', // Will be ignored since we're using the files array
        metadata: {
          source: 'file_attachment',
          originalFileName: 'multiple_files',
          storageType: 'direct'
        }
      },
      'application/octet-stream'
    );

    // Replace the files array with the combined files
    (combinedInstance as any).files = allFiles;

    return CaptivateChatFileManager.createProxy(combinedInstance);
  }

  /**
   * Generates a secure URL for accessing a stored file.
   * @param fileKey - The file key from the storage response.
   * @param expiresIn - Expiration time in seconds (default: 7200 = 2 hours).
   * @returns A promise that resolves to the secure URL.
   */
  static async getSecureFileUrl(fileKey: string, expiresIn: number = 7200): Promise<string> {
    const url = CaptivateChatFileManager.PRESIGNED_URL_API_URL;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fileKey: fileKey,
          expiresIn: expiresIn
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Secure URL generation failed: ${response.status} ${response.statusText}. ${errorData.error || ''}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(`Secure URL generation failed: ${data.error || 'Unknown error'}`);
      }

      return data.presignedUrl || '';

    } catch (error: any) {
      if (error.message.includes('Secure URL generation failed')) {
        throw error;
      }
      throw new Error(`Failed to generate secure URL: ${error.message}`);
    }
  }

  /**
   * Converts a file to text using the file-to-text API endpoint.
   * @param file - The file to convert (File or Blob).
   * @param fileName - The name of the file.
   * @param includeMetadata - Whether to include additional metadata in the response.
   * @param storage - Whether to store the file for future reference.
   * @returns A promise that resolves to the extracted text.
   */
  private static async convertFileToText(file: File | Blob, fileName: string, includeMetadata: boolean, storage: boolean): Promise<{text: string, storageInfo?: any}> {
    const url = CaptivateChatFileManager.FILE_TO_TEXT_API_URL;

    // Create FormData for multipart/form-data request
    const formData = new FormData();
    formData.append('file', file, fileName);
    formData.append('includeMetadata', includeMetadata.toString());
    formData.append('storage', storage.toString());

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

      return {
        text: data.text || '',
        storageInfo: storage ? {
          fileKey: data.fileKey,
          presignedUrl: data.presignedUrl,
          expiresIn: data.expiresIn,
          fileSize: data.fileSize,
          processingTime: data.processingTime
        } : undefined
      };

    } catch (error: any) {
      if (error.message.includes('File conversion failed')) {
        throw error;
      }
      throw new Error(`Failed to convert file to text: ${error.message}`);
    }
  }
}