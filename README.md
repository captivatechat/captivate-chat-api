# captivate-chat-api

Hybrid WebSocket/REST-based chat API for real-time conversations with support for bot and human agents. Features WebSocket communication for real-time messaging and REST endpoints for data retrieval operations.

## Installation

Install the package using npm:

```bash
npm install captivate-chat-api
```

## What's New

### Connection Reliability (v6.1.0)

> Replace `6.1.0` with your actual release number.

This release fixes a group of connection bugs that could cause dropped messages, `410 Gone` responses from the server, duplicate conversations, and spurious timeouts. **No code changes are required** — every fix is backward compatible except one narrowed return type (see [Migration](#migration-to-v610)).

**Conversations now follow reconnects.** A `Conversation` used to capture the WebSocket and `socket_id` at construction. Both are replaced whenever the API reconnects, so any conversation created beforehand kept sending requests stamped with a closed connection id — the server then had nowhere to deliver the reply and returned `410 Gone`. Conversations now read the connection live from the owning `CaptivateChatAPI`.

**Multiple conversations can share one socket.** Listeners were attached with `socket.onmessage = ...`, and a socket has only one `onmessage` slot. Each new `Conversation` silently destroyed the previous one's handler — and the API's own handler, which is what refreshes `socket_id`. Everything now uses `addEventListener`, so handlers coexist and `getUserConversations()` returns conversations that all actually receive messages.

**`createConversation` no longer times out on success.** Its timeout was armed before the request and never cleared, so a response arriving near the deadline would resolve the listener *and* reject the promise: the conversation existed, was cached, and had its opening message sent, while the caller saw a timeout and retried — creating a second real conversation server-side. The timer is now cleared on settle, and the timeout is configurable (default raised from 10s to 20s).

**Bot-first conversations resolve sooner.** `createConversation` used to wait for the bot-first opening message to round-trip before resolving. It now resolves as soon as the conversation exists and dispatches the opener in the background. A failure there is logged rather than failing the whole creation.

**Reconnects re-bind existing conversations.** `connect()` creates a brand-new WebSocket, which previously left every cached conversation listening on the dead one — inbound messages stopped arriving even though the connection looked healthy. `reconnect()` now moves them across.

**Automatic reconnection respects the attempt limit.** An unexpected close used to call `connect()` directly on a timer, bypassing `maxReconnectAttempts` entirely and looping indefinitely against a failing endpoint. It now routes through `reconnect()`, and stops after `dispose()`.

**Errors carry HTTP status.** Failed requests now throw an `Error` with `.status` and `.body`, so you can branch on `401` vs `429` vs `500` without matching strings.

```typescript
try {
  await conversation.sendMessage('Hello');
} catch (err: any) {
  if (err.status === 429) {
    // back off rather than retrying immediately
  }
}
```

> **Note on rate limits:** if the server returns `429` without CORS headers, the browser rejects the request with an opaque `TypeError: Failed to fetch` and no status is visible to JavaScript. You will see the real status in DevTools but cannot read it from code.

**Correct proxy behaviour.** Instances returned by `create()` are wrapped in a guard that reconnects before network calls. `getSocketId()`, `getConversation()`, and `dispose()` were being wrapped by mistake — the first two returned Promises that contradicted their type declarations, and disposing a dead instance reconnected it first. All three are now excluded.

**Configurable timeouts.** See [Configuration](#configuration).

### Singleton Pattern (v6.0.0)

As of v6.0.0, instances are now singleton for better management. No adjustments are needed - the change is automatic and backward compatible.

### HTTP REST Migration (v5.0.0)

Client sending operations have been refactored from WebSocket to HTTP REST for improved reliability and performance:

- **🔄 HTTP REST for Sending**: All client sending operations (`sendMessage`, `setMetadata`, `setPrivateMetadata`, `sendAction`) now use HTTP REST endpoints instead of WebSocket events
- **⚡ Improved Reliability**: HTTP requests provide better error handling and retry mechanisms compared to WebSocket events
- **📡 Hybrid Architecture**: WebSocket is still used for real-time message reception and event handling, while HTTP handles all outgoing operations
- **🔧 Backward Compatibility**: All existing method signatures remain unchanged - no code changes required
- **📊 Better Performance**: HTTP requests offer more predictable latency and better handling of network issues

**Methods using HTTP REST:**
- `conversation.sendMessage()` - Sends messages via HTTP with immediate confirmation
- `conversation.setMetadata()` - Updates metadata via HTTP with response confirmation
- `conversation.setPrivateMetadata()` - Updates private metadata via HTTP with response confirmation
- `conversation.sendAction()` - Sends custom actions via HTTP with response confirmation
- `conversation.getMetadata()` - Uses HTTP request with direct response
- `conversation.editMessage()` - Uses HTTP request with direct response
- `conversation.getTranscript()` - Uses a REST endpoint

**Methods still using WebSocket:**
- All event listeners (`onMessage`, `onError`, `onConversationUpdate`, `onActionReceived`) - Continue to work via WebSocket for real-time updates

Because sends go out over HTTP carrying the current `socket_id`, and the server pushes the reply back down the WebSocket, an outbound request is only deliverable while that socket is alive. This is why the connection fixes in v6.1.0 matter — see [Connection Lifecycle](#connection-lifecycle).

### Debug Mode (v5.0.0)

The library includes a debug mode that allows you to control logging output:

```typescript
import { CaptivateChatAPI } from 'captivate-chat-api';

// Enable debug mode to see detailed logs
CaptivateChatAPI.setDebugMode(true);

// Create and use the API - you'll see detailed logs with [CaptivateChatAPI] prefix
const api = await CaptivateChatAPI.create('YOUR_API_KEY');

// Disable debug mode to hide logs
CaptivateChatAPI.setDebugMode(false);

// Check current debug mode status
const isDebugEnabled = CaptivateChatAPI.getDebugMode();
console.log('Debug mode enabled:', isDebugEnabled);
```

**Debug Mode Features:**
- **🔍 Targeted Logging**: Only affects CaptivateChatAPI logs, not your website's console.log calls
- **🏷️ Clear Prefixing**: All debug logs are prefixed with `[CaptivateChatAPI]` for easy identification
- **⚡ Performance**: Debug logs are completely disabled when debug mode is off
- **🔧 Easy Control**: Simple static methods to enable/disable debug mode globally

**What Gets Logged in Debug Mode:**
- HTTP request/response details
- WebSocket connection events, including every frame received while a conversation is being created
- Message sending confirmations
- Metadata operations
- Action confirmations
- Error details

**Important:** `setDebugMode` only gates `log` output. Warnings and errors from the library are always printed. Your app's own `console.log` calls are unaffected.

### File Manager Improvements

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

## Migration to v6.1.0

One signature narrowed:

```typescript
// Before
getConversation(conversationId: string): Conversation | void

// After
getConversation(conversationId: string): Conversation
```

The old union forced a null check that could never be satisfied on the success path. Existing null checks still compile — they are simply now redundant.

Two behaviours changed in ways worth knowing about:

- **Bot-first creation resolves earlier.** If you relied on `createConversation` resolving only after the opening message had been dispatched, that guarantee is gone. The bot's reply still arrives through `onMessage`; a failed opener is logged as an error.
- **The default `conversation_start` timeout is 20s, up from 10s.** If you were catching that timeout and retrying, you can usually stop — the timeout no longer fires on success. Pass `{ timeoutMs }` to restore a shorter deadline.

If you wrote a workaround for the timeout-on-success bug (watching the raw socket for `conversation_start_success` and adopting the conversation yourself), it is now dead code and can be removed.

## Configuration

Timeouts and reconnection behaviour are configurable per instance:

```typescript
const api = await CaptivateChatAPI.create('YOUR_API_KEY', 'prod', {
  connectTimeoutMs: 10000,            // wait for socket_connected (default 10000)
  conversationStartTimeoutMs: 20000,  // wait for conversation_start_success (default 20000)
  maxReconnectAttempts: 5,            // default 5
  reconnectDelay: 3000,               // ms between attempts (default 3000)
});

// Change them later on a live instance
api.configure({ conversationStartTimeoutMs: 30000 });
```

Because instances are singletons, `options` passed to the constructor are ignored when an instance already exists for that API key and mode. Use `configure()` to change tunables on a live instance.

A single call can also override the conversation-start timeout:

```typescript
const conversation = await api.createConversation(
  'user123', {}, {}, 'bot-first', {},
  { timeoutMs: 30000 }
);
```

## Connection Lifecycle

Worth understanding if you are building anything long-lived:

- **Sends are HTTP, replies are WebSocket.** Every outbound request carries the current `socket_id`; the server pushes the response back over that socket. A request is only deliverable while the socket is alive.
- **The socket can die without your code noticing.** AWS API Gateway closes idle WebSocket connections after 10 minutes and caps any connection at 2 hours. Mobile browsers suspend backgrounded tabs, which closes sockets silently.
- **Check before you send.** `isSocketActive()` is a cheap synchronous check. Instances from `create()` also auto-reconnect before any network call.
- **Reconnects are transparent to conversations.** `reconnect()` re-binds every cached conversation to the new socket, and sends pick up the new `socket_id` automatically.

```typescript
if (!api.isSocketActive()) {
  await api.reconnect();
}
await conversation.sendMessage('Hello');
```

For an idle chat, nothing travels *out* over the socket, so nothing keeps it alive. If your UI can sit idle for more than a few minutes, poll `isSocketActive()` and reconnect when it goes false:

```typescript
setInterval(async () => {
  if (!api.isSocketActive()) {
    try { await api.reconnect(); } catch (err) { console.error('Reconnect failed', err); }
  }
}, 4 * 60 * 1000);

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && !api.isSocketActive()) {
    await api.reconnect();
  }
});
```

## Usage

### Singleton Pattern (Automatic Instance Management)

**Important:** CaptivateChatAPI automatically enforces a singleton pattern per API key and mode combination. This means:

- Creating multiple instances with the same API key returns the same instance
- Prevents duplicate WebSocket connections and resource waste
- Works automatically with both `new CaptivateChatAPI()` and `CaptivateChatAPI.create()`

```typescript
import { CaptivateChatAPI } from 'captivate-chat-api';

// First instance created
const api1 = await CaptivateChatAPI.create('YOUR_API_KEY', 'prod');

// Returns the same instance (singleton)
const api2 = await CaptivateChatAPI.create('YOUR_API_KEY', 'prod');
// api1 === api2 ✅

// Different mode creates separate instance
const apiDev = await CaptivateChatAPI.create('YOUR_API_KEY', 'dev');
// apiDev !== api1 ✅

// Using new also returns singleton
const api3 = new CaptivateChatAPI('YOUR_API_KEY', 'prod');
// api3 === api1 === api2 ✅

// Cleanup when done
api1.dispose(); // Closes socket and removes from registry

// After disposal, new instance can be created
const api4 = await CaptivateChatAPI.create('YOUR_API_KEY', 'prod');
// api4 !== api1 ✅ (new instance)
```

> **⚠️ `dispose()` closes the shared socket for the whole application.** Because instances are singletons, any other part of your app holding "its own" instance holds the same object. Call `dispose()` only when you genuinely want the connection gone — on teardown, or when switching mode. To recover from a dropped connection, use `reconnect()` instead.

**Helper Methods:**
```typescript
// Check if instance exists
if (CaptivateChatAPI.hasInstance('YOUR_API_KEY', 'prod')) {
  const api = CaptivateChatAPI.getInstance('YOUR_API_KEY', 'prod');
}
```

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

`create()` is recommended: it returns a guarded instance that checks the socket and reconnects automatically before any network call.

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

3. Include private metadata (not visible to frontend):
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

4. **(v6.1.0)** Override the conversation-start timeout for a single call:
   ```typescript
   const conversation = await api.createConversation(
     'user123', {}, {}, 'bot-first', {},
     { timeoutMs: 30000 }
   );
   ```

**On `bot-first`:** the promise resolves as soon as the conversation exists. The opening message is dispatched in the background and arrives through `onMessage`. Register your listener immediately after creation so you do not miss it:

```typescript
const conversation = await api.createConversation('user123', {}, {}, 'bot-first');
conversation.onMessage((message, type) => { /* opener arrives here */ });
```

If the opener does arrive before your listener is attached, `getTranscript()` will still contain it.

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

`type` is `'ai_agent'` for bot messages, `'human_agent'` for live chat, and `'error'` when the message could not be retrieved.

### File Handling with CaptivateChatFileManager

> **⚠️ Important:** The **recommended way** to handle files is through `conversation.fileManager`, which automatically includes the API key and conversation ID context. The direct `CaptivateChatFileManager.create()` method will be deprecated soon and is kept only for backwards compatibility. Please migrate to using `conversation.fileManager` for new code.

The `CaptivateChatFileManager` class provides automatic file-to-text conversion and structured file handling for chat messages. The class includes several convenience methods and supports direct usage as a files array.

#### Basic File Upload (Recommended Way)

```typescript
// Upload a local file with storage (default behavior)
const fileInput = await conversation.fileManager.create({
  file: file,
  fileName: 'document.pdf',
  // storage defaults to true - file stored by service
  // API key and conversation ID are automatically included
  // TTL: use conversation.setTimeToLive(1|7|30|90) once; uploads then use that value automatically
});

// Send file with text message
await conversation.sendMessage({
  text: "Here's the document you requested",
  files: fileInput  // 🎉 No need for .files anymore!
});
```

#### Basic File Upload (Legacy - Deprecated Soon)

```typescript
import { CaptivateChatFileManager } from 'captivate-chat-api';

// Upload a local file with storage (default behavior) - LEGACY
const fileInput = await CaptivateChatFileManager.create({
  file: file,
  fileName: 'document.pdf'
  // storage defaults to true - file stored by service
});

await conversation.sendMessage({
  text: "Here's the document you requested",
  files: fileInput
});
```

#### File expiration (TTL)

When uploading a file with storage, you can set a time-to-live so the stored S3 object is automatically removed after a number of days. TTL is applied only at upload time (there are no path-level TTL APIs).

**Recommended:** Set the default once per conversation with `conversation.setTimeToLive(days)`. All uploads via `conversation.fileManager.create()` (and `createFile` / `createMultiple`) will then use that value automatically—no need to pass `ttlDays` on each call.

- **Allowed values**: `1`, `7`, `30`, or `90` days. Any other value is ignored.
- **Optional**: If you never call `setTimeToLive()`, uploads have no expiration.

```typescript
// Set default TTL for this conversation (e.g. 7 days); also stored in metadata
await conversation.setTimeToLive(7);

// Later: uploads use 7-day TTL automatically
const fileInput = await conversation.fileManager.create({
  file: file,
  fileName: 'document.pdf'
});
```

When using `CaptivateChatFileManager.create()` directly (legacy), you can pass optional `ttlDays: 1 | 7 | 30 | 90` in the options.

Generating a presigned URL for a file that was uploaded with TTL still extends its expiration (backend behavior); no frontend change is required.

#### File Storage Options

The library supports two storage modes.

**1. Service Storage (Default) — `storage: true`**

```typescript
// File stored by the service (default behavior)
const fileInput = await conversation.fileManager.create({
  file: file,
  fileName: 'document.pdf'
});
```

The resulting file object includes storage information:

```typescript
{
  filename: 'document.pdf',
  type: 'application/pdf',
  file: File,
  textContent: { /* ... */ },
  storage: {
    fileKey: 'uploads/1704067200000-...',
    presignedUrl: 'https://my-bucket.s3.amazonaws.com/...',
    expiresIn: 1704070800,
    fileSize: 1024,
    processingTime: 15
  }
}
```

**2. Developer Storage — `storage: false`**

```typescript
// File processed without storage, provide your own URL
const fileInput = await conversation.fileManager.create({
  file: file,
  fileName: 'document.pdf',
  storage: false,
  url: 'https://my-bucket.s3.amazonaws.com/documents/document.pdf'  // Required
});
```

The resulting file object includes your URL instead:

```typescript
{
  filename: 'document.pdf',
  type: 'application/pdf',
  file: File,
  url: 'https://my-bucket.s3.amazonaws.com/documents/document.pdf',
  textContent: { /* ... */ }
}
```

**Storage Benefits:**
- **Service Storage**: Automatic file management, presigned URLs, no developer overhead
- **Developer Storage**: Full control over storage location, access permissions, and costs

#### Secure URL Management

When using service storage, you can generate fresh secure URLs for accessing stored files:

```typescript
const fileInput = await conversation.fileManager.create({
  file: file,
  fileName: 'document.pdf'
});

// Refresh secure URL (expires in 2 hours by default)
const refreshedUrl = await fileInput.refreshSecureUrl();

// Refresh secure URL with custom expiration (1 hour)
const customUrl = await fileInput.refreshSecureUrl(3600);

// Generate secure URL from file key directly
const fileKey = 'uploads/1704067200000-uuid-example.txt';
const directUrl = await CaptivateChatFileManager.getSecureFileUrl(fileKey, 7200);
```

`getTranscript()` refreshes presigned URLs automatically when they are within five minutes of expiry, so transcript file links stay usable without extra work.

#### Convenience Methods

```typescript
const fileInput = await conversation.fileManager.create({
  file: file,
  fileName: 'document.pdf'
});

console.log('Filename:', fileInput.getFilename());
console.log('File type:', fileInput.getFileType());
console.log('Text content:', fileInput.getTextContent());

// Get the first file object if needed
const firstFile = fileInput.getFirstFile();

// Convert to files array explicitly (though not needed anymore)
const filesArray = fileInput.toFilesArray();
```

#### Multiple Files

**Option 1: `conversation.fileManager.createMultiple()` (Recommended)**

```typescript
const files = [file1, file2, file3];
const fileInput = await conversation.fileManager.createMultiple({
  files: files
  // storage defaults to true
});

await conversation.sendMessage({
  text: "Multiple documents attached",
  files: fileInput
});
```

**Option 2: Multiple files with developer storage**

```typescript
const files = [file1, file2, file3];
const urls = [
  'https://my-bucket.s3.amazonaws.com/file1.pdf',
  'https://my-bucket.s3.amazonaws.com/file2.pdf',
  'https://my-bucket.s3.amazonaws.com/file3.pdf'
];

const fileInput = await conversation.fileManager.createMultiple({
  files: files,
  storage: false,
  urls: urls  // Required when storage is false, and must match files.length
});

await conversation.sendMessage({
  text: "Multiple documents from my storage",
  files: fileInput
});
```

**Option 3: Manual processing**

```typescript
const files = [file1, file2, file3];
const fileInputs = await Promise.all(
  files.map(file => conversation.fileManager.create({ file }))
);

const allFiles = fileInputs.flatMap(input => input);

await conversation.sendMessage({
  text: "Multiple documents attached",
  files: allFiles
});
```

#### Alternative: Single File Factory Method

For simpler usage when you only need one file object:

```typescript
const fileObj = await conversation.fileManager.createFile({
  file: file,
  fileName: 'document.pdf'
});

await conversation.sendMessage({
  text: "Here's the document",
  files: fileObj  // 🎉 Direct usage - no array wrapping needed!
});

// Or with developer storage
const fileObjWithUrl = await conversation.fileManager.createFile({
  file: file,
  fileName: 'document.pdf',
  storage: false,
  url: 'https://my-bucket.s3.amazonaws.com/document.pdf'
});
```

#### Supported File Types

- **Documents**: PDF, DOCX, TXT, XLSX, CSV
- **Images**: PNG, JPG, JPEG (with OCR text extraction)
- **Any file type** supported by the file-to-text API

#### Message Payload Format

Files are sent in the following payload structure:

```json
{
  "action": "sendMessage",
  "event": {
    "event_type": "user_message",
    "socket_id": "current-socket-id",
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

The method resolves once the server confirms the edit in its HTTP response.

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

Listeners accumulate: calling `onMessage()` twice registers two callbacks and your handler runs twice per message. Remove individual callbacks with `off()`, or clear them all with `removeAllListeners()`.

```typescript
const handler = (message: string, type: string) => console.log(message);
conversation.onMessage(handler);
// ...later
conversation.removeAllListeners();
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

// Explicit soft delete
await conversation.delete({ softDelete: true });

// Hard delete (permanent - deletes everything including transcripts)
await conversation.delete({ softDelete: false });
```

**Delete Types:**
- **Soft Delete (default)**: Marks conversation as deleted but preserves data including transcripts for potential recovery
- **Hard Delete**: Permanently removes everything including transcripts, messages, and all associated data

### Retrieve User Conversations

Fetch a list of conversations associated with a specific user ID. This method supports both legacy (v1) and advanced (v2) usage with filter, search, and pagination. Both versions return the same response shape.

Returns `{ conversations: Conversation[]; pagination?: {...} }` — destructure it rather than treating the result as an array.

**Note:**
- `search` uses wildcard matching by default (e.g., "fred" matches "frederick", "alfred", etc.)
- `filter` uses exact matching only (e.g., "fred" only matches "fred")

**Legacy usage (v1) - String parameter (backward compatible):**
```typescript
const { conversations } = await api.getUserConversations('user123');
```

**Legacy usage (v1) - Options object:**
```typescript
const { conversations } = await api.getUserConversations({ userId: 'user123' });
```

**Advanced usage (v2, with filter and pagination):**
```typescript
const { conversations, pagination } = await api.getUserConversations({
  userId: 'user123',
  filter: { mode: 'dbfred' }, // exact match only
  pagination: { page: '1', limit: '10' }
});
```

**Advanced usage (v2, with search and pagination):**
```typescript
const { conversations, pagination } = await api.getUserConversations({
  userId: 'user123',
  search: { mode: 'fred' }, // wildcard match
  pagination: { page: '1', limit: '10' }
});
```

**Advanced usage (v2, with both filter and search):**
```typescript
const { conversations, pagination } = await api.getUserConversations({
  userId: 'user123',
  filter: { mode: 'dbfred' },
  search: { mode: 'fred' },
  pagination: { page: '1', limit: '10' }
});
```

As of v6.1.0 this returns cached instances when the API already holds a handle for a conversation, so listeners you registered earlier are preserved instead of being silently dropped.

### Multi-API-Key Support (CaptivateChatManager)

For advanced use cases where you need to fetch and interact with conversations across multiple API keys, use the `CaptivateChatManager` class. This manager handles multiple `CaptivateChatAPI` instances and ensures each `Conversation` uses the correct connection for its API key.

**Note:** Most users do not need this. Only use the manager if you need to aggregate or interact with conversations across multiple API keys.

**Key Features:**
- Automatically deduplicates API keys to prevent duplicate instances
- Leverages singleton pattern from CaptivateChatAPI
- Provides disposal methods for cleanup

**Option 1: Using the static factory method (Recommended)**
```typescript
import { CaptivateChatManager } from 'captivate-chat-api';

const apiKeys = [
  'YOUR_API_KEY_1',
  'YOUR_API_KEY_2',
  'YOUR_API_KEY_1' // Duplicate - automatically filtered out
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

// Cleanup when done
manager.disposeAll(); // Closes all WebSocket connections
```

**Option 2: Manual instantiation and connection**
```typescript
import { CaptivateChatManager } from 'captivate-chat-api';

const manager = new CaptivateChatManager(['YOUR_API_KEY_1', 'YOUR_API_KEY_2'], 'dev');
await manager.connectAll();

const { conversations } = await manager.getUserConversations({
  userId: '66f016f09d5961b684ce05f0',
  pagination: { page: '1', limit: '90' }
});
```

**Disposal Methods:**
```typescript
// Dispose single API instance
manager.dispose('YOUR_API_KEY_1');

// Dispose all instances
manager.disposeAll();
```

- Use `CaptivateChatAPI` for single-key scenarios.
- Use `CaptivateChatManager` for multi-key scenarios.

### Delete User Conversations

Delete all conversations for a specific user with optional soft delete:

```typescript
// Soft delete (default - safer option)
await api.deleteUserConversations('user123');

// Explicit soft delete
await api.deleteUserConversations('user123', { softDelete: true });

// Hard delete (permanent - deletes everything including transcripts)
await api.deleteUserConversations('user123', { softDelete: false });
```

**Delete Types:**
- **Soft Delete (default)**: Marks all user conversations as deleted but preserves data including transcripts for potential recovery
- **Hard Delete**: Permanently removes all user conversations including transcripts, messages, and all associated data

### Example: Full Workflow

```typescript
import { CaptivateChatAPI } from 'captivate-chat-api';

(async () => {
  try {
    // Create and connect to the API in one step
    const api = await CaptivateChatAPI.create('YOUR_API_KEY', 'prod');
    console.log('Connected to CaptivateChat API');

    // Create a conversation
    const conversation = await api.createConversation(
      'user123',
      { name: 'John Doe', email: 'john@example.com' },
      { role: 'admin' },
      'bot-first'
    );

    // Attach listeners immediately — the bot-first opener is already on its way
    conversation.onMessage((message, type) => {
      console.log(`Received (${type}): ${message}`);
    });

    conversation.onConversationUpdate((update) => {
      console.log('Conversation Update:', update);
    });

    // Send a text message
    await conversation.sendMessage('Hello! How can I assist you today?');

    // Send a file with text message
    const fileInput = await conversation.fileManager.create({
      file: file,
      fileName: 'document.pdf'
    });

    await conversation.sendMessage({
      text: "Here's the document you requested",
      files: fileInput
    });

    // Fetch the transcript
    const transcript = await conversation.getTranscript();
    console.log('Transcript:', transcript);

    // Get user conversations
    const { conversations } = await api.getUserConversations('user123');
    console.log('User Conversations:', conversations);

    // Delete the conversation (soft delete by default)
    await conversation.delete();

  } catch (error: any) {
    if (error.status === 429) {
      console.error('Rate limited — back off before retrying.');
    } else {
      console.error('Error:', error);
    }
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

### CaptivateChatAPI

#### Methods

- **`constructor(apiKey: string, mode?: 'prod' | 'dev', options?: CaptivateChatAPIOptions)`**
  Initializes the API with the given API key and mode. **Enforces singleton pattern:** returns the existing instance if one already exists for that API key/mode combination, in which case `options` is ignored.

- **`static create(apiKey: string, mode?: 'prod' | 'dev', options?: CaptivateChatAPIOptions): Promise<CaptivateChatAPI>`**
  Creates and connects an instance, returning a guarded proxy that checks the socket and auto-reconnects before network calls. **Enforces singleton pattern.**

- **`configure(options: CaptivateChatAPIOptions): void`**
  **(v6.1.0)** Updates timeouts and reconnection tunables on a live instance.

- **`static getInstance(apiKey: string, mode?: 'prod' | 'dev'): CaptivateChatAPI | undefined`**
  Gets an existing instance for the given API key and mode, if one exists.

- **`static hasInstance(apiKey: string, mode?: 'prod' | 'dev'): boolean`**
  Checks if an instance exists for the given API key and mode.

- **`static setDebugMode(enabled: boolean): void`** / **`static getDebugMode(): boolean`**
  Controls library logging. Warnings and errors are always printed.

- **`connect(): Promise<void>`**
  Connects to the WebSocket server. Concurrent callers share one handshake.

- **`reconnect(): Promise<void>`**
  Reconnects and re-binds every cached conversation to the new socket. Respects `maxReconnectAttempts`. Prefer this over `dispose()` + `create()` for recovery.

- **`isSocketActive(): boolean`**
  Returns true if the socket is open. Synchronous.

- **`getSocket(): WebSocket | null`** / **`getSocketId(): string | null`**
  Accessors for the current connection. Synchronous.

- **`createConversation(userId: string, userBasicInfo?: object, metadata?: object, autoConversationStart?: 'bot-first' | 'user-first', privateMetadata?: object, options?: { timeoutMs?: number }): Promise<Conversation>`**
  Creates a new conversation. Connects first if the socket is not active.

- **`getConversation(conversationId: string): Conversation`**
  Retrieves a conversation by ID, creating a local handle if not cached. **(v6.1.0)** No longer returns `void`.

- **`releaseConversation(conversationId: string): void`**
  **(v6.1.0)** Drops a conversation from the local cache and detaches its socket listener. Does not delete it server-side.

- **`getUserConversations(userIdOrOptions: string | { userId: string; filter?: object; search?: object; pagination?: { page?: string | number; limit?: string | number }; apiKeys?: string[] }): Promise<{ conversations: Conversation[]; pagination?: PaginationInfo }>`**
  Fetches conversations for a user. Uses the v2 API when `filter`, `search`, `pagination`, or `apiKeys` is provided.

- **`deleteUserConversations(userId: string, options?: { softDelete?: boolean }): Promise<void>`**
  Deletes all conversations for a user. `softDelete` defaults to `true`.

- **`dispose(): void`**
  Closes the WebSocket, detaches all conversation listeners, and removes the instance from the registry. Because instances are singletons, this affects the whole application.

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
  Updates private metadata (not visible to frontend), stored under the `private` key.

- **`getMetadata(): Promise<object>`**
  Returns metadata for the current conversation session.

- **`sendAction(actionId: string, data?: object): Promise<void>`**
  Sends a custom action to the conversation.

- **`editMessage(messageId: string, content: string | object): Promise<void>`**
  Edits a previously sent message. Resolves when the server confirms via HTTP response.

- **`getTranscript(): Promise<object[]>`**
  Retrieves the conversation transcript, refreshing any presigned file URLs that are near expiry.

- **`delete(options?: { softDelete?: boolean }): Promise<void>`**
  Deletes the current conversation. `softDelete` defaults to `true`.

- **`setTimeToLive(days: 1 | 7 | 30 | 90): Promise<void>`**
  Sets the default TTL for file uploads in this conversation and stores it in metadata.

- **`getConversationId(): string`**
  Returns the conversation ID.

- **`restartListeners(): void`**
  **(v6.1.0)** Re-binds this conversation to the current socket. Idempotent; called automatically after a reconnect.

- **`detachListeners(): void`**
  **(v6.1.0)** Detaches the socket listener. Call when discarding an instance.

- **`off(eventType: string, callback: Function): void`** / **`removeAllListeners(): void`**
  **(v6.1.0)** Removes registered event callbacks.

#### Events

- **`onMessage(callback: (message: string, type: string) => void): void`**
  Listens for new messages. `type` is `'ai_agent'`, `'human_agent'`, or `'error'`.

- **`onError(callback: (error: any) => void): void`**
  Listens for errors.

- **`onConversationUpdate(callback: (update: any) => void): void`**
  Listens for updates to the conversation.

- **`onActionReceived(callback: (actions: [Action]) => void): void`**
  Handles custom actions received during the conversation.

---

### CaptivateChatFileManager

A utility class for processing files and converting them to text for chat messages.

#### Methods

- **`static create(options: { file: File | Blob; fileName?: string; fileType?: string; storage?: boolean; url?: string; ttlDays?: TtlDays }): Promise<CaptivateChatFileManager>`**
  Creates a `CaptivateChatFileManager` from a local file with automatic text extraction. `storage` defaults to `true`.

- **`static createFile(options: { ... }): Promise<FileObject>`**
  Creates a single file object directly (no wrapper).

- **`static createMultiple(options: { files: (File | Blob)[]; storage?: boolean; urls?: string[]; ttlDays?: TtlDays }): Promise<CaptivateChatFileManager>`**
  Processes multiple files in parallel into one manager.

- **`getFilename(): string | undefined`** — filename of the first file.
- **`getTextContent(): string`** — extracted text of the first file.
- **`getFileType(): string | undefined`** — MIME type of the first file.
- **`getFirstFile(): FileObject | undefined`** — first file object.
- **`toFilesArray(): FileObject[]`** — the files array, explicitly.
- **`refreshSecureUrl(expiresIn?: number): Promise<string | undefined>`** — refreshes the presigned URL for the first file.
- **`static getSecureFileUrl(fileKey: string, expiresIn?: number): Promise<string>`** — generates a secure URL from a file key.

#### Properties

- **`type: 'files'`** — always `'files'`
- **`files: FileObject[]`** — array of processed file objects
- **`length: number`** — length of the files array

#### Array-like Behavior

```typescript
const fileInput = await conversation.fileManager.create({ file });

files: fileInput           // ✅ Direct usage
files: fileInput.files     // ✅ Traditional usage (still supported)
fileInput[0]               // ✅ Array access
fileInput.length           // ✅ Array length
```

#### FileObject Structure

**Service Storage (`storage: true`):**
```typescript
{
  filename: string;
  type: string;
  file: File | Blob;
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

**Developer Storage (`storage: false`):**
```typescript
{
  filename: string;
  type: string;
  file: File | Blob;
  url: string;               // Required when storage is false
  textContent: { /* as above */ };
}
```

---

### CaptivateChatManager

- **`constructor(apiKeys: string[], mode?: 'prod' | 'dev', options?: CaptivateChatAPIOptions)`**
  Creates one singleton API instance per unique key.

- **`static create(apiKeys: string[], mode?: 'prod' | 'dev', options?: CaptivateChatAPIOptions): Promise<CaptivateChatManager>`**
  Creates and connects all instances.

- **`connectAll(): Promise<void>`** — connects every instance.
- **`getUserConversations(options): Promise<{ conversations: Conversation[]; pagination?: PaginationInfo }>`** — aggregates across keys.
- **`getApiInstance(apiKey: string): CaptivateChatAPI | undefined`**
- **`dispose(apiKey: string): void`** / **`disposeAll(): void`**

## Interfaces

```typescript
interface Action {
  id: string;
  data: any;
}

interface CaptivateChatAPIOptions {
  connectTimeoutMs?: number;            // default 10000
  conversationStartTimeoutMs?: number;  // default 20000
  maxReconnectAttempts?: number;        // default 5
  reconnectDelay?: number;              // default 3000
}

interface PaginationInfo {
  hasNextPage: boolean;
  hasPrevPage: boolean;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

type TtlDays = 1 | 7 | 30 | 90;
```

## Troubleshooting

**`410 Gone` from the server, or replies that never arrive.**
Fixed in v6.1.0. Conversations now read `socket_id` live instead of capturing it, so a reconnect no longer strands them. If you are on an older version, recreate conversations after every reconnect.

**Only one conversation receives messages.**
Fixed in v6.1.0. Listeners were assigned to `socket.onmessage`, so each new conversation overwrote the previous one's handler.

**`Timeout: No conversation_start_success received from WebSocket`, but the conversation exists.**
Fixed in v6.1.0. The timer was never cleared and fired even after success. If you still see this on the current version, the backend genuinely exceeded the deadline — raise `conversationStartTimeoutMs`.

**`Failed to fetch` with a CORS error in the console.**
Often a rate-limited (`429`) response served without CORS headers. The status is visible in DevTools but not readable from JavaScript. Check your request volume before assuming a CORS misconfiguration.

**Messages stop arriving after a few minutes of inactivity.**
The socket was closed by an idle timeout. Poll `isSocketActive()` and call `reconnect()` — see [Connection Lifecycle](#connection-lifecycle).

**Handlers firing twice.**
`onMessage()` and friends append; calling them again adds another callback. Use `off()` or `removeAllListeners()`.

## Development

Node 20.15 or later.

```bash
npm install
npm run typecheck   # src and test, with tsconfig.test.json
npm test            # builds the tests into build-test/, then runs them with node --test
npm run build       # webpack: dist/captivate-chat-api.js and its type files
```

`npm test -- connection` runs only the test files whose path holds `connection`. The tests never reach a server: `test/fakes/` holds a WebSocket, a fetch, an XMLHttpRequest and storage that the tests answer by hand, and a console that keeps what the library logs (`TEST_LOGS=1 npm test` prints it too).

`test/core/` covers today's path through Captivate's gateway: the socket's address, connecting and the guard that reconnects, `dispose`, the HTTP envelope and its errors, the messages a conversation hears (with a reply too big for the socket, fetched from its link), creating a conversation and a user's list. They pass before and after every change. Two are marked todo: issues in that path found while writing them, left as they are for now:

- a conversation handle from `getConversation` or the list keeps hearing the socket after `releaseConversation`, `deleteUserConversations` or `dispose`;
- `dispose()` on an instance from `CaptivateChatAPI.create` whose socket has already closed leaves a rejected promise nobody handles.

Before a release, `test-e2e-chat.html` is also run by hand against the dev gateway, with a dev key.
