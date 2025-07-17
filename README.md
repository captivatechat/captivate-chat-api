# captivate-chat-api

WebSocket-based chat API for real-time conversations with support for bot and human agents.

## Installation

Install the package using npm:

```bash
npm install captivate-chat-api
```

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

### Send and Receive Messages

1. Send a message to the conversation:
   ```typescript
   await conversation.sendMessage('Hello!');
   await conversation.sendMessage({type:'files',files:[{filename:'test.pdf'}]});
   ```

2. Listen for responses:
   ```typescript
   conversation.onMessage((message, type) => {
     console.log(`${type}: ${message}`);
   });
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

Delete the current conversation

```typescript
const transcript = await conversation.delete();
console.log('Deleted conversation');
```


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

**Example:**
```typescript
import { CaptivateChatManager } from 'captivate-chat-api';

const apiKeys = [
  'T7Q00YH-KJCMD00-HEST4R9-8ADH9RQ',
  'P1QRBUN-HMCMZ1A-K97C3KV-501BQTE'
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

Delete list of conversations associated with a specific user ID:

```typescript
const conversations = await api.deleteUserConversations('user123');
console.log('Conversations Deleted successfully');
/*
 Throws error if failed
 */
```


### Example: Full Workflow

Here's a complete example of how to use the API:

```typescript
import { CaptivateChatAPI } from 'captivate-chat-api';

(async () => {
  try {
    const api = new CaptivateChatAPI('YOUR_API_KEY', 'prod');

    // Connect to the API
    await api.connect();
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

    // Send a message
    await conversation.sendMessage('Hello! How can I assist you today?');

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

    // Delete the conversation
    await conversation.delete();
    console.log('Conversation deleted successfully.');

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

## API Reference

### CaptivateChatAPI

#### Methods
- **`constructor(apiKey: string, mode: 'prod' | 'dev' = 'prod')`**  
  Initializes the API with the given API key and mode.
  
- **`connect(): Promise<void>`**  
  Connects to the WebSocket server.

- **`createConversation(userId: string, userBasicInfo?: object, userData?: object, autoConversationStart?: 'bot-first' | 'user-first'): Promise<Conversation>`**  
  Creates a new conversation.

- **`getConversation(conversationId: string): Conversation`**  
  Retrieves an existing conversation by its ID.

- **`getUserConversations(userIdOrOptions: string | { userId: string; filter?: object; search?: object; pagination?: { page?: string | number; limit?: string | number }; apiKeys?: string[] }): Promise<Conversation[]>`**  
  Fetches a list of conversations associated with the given user ID. Supports backward compatibility with string parameter or options object. If `filter`, `search`, `pagination`, or `apiKeys` is provided, uses the v2 API for advanced querying. Both `filter` and `search` parameters are supported for different querying needs. The `apiKeys` parameter allows grouping conversations by API key. Returns Conversation Object

- **`deleteUserConversations(userId: string): Promise<void>`**  
  Deletes all conversations associated with the given user ID
---

### Conversation

#### Methods
- **`sendMessage(content: string): Promise<void>`**  
  Sends a message to the conversation.

- **`sendMessage(content: object): Promise<void>`**  
  Can also send custom payload instead of default string

- **`setMetadata(metadata: object): Promise<void>`**  
  Updates metadata for the conversation.

- **`getMetadata(): Promise<object>`**  
  Returns the metadata for that current conversation session

- **`sendAction(actionId: string, data?: object): Promise<void>`**  
  Sends a custom action to the conversation.

- **`editMessage(messageId: string, content: string | object): Promise<void>`**  
  Edits a previously sent message in the conversation. Resolves when the edit is confirmed by the server.

- **`getTranscript(): Promise<object[]>`**  
  Retrieves the conversation transcript.

- **`delete(): Promise<void>`**  
  Deletes the current conversation
  


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