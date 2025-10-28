# captivate-chat-api

Hybrid WebSocket/REST-based chat API for real-time conversations with support for bot and human agents. Features WebSocket communication for real-time messaging and REST endpoints for data retrieval operations.

## Installation

Install the package using npm:

```bash
npm install captivate-chat-api
```

## What's New

### HTTP REST Migration (v5.0.0)

Client sending operations have been refactored from WebSocket to HTTP REST for improved reliability and performance:

- **🔄 HTTP REST for Sending**: All client sending operations (`sendMessage`, `setMetadata`, `setPrivateMetadata`, `sendAction`) now use HTTP REST endpoints instead of WebSocket events
- **⚡ Improved Reliability**: HTTP requests provide better error handling and retry mechanisms compared to WebSocket events
- **📡 Hybrid Architecture**: WebSocket is still used for real-time message reception and event handling, while HTTP handles all outgoing operations
- **🔧 Backward Compatibility**: All existing method signatures remain unchanged - no code changes required
- **📊 Better Performance**: HTTP requests offer more predictable latency and better handling of network issues

**Methods now using HTTP REST:**
- `conversation.sendMessage()` - Sends messages via HTTP with immediate confirmation
- `conversation.setMetadata()` - Updates metadata via HTTP with response confirmation  
- `conversation.setPrivateMetadata()` - Updates private metadata via HTTP with response confirmation
- `conversation.sendAction()` - Sends custom actions via HTTP with response confirmation

**Methods now using HTTP REST:**
- `conversation.getMetadata()` - Uses HTTP request with direct response (no WebSocket)
- `conversation.editMessage()` - Uses HTTP request with direct response (no WebSocket)

**Methods still using WebSocket:**
- All event listeners (`onMessage`, `onError`, `onConversationUpdate`, `onActionReceived`) - Continue to work via WebSocket for real-time updates

### Enhanced File Handling (v4.0.0)

The `CaptivateChatFileManager` class has been significantly improved with:

- **🎉 Direct Usage**: Use `fileInput` directly as `files: fileInput` instead of `files: fileInput.files`
- **🔧 Convenience Methods**: Easy access to file properties with `getFilename()`, `getTextContent()`, `getFileType()`
- **📦 Single File Factory**: New `createFile()` method for direct file object creation
- **🔄 Array-like Behavior**: Proxy-based implementation supports array access and iteration
- **💾 Storage Options**: Choose between service storage (`storage: true`) or developer storage (`storage: false`)
- **🔗 URL Support**: When `storage: false`, provide your own URL for `sendMessage` compatibility
- **⚡ Performance**: Eliminated API URL duplication and optimized internal structure
- **🔒 Backward Compatibility**: All existing code continues to work without changes




### Key Improvements

1. **Simplified API**: No more complex `.files[0]` access patterns
2. **Better Developer Experience**: Cleaner, more intuitive method names
3. **Flexible Usage**: Choose between wrapper (`create()`) or direct (`createFile()`) approaches
4. **Type Safety**: Full TypeScript support with proper type definitions

## Usage

### Single API Key Usage (CaptivateChatAPI)

Most users will only need to use a single API key. Use the `CaptivateChatAPI` class for all standard chat operations:

```typescript
import { CaptivateChatAPI } from 'captivate-chat-api';

const api = new CaptivateChatAPI('YOUR_API_KEY');
await api.connect();

const conversation = await api.createConversation('user123');
```

You can use all the features described below (creating conversations, sending messages, etc.) with a single API key using this class.

### Basic Setup

Import and initialize the API client:

**Option 1: Using the static factory method (Recommended)**
```typescript
import { CaptivateChatAPI } from 'captivate-chat-api';

// Create and connect in one step
const api = await CaptivateChatAPI.create('YOUR_API_KEY');
// API is ready to use!
```

**Option 2: Manual instantiation and connection**
```typescript
import { CaptivateChatAPI } from 'captivate-chat-api';

const api = new CaptivateChatAPI('YOUR_API_KEY');

// Connect to the WebSocket server
await api.connect();
```

### Create a Conversation

Create a new conversation with the following options:

1. Basic setup with just a user ID:
   ```typescript
   const conversation = await api.createConversation('user123');
   ```

2. Include user information and custom data:
   ```typescript
   const conversation = await api.createConversation(
     'user123',
     {
       name: 'John Doe',
       email: 'john@example.com'
     },
     {
       customField: 'value'
     },
     'user-first' // Start the conversation with user-first or bot-first mode
   );
   ```

3. **(New)** Include private metadata (not visible to frontend):
   ```typescript
   const conversation = await api.createConversation(
     'user123',
     { name: 'John Doe' },
     { publicKey: 'visible' },
     'user-first',
     { secretKey: 'hidden', internalFlag: true } // privateMetadata
   );
   ```
   - The `privateMetadata` parameter is optional and, if provided, will be sent under the `private` key in the metadata. This is intended for backend/internal use and will not be returned to the frontend when fetching metadata.
   - This change is **backwards compatible**: existing usages of `createConversation` do not need to change.

### Send and Receive Messages

1. Send a text message to the conversation:
   ```typescript
   await conversation.sendMessage('Hello!');
   ```

2. Send a file with text message (recommended format):
   ```typescript
   await conversation.sendMessage({
     text: "Here's the document you requested",
     files: [fileObject]
   });
   ```

3. Listen for responses:
   ```typescript
   conversation.onMessage((message, type) => {
     console.log(`${type}: ${message}`);
   });
   ```

### File Handling with CaptivateChatFileManager

The `CaptivateChatFileManager` class provides automatic file-to-text conversion and structured file handling for chat messages. The class now includes several convenience methods and supports direct usage as a files array.

#### Basic File Upload

```typescript
import { CaptivateChatFileManager } from 'captivate-chat-api';

// Upload a local file with storage (default behavior)
const fileInput = await CaptivateChatFileManager.create({
  file: file,
  fileName: 'document.pdf'
  // storage defaults to true - file stored by service
});

// Send file with text message - NEW: You can use fileInput directly!
await conversation.sendMessage({
  text: "Here's the document you requested",
  files: fileInput  // 🎉 No need for .files anymore!
});
```

#### File Storage Options

The library now supports two storage modes:

**1. Service Storage (Default) - `storage: true`**
```typescript
// File stored by the service (default behavior)
const fileInput = await CaptivateChatFileManager.create({
  file: file,
  fileName: 'document.pdf'
  // storage defaults to true - file stored by service
});

// File object includes storage information:
// {
//   filename: 'document.pdf',
//   type: 'application/pdf',
//   file: File,
//   textContent: { ... },
//   storage: {
//     fileKey: 'uploads/1704067200000-...',
//     presignedUrl: 'https://my-bucket.s3.amazonaws.com/...',
//     expiresIn: 1704070800,
//     fileSize: 1024,
//     processingTime: 15
//   }
// }
```

**2. Developer Storage - `storage: false`**
```typescript
// File processed without storage, provide your own URL
const fileInput = await CaptivateChatFileManager.create({
  file: file,
  fileName: 'document.pdf',
  storage: false,
  url: 'https://my-bucket.s3.amazonaws.com/documents/document.pdf'  // Required
});

// File object includes your URL:
// {
//   filename: 'document.pdf',
//   type: 'application/pdf',
//   file: File,
//   url: 'https://my-bucket.s3.amazonaws.com/documents/document.pdf',
//   textContent: { ... }
// }
```

**Storage Benefits:**
- **Service Storage**: Automatic file management, presigned URLs, no developer overhead
- **Developer Storage**: Full control over storage location, access permissions, and costs

#### Secure URL Management

When using service storage, you can generate fresh secure URLs for accessing stored files:

```typescript
// Create file with storage
const fileInput = await CaptivateChatFileManager.create({
  file: file,
  fileName: 'document.pdf'
  // storage defaults to true
});

// Refresh secure URL (expires in 2 hours by default)
const refreshedUrl = await fileInput.refreshSecureUrl();
console.log('Refreshed secure URL:', refreshedUrl);

// Refresh secure URL with custom expiration (1 hour)
const customUrl = await fileInput.refreshSecureUrl(3600);

// Generate secure URL from file key directly
const fileKey = 'uploads/1704067200000-uuid-example.txt';
const directUrl = await CaptivateChatFileManager.getSecureFileUrl(fileKey, 7200);
```

**Use Cases:**
- **Expired URLs**: Refresh secure URLs when the original expires
- **Custom Expiration**: Set different expiration times for different use cases
- **Direct Access**: Generate secure URLs from file keys without file objects

#### Convenience Methods

The `CaptivateChatFileManager` class now includes several convenience methods for easier access to file properties:

```typescript
const fileInput = await CaptivateChatFileManager.create({
  file: file,
  fileName: 'document.pdf'
});

// Get file information easily
console.log('Filename:', fileInput.getFilename());
console.log('File type:', fileInput.getFileType());
console.log('Text content:', fileInput.getTextContent());
console.log('Text length:', fileInput.getTextContent().length);

// Get the first file object if needed
const firstFile = fileInput.getFirstFile();

// Convert to files array explicitly (though not needed anymore)
const filesArray = fileInput.toFilesArray();
```

#### Developer Storage with URL

```typescript
// Process file without service storage, provide your own URL
const fileInput = await CaptivateChatFileManager.create({
  file: file,
  fileName: 'document.pdf',
  storage: false,
  url: 'https://my-bucket.s3.amazonaws.com/documents/document.pdf'  // Required
});

await conversation.sendMessage({
  text: "Document from my storage",
  files: fileInput  // 🎉 Direct usage supported!
});
```

#### Multiple Files

**Option 1: Using the new `createMultiple()` method (Recommended)**

```typescript
// Process multiple files with service storage (default)
const files = [file1, file2, file3];
const fileInput = await CaptivateChatFileManager.createMultiple({
  files: files
  // storage defaults to true
});

await conversation.sendMessage({
  text: "Multiple documents attached",
  files: fileInput  // 🎉 All files processed and ready!
});
```

**Option 2: Multiple files with developer storage**

```typescript
// Process multiple files without service storage
const files = [file1, file2, file3];
const urls = [
  'https://my-bucket.s3.amazonaws.com/file1.pdf',
  'https://my-bucket.s3.amazonaws.com/file2.pdf',
  'https://my-bucket.s3.amazonaws.com/file3.pdf'
];

const fileInput = await CaptivateChatFileManager.createMultiple({
  files: files,
  storage: false,
  urls: urls  // Required when storage is false
});

await conversation.sendMessage({
  text: "Multiple documents from my storage",
  files: fileInput
});
```

**Option 3: Manual processing (still supported)**

```typescript
// Process multiple files manually
const files = [file1, file2, file3];
const fileInputs = await Promise.all(
  files.map(file => CaptivateChatFileManager.create({
    file: file
  }))
);

// Combine all files
const allFiles = fileInputs.flatMap(input => input);

await conversation.sendMessage({
  text: "Multiple documents attached",
  files: allFiles
});
```

#### Alternative: Single File Factory Method

For even simpler usage when you only need one file object, you can use the new `createFile()` method:

```typescript
// Get just the file object directly (no wrapper) with service storage
const fileObj = await CaptivateChatFileManager.createFile({
  file: file,
  fileName: 'document.pdf'
  // storage defaults to true
});

await conversation.sendMessage({
  text: "Here's the document",
  files: fileObj  // 🎉 Direct usage - no array wrapping needed!
});

// Or with developer storage
const fileObjWithUrl = await CaptivateChatFileManager.createFile({
  file: file,
  fileName: 'document.pdf',
  storage: false,
  url: 'https://my-bucket.s3.amazonaws.com/document.pdf'
});

await conversation.sendMessage({
  text: "Here's the document from my storage",
  files: fileObjWithUrl  // 🎉 Direct usage - no array wrapping needed!
});
```

#### File Input Structure

The `CaptivateChatFileManager` creates a structured object with:

**Service Storage (storage: true):**
```typescript
{
  type: 'files',
  files: [
    {
      filename: 'document.pdf',
      type: 'application/pdf',
      file: File | Blob,         // Original file
      textContent: {
        type: 'file_content',
        text: 'Extracted text from file...',
        metadata: {
          source: 'file_attachment',
          originalFileName: 'document.pdf',
          storageType: 'direct'
        }
      },
      storage: {
        fileKey: 'uploads/1704067200000-...',
        presignedUrl: 'https://my-bucket.s3.amazonaws.com/...',
        expiresIn: 1704070800,
        fileSize: 1024,
        processingTime: 15
      }
    }
  ]
}
```

**Developer Storage (storage: false):**
```typescript
{
  type: 'files',
  files: [
    {
      filename: 'document.pdf',
      type: 'application/pdf',
      file: File | Blob,         // Original file
      url: 'https://my-bucket.s3.amazonaws.com/document.pdf',  // Developer's URL
      textContent: {
        type: 'file_content',
        text: 'Extracted text from file...',
        metadata: {
          source: 'file_attachment',
          originalFileName: 'document.pdf',
          storageType: 'direct'
        }
      }
    }
  ]
}
```

#### Supported File Types

- **Documents**: PDF, DOCX, TXT, XLSX, CSV
- **Images**: PNG, JPG, JPEG (with OCR text extraction)
- **Any file type** supported by the file-to-text API

#### WebSocket Payload Format

Files are sent in the following WebSocket payload structure:

```json
{
  "action": "sendMessage",
  "event": {
    "event_type": "user_message",
    "event_payload": {
      "type": "message_create",
      "client_msg_id": "unique-message-id-1234567890",
      "conversation_id": "your-conversation-id",
      "content": {
        "text": "Here's the document you requested",
        "files": [
          {
            "filename": "document.pdf",
            "type": "application/pdf",
            "textContent": {
              "type": "file_content",
              "text": "Extracted text from PDF...",
              "metadata": {
                "source": "file_attachment",
                "originalFileName": "document.pdf",
                "storageType": "direct"
              }
            }
          }
        ]
      }
    }
  }
}
```

### Edit a Message

Edit a previously sent message in the conversation:

```typescript
await conversation.editMessage('messageId123', 'Updated message text');
// Or with a custom object:
await conversation.editMessage('messageId123', { type: 'text', text: 'Updated message text', files: [], actions: [] });
```

The method returns a promise that resolves when the edit is confirmed by the server (`message_edited_success` event).

### Handle Events

Use event listeners to handle various updates, errors, or custom actions:

1. Error handling:
   ```typescript
   conversation.onError((error) => {
     console.error('Error:', error);
   });
   ```

2. Updates on conversation status:
   ```typescript
   conversation.onConversationUpdate((update) => {
     console.log('Conversation Update:', update);
   });
   ```

3. Handling custom actions:
   ```typescript
   conversation.onActionReceived((actions) => {
     console.log(`Actions:`, actions);
   });
   ```

### Get Conversation History

Retrieve the transcript of a conversation:

```typescript
const transcript = await conversation.getTranscript();
console.log('Transcript:', transcript);
```

### Delete Conversation

Delete the current conversation with optional soft delete:

```typescript
// Soft delete (default - safer option)
await conversation.delete();
console.log('Conversation soft deleted');

// Explicit soft delete
await conversation.delete({ softDelete: true });
console.log('Conversation soft deleted');

// Hard delete (permanent - deletes everything including transcripts)
await conversation.delete({ softDelete: false });
console.log('Conversation permanently deleted');
```

**Delete Types:**
- **Soft Delete (default)**: Marks conversation as deleted but preserves data including transcripts for potential recovery
- **Hard Delete**: Permanently removes everything including transcripts, messages, and all associated data


### Retrieve User Conversations

Fetch a list of conversations associated with a specific user ID. This method supports both legacy (v1) and advanced (v2) usage with filter, search, and pagination. Both versions return the same response format. The method supports backward compatibility with both string and object parameters.

**Note:** 
- `search` parameter uses wildcard matching by default (e.g., "fred" matches "frederick", "alfred", etc.)
- `filter` parameter uses exact matching only (e.g., "fred" only matches "fred")

**Legacy usage (v1) - String parameter (backward compatible):**
```typescript
const conversations = await api.getUserConversations('user123');
console.log('User Conversations:', conversations);
/*
 Returns Conversation Object
 */
```

**Legacy usage (v1) - Options object:**
```typescript
const conversations = await api.getUserConversations({
  userId: 'user123'
});
console.log('User Conversations:', conversations);
/*
 Returns Conversation Object
 */
```

**Advanced usage (v2, with filter and pagination):**
```typescript
const conversations = await api.getUserConversations({
  userId: 'user123',
  filter: { mode: 'dbfred' }, // exact match only
  pagination: { page: '1', limit: '10' }
});
console.log('Filtered & Paginated User Conversations:', conversations);
/*
 Returns Conversation Object
 */
```

**Advanced usage (v2, with search and pagination):**
```typescript
const conversations = await api.getUserConversations({
  userId: 'user123',
  search: { mode: 'fred' }, // wildcard match (matches "frederick", "alfred", etc.)
  pagination: { page: '1', limit: '10' }
});
console.log('Searched & Paginated User Conversations:', conversations);
/*
 Returns Conversation Object
 */
```

**Advanced usage (v2, with both filter and search):**
```typescript
const conversations = await api.getUserConversations({
  userId: 'user123',
  filter: { mode: 'dbfred' }, // exact match
  search: { mode: 'fred' }, // wildcard match
  pagination: { page: '1', limit: '10' }
});
console.log('Filtered, Searched & Paginated User Conversations:', conversations);
/*
 Returns Conversation Object
 */
```

### Multi-API-Key Support (CaptivateChatManager)

For advanced use cases where you need to fetch and interact with conversations across multiple API keys, use the `CaptivateChatManager` class. This manager handles multiple `CaptivateChatAPI` instances and ensures each `Conversation` uses the correct socket for its API key.

**Note:** Most users do not need this. Only use the manager if you need to aggregate or interact with conversations across multiple API keys.

**Option 1: Using the static factory method (Recommended)**
```typescript
import { CaptivateChatManager } from 'captivate-chat-api';

const apiKeys = [
  'YOUR_API_KEY_1',
  'YOUR_API_KEY_2'
];

// Create and connect all instances in one step
const manager = await CaptivateChatManager.create(apiKeys, 'dev');

const { conversations, pagination } = await manager.getUserConversations({
  userId: '66f016f09d5961b684ce05f0',
  apiKeys,
  pagination: { page: '1', limit: '90' }
});

for (const conv of conversations) {
  const transcript = await conv.getTranscript();
  console.log(`Transcript for ${conv.getConversationId()}:`, transcript);
}
```

**Option 2: Manual instantiation and connection**
```typescript
import { CaptivateChatManager } from 'captivate-chat-api';

const apiKeys = [
  'YOUR_API_KEY_1',
  'YOUR_API_KEY_2'
];

const manager = new CaptivateChatManager(apiKeys, 'dev');
await manager.connectAll();

const { conversations, pagination } = await manager.getUserConversations({
  userId: '66f016f09d5961b684ce05f0',
  apiKeys,
  pagination: { page: '1', limit: '90' }
});

for (const conv of conversations) {
  const transcript = await conv.getTranscript();
  console.log(`Transcript for ${conv.getConversationId()}:`, transcript);
}
```

- Use `CaptivateChatAPI` for single-key scenarios.
- Use `CaptivateChatManager` for multi-key scenarios.

### Delete User Conversations

Delete all conversations for a specific user with optional soft delete:

```typescript
// Soft delete (default - safer option)
await api.deleteUserConversations('user123');
console.log('User conversations soft deleted');

// Explicit soft delete
await api.deleteUserConversations('user123', { softDelete: true });
console.log('User conversations soft deleted');

// Hard delete (permanent - deletes everything including transcripts)
await api.deleteUserConversations('user123', { softDelete: false });
console.log('User conversations permanently deleted');
```

**Delete Types:**
- **Soft Delete (default)**: Marks all user conversations as deleted but preserves data including transcripts for potential recovery
- **Hard Delete**: Permanently removes all user conversations including transcripts, messages, and all associated data


### Example: Full Workflow

Here's a complete example of how to use the API:

```typescript
import { CaptivateChatAPI, CaptivateChatFileManager } from 'captivate-chat-api';

(async () => {
  try {
    // Create and connect to the API in one step
    const api = await CaptivateChatAPI.create('YOUR_API_KEY', 'prod');
    console.log('Connected to CaptivateChat API');

    // Create a conversation
    const conversation = await api.createConversation(
      'user123',
      {
        name: 'John Doe',
        email: 'john@example.com',
      },
      { role: 'admin' },
      'bot-first'
    );

    console.log('Conversation started:', conversation);

    // Listen for messages
    conversation.onMessage((message, type) => {
      console.log(`Received (${type}): ${message}`);
    });

    // Send a text message
    await conversation.sendMessage('Hello! How can I assist you today?');

    // Send a file with text message
    const fileInput = await CaptivateChatFileManager.create({
      file: file,
      fileName: 'document.pdf'
    });
    
    await conversation.sendMessage({
      text: "Here's the document you requested",
      files: fileInput  // 🎉 Direct usage - no .files needed!
    });

    // Handle conversation updates
    conversation.onConversationUpdate((update) => {
      console.log('Conversation Update:', update);
    });

    // Fetch the transcript
    const transcript = await conversation.getTranscript();
    console.log('Transcript:', transcript);

    // Get user conversations (backward compatible)
    const conversations = await api.getUserConversations('user123');
    console.log('User Conversations:', conversations);

    // Get user conversations with advanced filtering (new API)
    const filteredConversations = await api.getUserConversations({
      userId: 'user123',
      filter: { status: 'active' },
      search: { title: 'meeting' },
      pagination: { page: '1', limit: '10' }
    });
    console.log('Filtered Conversations:', filteredConversations);

    // Delete the conversation (soft delete by default)
    await conversation.delete();
    console.log('Conversation soft deleted successfully.');
    
    // Or delete permanently
    // await conversation.delete({ softDelete: false });
    // console.log('Conversation permanently deleted.');

  } catch (error) {
    console.error('Error:', error);
  }
})();
```

### Development Mode

Switch to development mode for testing:
```typescript
const api = new CaptivateChatAPI('YOUR_API_KEY', 'dev');
```

## Environment Support

The API supports the following environments:
- **Browser**
- **Node.js**
- **React Native**

### File Processing

File-to-text conversion is handled by the external API endpoint:
- **Production**: `https://file-to-text.prod.captivat.io/api/file-to-text`
- **Supported formats**: PDF, DOCX, TXT, PNG, JPG, JPEG
- **Features**: OCR for images, metadata extraction, automatic text conversion

## API Reference

### CaptivateChatFileManager

A utility class for processing files and converting them to text for chat messages. The class now supports direct usage as a files array and includes convenience methods for easier file property access.

#### Methods

- **`static create(options: { file: File | Blob; fileName?: string; fileType?: string; storage?: boolean; url?: string }): Promise<CaptivateChatFileManager>`**  
  Creates a `CaptivateChatFileManager` from a local file with automatic text extraction. `storage` defaults to `true`.

- **`static createFile(options: { file: File | Blob; fileName?: string; fileType?: string; storage?: boolean; url?: string }): Promise<FileObject>`**  
  **(New)** Creates a single file object directly (no wrapper) with automatic text extraction. `storage` defaults to `true`.

- **`static createMultiple(options: { files: (File | Blob)[]; storage?: boolean; urls?: string[] }): Promise<CaptivateChatFileManager>`**  
  **(New)** Creates a single `CaptivateChatFileManager` from multiple files, processing them in parallel. `storage` defaults to `true`.

- **`getFilename(): string | undefined`**  
  **(New)** Gets the filename of the first file.

- **`getTextContent(): string`**  
  **(New)** Gets the text content of the first file.

- **`getFileType(): string | undefined`**  
  **(New)** Gets the file type of the first file.

- **`getFirstFile(): FileObject | undefined`**  
  **(New)** Gets the first file object from the files array.

- **`toFilesArray(): Array<FileObject>`**  
  **(New)** Returns the files array explicitly.

- **`refreshSecureUrl(expiresIn?: number): Promise<string | undefined>`**  
  **(New)** Refreshes the secure URL for the first file (if it has storage information).

- **`static getSecureFileUrl(fileKey: string, expiresIn?: number): Promise<string>`**  
  **(New)** Generates a secure URL for accessing a stored file by file key.

#### Properties

- **`type: 'files'`** - Always 'files' for file inputs
- **`files: Array<FileObject>`** - Array of processed file objects
- **`length: number`** - **(New)** Returns the length of the files array for array-like behavior

#### Array-like Behavior

The `CaptivateChatFileManager` class now supports array-like behavior through a proxy, allowing you to use it directly as a files array:

```typescript
const fileInput = await CaptivateChatFileManager.create(file, options);

// All of these work:
files: fileInput           // ✅ Direct usage
files: fileInput.files     // ✅ Traditional usage (still supported)
fileInput[0]               // ✅ Array access
fileInput.length           // ✅ Array length
```

#### FileObject Structure

**Service Storage (storage: true):**
```typescript
{
  filename: string;
  type: string;
  file: File | Blob;         // Original file
  textContent: {
    type: 'file_content';
    text: string;
    metadata: {
      source: 'file_attachment';
      originalFileName: string;
      storageType: 'direct';
    };
  };
  storage: {
    fileKey: string;
    presignedUrl: string;
    expiresIn: number;
    fileSize: number;
    processingTime: number;
  };
}
```

**Developer Storage (storage: false):**
```typescript
{
  filename: string;
  type: string;
  file: File | Blob;         // Original file
  url: string;               // Developer's URL (required when storage is false)
  textContent: {
    type: 'file_content';
    text: string;
    metadata: {
      source: 'file_attachment';
      originalFileName: string;
      storageType: 'direct';
    };
  };
}
```

### CaptivateChatAPI

#### Methods
- **`constructor(apiKey: string, mode: 'prod' | 'dev' = 'prod')`**  
  Initializes the API with the given API key and mode.

- **`static create(apiKey: string, mode: 'prod' | 'dev' = 'prod'): Promise<CaptivateChatAPI>`**  
  **(New)** Static factory method that creates and connects a CaptivateChatAPI instance. Returns a promise that resolves to a ready-to-use, connected API instance.
  
- **`connect(): Promise<void>`**  
  Connects to the WebSocket server.

- **`isSocketActive(): boolean`**  
  **(New)** Checks if the WebSocket connection is active and open. Returns true if the socket is open, false otherwise.

- **`createConversation(userId: string, userBasicInfo?: object, userData?: object, autoConversationStart?: 'bot-first' | 'user-first'): Promise<Conversation>`**  
  Creates a new conversation.

- **`getConversation(conversationId: string): Conversation`**  
  Retrieves an existing conversation by its ID.

- **`getUserConversations(userIdOrOptions: string | { userId: string; filter?: object; search?: object; pagination?: { page?: string | number; limit?: string | number }; apiKeys?: string[] }): Promise<Conversation[]>`**  
  Fetches a list of conversations associated with the given user ID. Supports backward compatibility with string parameter or options object. If `filter`, `search`, `pagination`, or `apiKeys` is provided, uses the v2 API for advanced querying. Both `filter` and `search` parameters are supported for different querying needs. The `apiKeys` parameter allows grouping conversations by API key. Returns Conversation Object

- **`deleteUserConversations(userId: string, options?: { softDelete?: boolean }): Promise<void>`**  
  Deletes all conversations associated with the given user ID. `options.softDelete` defaults to `true` (safer option).
---

### Conversation

#### Methods
- **`sendMessage(content: string): Promise<void>`**  
  Sends a text message to the conversation.

- **`sendMessage(content: object): Promise<void>`**  
  Sends a structured message. Supports:
  - **Text only**: `{ type: 'text', text: 'Hello' }`
  - **Files only**: `{ type: 'files', files: [...] }`
  - **Combined**: `{ text: 'Hello', files: [...] }` (recommended)

- **`setMetadata(metadata: object): Promise<void>`**  
  Updates metadata for the conversation.

- **`setPrivateMetadata(privateMeta: object): Promise<void>`**  
  **(New)** Updates private metadata for the conversation (not visible to frontend). Example:
  ```typescript
  await conversation.setPrivateMetadata({ secret: 'mySecretValue', internalFlag: true });
  ```
  This will set the metadata under the `private` key. The private metadata is intended for backend/internal use only and will not be returned to the frontend when fetching metadata.

- **`getMetadata(): Promise<object>`**  
  Returns the metadata for that current conversation session

- **`sendAction(actionId: string, data?: object): Promise<void>`**  
  Sends a custom action to the conversation.

- **`editMessage(messageId: string, content: string | object): Promise<void>`**  
  Edits a previously sent message in the conversation. Resolves when the edit is confirmed by the server.

- **`getTranscript(): Promise<object[]>`**  
  Retrieves the conversation transcript.

- **`delete(options?: { softDelete?: boolean }): Promise<void>`**  
  Deletes the current conversation. `options.softDelete` defaults to `true` (safer option).
  


#### Events
- **`onMessage(callback: (message: string, type: string) => void): void`**  
  Listens for new messages.

- **`onError(callback: (error: any) => void): void`**  
  Listens for errors.

- **`onConversationUpdate(callback: (update: any) => void): void`**  
  Listens for updates to the conversation.

- **`onActionReceived(callback: (actions:[Action]) => void): void`**  
  Handles custom actions received during the conversation.

## Interfaces
``` typescript
interface Action {
  id: string;
  data: any;
}
```