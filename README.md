
# captivate-chat-api

WebSocket-based chat API for real-time conversations with support for bot and human agents.

## Installation

Install the package using npm:

```bash
npm install captivate-chat-api
```

## Usage

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
   ```

2. Listen for responses:
   ```typescript
   conversation.onMessage((message, type) => {
     console.log(`${type}: ${message}`);
   });
   ```

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
   conversation.onActionReceived((id, data) => {
     console.log(`Action ${id}:`, data);
   });
   ```

### Get Conversation History

Retrieve the transcript of a conversation:

```typescript
const transcript = await conversation.getTranscript();
console.log('Transcript:', transcript);
```

### Retrieve User Conversations

Fetch a list of conversations associated with a specific user ID:

```typescript
const conversations = await api.getUserConversations('user123');
console.log('User Conversations:', conversations);
```

### Example: Full Workflow

Here’s a complete example of how to use the API:

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

- **`getUserConversations(userId: string): Promise<Conversation>`**  
  Fetches a list of conversations associated with the given user ID.

---

### Conversation

#### Methods
- **`sendMessage(content: string): Promise<void>`**  
  Sends a message to the conversation.

- **`setMetadata(metadata: object): Promise<void>`**  
  Updates metadata for the conversation.

- **`sendAction(actionId: string, data?: object): Promise<void>`**  
  Sends a custom action to the conversation.

- **`getTranscript(): Promise<object[]>`**  
  Retrieves the conversation transcript.

#### Events
- **`onMessage(callback: (message: string, type: string) => void): void`**  
  Listens for new messages.

- **`onError(callback: (error: any) => void): void`**  
  Listens for errors.

- **`onConversationUpdate(callback: (update: any) => void): void`**  
  Listens for updates to the conversation.

- **`onActionReceived(callback: (id: string, data: any) => void): void`**  
  Handles custom actions received during the conversation.
