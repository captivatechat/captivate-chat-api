# captivate-chat-api

WebSocket-based chat API for real-time conversations with support for bot and human agents.

## Installation

```bash
npm install captivate-chat-api
```

## Usage

### Basic Setup

```typescript
import { CaptivateChatAPI } from 'captivate-chat-api';

const api = new CaptivateChatAPI('YOUR_API_KEY');
await api.connect();
```

### Create a Conversation

```typescript
// Basic conversation
const conversation = await api.createConversation('user123');

// With user info
const conversation = await api.createConversation(
  'user123',
  {
    name: 'John Doe',
    email: 'john@example.com'
  },
  {
    customField: 'value'
  }
);
```

### Send Messages

```typescript
// Send a message
await conversation.sendMessage('Hello!');

// Listen for responses
conversation.onMessage((message, type) => {
  console.log(`${type}: ${message}`);
});
```

### Handle Events

```typescript
// Listen for errors
conversation.onError((error) => {
  console.error('Error:', error);
});

// Listen for updates
conversation.onConversationUpdate((update) => {
  console.log('Update:', update);
});

// Handle actions
conversation.onActionReceived((id, data) => {
  console.log(`Action ${id}:`, data);
});
```

### Get Conversation History

```typescript
const transcript = await conversation.getTranscript();
```

### Development Mode

```typescript
const api = new CaptivateChatAPI('YOUR_API_KEY', 'dev');
```

## Environment Support
- Browser
- Node.js
- React Native

## API Reference

### CaptivateChatAPI
- `constructor(apiKey: string, mode: 'prod' | 'dev' = 'prod')`
- `connect(): Promise<void>`
- `createConversation(userId: string, userBasicInfo?: object, userData?: object, autoConversationStart?: 'bot-first' | 'user-first'): Promise<Conversation>`
- `getConversation(conversationId: string): Conversation`

### Conversation
- `sendMessage(content: string): Promise<void>`
- `setMetadata(metadata: object): Promise<void>`
- `sendAction(actionId: string, data?: object): Promise<void>`
- `getTranscript(): Promise<object[]>`
- `onMessage(callback: (message: string, type: string) => void): void`
- `onError(callback: (error: any) => void): void`
- `onConversationUpdate(callback: (update: any) => void): void`
- `onActionReceived(callback: (id: string, data: any) => void): void`
