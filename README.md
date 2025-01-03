
# Captivate Chat API

This repository contains the `CaptivateChatAPI` wrapper that allows you to manage conversations through WebSocket connections in a variety of environments, including browser-based React/React Native projects as well as Node.js environments. It is designed to be simple to use while allowing flexibility in the way messages and conversations are handled.

## Features

- **WebSocket-based Communication**: Connects to the Captivate Chat WebSocket server.
- **Conversation Management**: Create, manage, and retrieve conversations.
- **Browser & Node.js Support**: Automatically determines the appropriate WebSocket implementation for different environments.
- **Flexible Modes**: Supports both 'bot-first' and 'user-first' conversation initiation.
- **Built for React & React Native**: Works seamlessly in both React and React Native projects.
  
## Installation

You can install the package via npm or yarn.

### npm

```bash
npm install captivate-chat-api
```

### yarn

```bash
yarn add captivate-chat-api
```

## Usage

### Importing the API

```javascript
import { CaptivateChatAPI } from 'captivate-chat-api';
```

### Example Usage

```javascript
import { CaptivateChatAPI } from 'captivate-chat-api';

// Replace with your actual API key
const apiKey = 'your-api-key';

// Create an instance of the CaptivateChatAPI
const captivateChatAPI = new CaptivateChatAPI(apiKey);

// Connect to WebSocket
captivateChatAPI.connect()
  .then(() => {
    console.log('Connected to CaptivateChat API!');
  })
  .catch(err => {
    console.error('Error connecting to CaptivateChat API:', err);
  });

// Create a new conversation
captivateChatAPI.createConversation('user-id', { name: 'John Doe' })
  .then(conversation => {
    console.log('Conversation started with ID:', conversation.id);
  })
  .catch(err => {
    console.error('Error creating conversation:', err);
  });
```

### Methods

#### `connect()`

Establishes a WebSocket connection to the Captivate Chat server.

```javascript
captivateChatAPI.connect()
  .then(() => {
    console.log('Connected');
  })
  .catch(err => {
    console.error('Error connecting:', err);
  });
```

#### `createConversation(userId, userBasicInfo, userData, autoConversationStart)`

Starts a new conversation. You can specify whether the conversation should be bot-first or user-first.

- **userId**: Unique identifier for the user.
- **userBasicInfo**: An object containing basic user information (e.g., name, email).
- **userData**: Additional optional user data.
- **autoConversationStart**: Can be either `'bot-first'` or `'user-first'`.

Returns a `Conversation` instance.

```javascript
captivateChatAPI.createConversation('user-id', { name: 'John Doe' })
  .then(conversation => {
    console.log('Conversation started with ID:', conversation.id);
  })
  .catch(err => {
    console.error('Error creating conversation:', err);
  });
```

#### `getConversation(conversationId)`

Retrieves an existing conversation by its ID. If the conversation does not exist, a new one will be created.

```javascript
const conversation = captivateChatAPI.getConversation('existing-conversation-id');
```

## Supported Environments

- **Browser**: React, React Native (using `react-native-websocket`)
- **Node.js**: Native WebSocket support or `ws` library for server-side environments.

## Contributing

We welcome contributions! Please fork the repository, make your changes, and submit a pull request. Ensure that your code follows the existing style and includes tests where applicable.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
