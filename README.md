# captivate-chat-api

Hybrid WebSocket/REST-based chat API for real-time conversations with support for bot and human agents. Features WebSocket communication for real-time messaging and REST endpoints for data retrieval operations.

## Installation

Install the package using npm:

```bash
npm install captivate-chat-api
```

## What's New

### Conversation details in the list (v7.1.1)

7.1.1 keeps each conversation's details up to date in the list. Since 7.1.0, `getUserConversations()` gives back the conversation an app already holds, so its listeners stay attached. That conversation now also takes the list's metadata and key, as a fresh one did in 7.0.0, so a chat created or opened earlier shows its title and the details kept in its metadata (pinned messages, say) after the next list and after a reconnect. `CaptivateChatManager.getUserConversations()` does the same for every key it lists. A conversation from `createConversation()` holds the metadata it was created with, without the private metadata, which the server doesn't give back.

Four more things are put right, each one back as 7.0.0 had it or as this README says:

- **`off()` works on a core key.** `off('bot_message', callback)` removes the callback you gave `onMessage()` (and with it the same call's live chat and error listeners); `off('action', …)`, `off('conversation_update', …)` and `off('general_error', …)` do the same for `onActionReceived()`, `onConversationUpdate()` and `onError()`. Before, it removed nothing.
- **A conversation ignores a reply that names another conversation.** The gateway puts the conversation's ID in each reply, so with several conversations on one connection, each one's `onMessage` now hears its own replies only. A reply that names none is still heard by all.
- **`deleteUserConversations(userId)` leaves your conversations as they are.** In 7.1.0 it also stopped every conversation of the instance hearing replies, other users' included.
- **A failed request's message is 7.0.0's again**, for example "Failed to send message via HTTP: HTTP request failed: 500 Internal Server Error", without the server's own words, which an app might show to its users. They are on `error.body`, and the status on `error.status`.

### Blue mode (v7.1.0)

A key for your app from Vienna Blue's Channels page (`vba_…`) makes the same library talk to a Blue bot, with the answer shown while it's written in browsers, React Native and Electron, and a key for your own server (`vbk_…`) talks for each of your server's users. Every other key keeps Captivate's gateway, unchanged. See [Blue mode](#blue-mode).

### Connection Reliability (v7.1.0)

This release fixes a group of connection bugs that could cause dropped messages, `410 Gone` responses from the server, duplicate conversations, and spurious timeouts. **No code changes are required** — every fix is backward compatible except one narrowed return type (see [Migration](#migration-to-v710)).

**Conversations now follow reconnects.** A `Conversation` used to capture the WebSocket and `socket_id` at construction. Both are replaced whenever the API reconnects, so any conversation created beforehand kept sending requests stamped with a closed connection id — the server then had nowhere to deliver the reply and returned `410 Gone`. Conversations now read the connection live from the owning `CaptivateChatAPI`.

**Multiple conversations can share one socket.** Listeners were attached with `socket.onmessage = ...`, and a socket has only one `onmessage` slot. Each new `Conversation` silently destroyed the previous one's handler — and the API's own handler, which is what refreshes `socket_id`. Everything now uses `addEventListener`, so handlers coexist and `getUserConversations()` returns conversations that all actually receive messages.

**`createConversation` no longer times out on success.** Its timeout was armed before the request and never cleared, so a response arriving near the deadline would resolve the listener *and* reject the promise: the conversation existed, was cached, and had its opening message sent, while the caller saw a timeout and retried — creating a second real conversation server-side. The timer is now cleared on settle, and the timeout is configurable (default raised from 10s to 20s).

**Bot-first conversations resolve sooner.** `createConversation` used to wait for the bot-first opening message to round-trip before resolving. It now resolves as soon as the conversation exists and dispatches the opener in the background. A failure there is logged rather than failing the whole creation.

**Reconnects re-bind existing conversations.** `connect()` creates a brand-new WebSocket, which previously left every cached conversation listening on the dead one — inbound messages stopped arriving even though the connection looked healthy. `reconnect()` now moves them across.

**Automatic reconnection respects the attempt limit.** An unexpected close used to call `connect()` directly on a timer, bypassing `maxReconnectAttempts` entirely and looping indefinitely against a failing endpoint. It now routes through `reconnect()`, and stops after `dispose()`.

**A connect that times out leaves nothing behind.** Core's gateway sometimes opens a socket and never sends `socket_connected`. The timed-out socket used to stay open as the instance's socket, still counted as active and still carrying the old connection's `socket_id`, so sends went through and their replies were lost without a word, and a second `create()` handed back that same dead instance. Now the socket is closed, its id cleared, and `isSocketActive()` is `false`, so the next `create()`, `reconnect()` or guarded call connects again.

**A socket counts as active only once it has its id.** `isSocketActive()` is `true` when the socket is open *and* `socket_connected` has named its id, since replies can't reach a socket without one. A socket's id is cleared the moment the socket is replaced or given up.

**Every reconnect gets its own tries.** After one failed round of `maxReconnectAttempts` tries, every later `reconnect()`, including the guard's and the automatic one, used to fail at once with "Max reconnection attempts (N) reached", and the instance could only recover through `dispose()` and `create()`. Each `reconnect()` now starts a fresh round of up to `maxReconnectAttempts` tries; calls made while a round is running share it.

**Debug logs and errors never show a core key.** With `setDebugMode(true)`, an instance is named in the logs by the key's last 4 characters (or a short hash, for a key under 16 characters), never by the key. `CaptivateChatManager`'s error for a conversation whose key it doesn't hold names the key the same way. A Blue app key (`vba_…`), whose id is the whole key, is named `vba_…` and its last 4 characters too; a server key by its id alone.

**A handle's JSON leaves the key out.** `JSON.stringify` of a conversation, of the instance or of a list of conversations used to hold a core key, twice: the key itself and the socket's address, which carries it as `?apiKey=`. An app that logged or reported a handle sent its key along. The key, the address and the sockets are now left out of what `JSON.stringify` and `console.log` list, as they already were for Blue's keys; the library still uses them. The same holds for a `CaptivateChatManager`, which files its instances under their core keys, and for a Blue conversation, which holds its user's secret, ID and token.

**Core mode works on Node 20.** Node 20 has no WebSocket of its own, so the library uses the `ws` package there, but the one built file was made for browsers and held `ws`'s browser stand-in: `create()` failed at once with "ws does not work in the browser" (7.0.0 too). The package now has two built files: `dist/captivate-chat-api.node.js`, which Node loads (`main`) and which uses the installed `ws`, and `dist/captivate-chat-api.js`, which browsers, React Native and bundlers for them load (`browser`) and script tags use, as before. Node 22 and later use their own WebSocket either way. A build checks that the Node file connects without a global WebSocket.

**`import { CaptivateChatAPI } from 'captivate-chat-api'` works in a Node ES module.** In a `.mjs` file or an app with `"type": "module"`, Node's build used to give a default export only, so a named import failed with "Named export 'CaptivateChatAPI' not found". The Node build now exports each name in a form Node reads, and `npm run build` imports the built file as a module to check it. `require()` and bundlers are as before.

**`files: fileInput` sends a list.** The README has long shown `files: fileInput`, with the file manager used directly, but the message carried the file manager object, not its list of files. The agent then answered "Sorry, I am currently not able to answer your query." and the file was missing from the transcript. The file manager now writes its list of files wherever JSON is made, so `files: fileInput` and `files: fileInput.files` send the same thing. This is core's file manager; Blue's files were not affected.

**`fileInput[0]` and spreading a file manager give its files.** Both gave `undefined`: an index reaches the file manager as a string (`'0'`), and the file manager only answered a number. `[...fileInput]` and `for (const file of fileInput)` now give the file objects.

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

**Correct proxy behaviour.** Instances returned by `create()` are wrapped in a guard that reconnects before network calls. `getSocketId()`, `getConversation()`, and `dispose()` were being wrapped by mistake — the first two returned Promises that contradicted their type declarations, and disposing a dead instance reconnected it first. All three are now excluded, and so are `configure()` and `releaseConversation()`: on an instance whose socket had closed, `configure()` reconnected with the settings it was about to change before changing them, and a failed reconnect left an error nobody could catch.

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

Because sends go out over HTTP carrying the current `socket_id`, and the server pushes the reply back down the WebSocket, an outbound request is only deliverable while that socket is alive. This is why the connection fixes in v7.1.0 matter — see [Connection Lifecycle](#connection-lifecycle).

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

## Migration to v7.1.0

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

`onMessage`'s types now say what really arrives. The content was always passed on as the gateway sends it, a list of parts (`[{ type: 'text', text }]`) from the bot or a live agent and a string only for an error, but it was typed as `string`. Nothing changed at run time, and a callback typed `(message: string, type: string)` still compiles; see [Send and Receive Messages](#send-and-receive-messages).

If you wrote a workaround for the timeout-on-success bug (watching the raw socket for `conversation_start_success` and adopting the conversation yourself), it is now dead code and can be removed.

### Upgrading to 7.1.1

From 7.1.0, nothing to change: 7.1.1 keeps each conversation's details up to date in the list ([What's New](#conversation-details-in-the-list-v711)). From 6.x or 7.0.0, move straight to 7.1.1, as below.

**One thing to check if your app registers listeners every time it opens a chat.** On 7.0.0, listing or opening a chat silenced the handle you had before, so an app could call `onMessage()` on each new handle and hear each reply once. Handles now keep their listeners, so a second `onMessage()` on the same conversation runs both callbacks. Register once for each conversation, or take the old one off first: `conversation.off('bot_message', callback)`, or `conversation.removeAllListeners()` when the screen closes.

### Upgrading from 6.x or 7.0.0 to 7.1.0

Compared with 7.0.0's published type declarations, 7.1.0's public API only adds. **An app that compiled and ran on 7.0.0 needs no change to its code to move to 7.1.0.** What differs, so you can check your own app against it:

| | 7.0.0 | 7.1.0 |
| --- | --- | --- |
| `getConversation(id)` | `Conversation \| void` | `Conversation` (null checks still compile) |
| `deleteUserConversations(...)` | `Promise<void>` | `Promise<void \| { deleted: number; busy: number }>`; core keys still resolve with nothing. Only code that assigns the result to a `Promise<void>` variable needs a change |
| `createConversation`, `getConversation`, the constructors and `create()` of `CaptivateChatAPI` and `CaptivateChatManager` | as before | extra optional arguments (`options`, `userId`, `metadata`) |
| `new Conversation(...)` | `socket: WebSocket` | `socket: WebSocket \| null`, more optional arguments |
| new | | `configure()`, `releaseConversation()`, `forgetUser()`, `stop()`, `resume()`, `onDelta()`, `onAnswer()`, `onStep()`, `detachListeners()`, `off()`, `removeAllListeners()`, `isBlueKey`, `renumber` and the Blue mode types |
| `main` in package.json | the browser file | the Node build, for Node; browsers, React Native and bundlers for them keep the browser file through `browser` |
| files in the package | the source, `index.html` and test pages as well | `dist`, this README and the licence only: import `captivate-chat-api`, not a path into its source |
| dependencies | `ws` and `react-native-websocket` (which the library never used) | `ws` |
| Node | no limit stated | 20.15 and later |

From 6.x there are two more differences, both made in 7.0.0: the static `CaptivateChatFileManager.setTimeToLive(apiKey, conversationId, days)` is gone (call `conversation.setTimeToLive(days)`), and `Conversation.updateSocket(...)` is gone (the library re-binds conversations itself after a reconnect).

What an upgrading app may notice at run time, none of it needing a change:

- **The bot's greeting arrives.** In the default `'bot-first'` mode the greeting used to reach the socket before `createConversation` had resolved, so no listener could hear it, and it was lost. It now goes to `onMessage` on the next tick. An app that showed a greeting of its own, or worked around the loss ([below](#staying-on-6x-or-700-for-now)), may now show two: drop its own, or keep creating chats `'user-first'`.
- **Listing, opening or starting other chats no longer silences the open one.** Each conversation has its own listener. A workaround that registers a listener again after those calls is no longer harmless: each call adds another callback to the same conversation, so remove the workaround, or `off()` the old callback first (see [Upgrading to 7.1.1](#upgrading-to-711)).
- **A chat keeps working after a reconnect and after the gateway's idle close.** On 7.0.0 it did not. See [Connection Lifecycle](#connection-lifecycle) for what the library does and does not reconnect by itself.
- **Objects that are logged no longer carry keys, secrets or tokens.** If your app read one of them from a handle's JSON, it can't any more; take it from where your app got it.
- **After `dispose()`, an instance says so.** Its calls and `connect()` throw "This CaptivateChatAPI instance has been disposed. Create a new one.", as this README has always said to do: create a new instance.

## Staying on 6.x or 7.0.0 for now

Move to 7.1.0 when you can: every fix below is in it. Until then, on 6.0.1 and 7.0.0 with a core key, three bugs lose bot replies without an error, and a fourth, in 7.0.0 alone, does too.

**The bot's greeting is lost** (6.x and 7.0.0, `'bot-first'`, the default). Create the conversation `'user-first'`, attach your listener, then send the first message yourself; the bot's reply to it arrives as usual.

```typescript
const conversation = await api.createConversation(userId, {}, {}, 'user-first');
conversation.onMessage((message, type) => show(message, type));
await conversation.sendMessage(''); // or the user's first words
```

**Listing or opening chats silences the open one** (6.x and 7.0.0). Replies still reach the browser, but go to a copy of the chat that nobody listens to. After any `getUserConversations()`, `getConversation()` or `createConversation()`, register a listener again on the chat being shown, for example `conversation.onError(() => {})`; any listener will do.

**After a dropped connection, or the gateway's idle close, the chat is deaf** (7.0.0 only; 6.0.1 recovers). The gateway closes a connection left idle for about 10 minutes, and the library reconnects but the chat keeps sending with the old connection's id, so replies never arrive and nothing is reported. Reopen the chat after every drop: once `isSocketActive()` is `true` again, get a fresh handle for the conversation with `getUserConversations()` and attach your listeners to it. Or go back to 6.0.1 until you can move to 7.1.0.

**Sending files** (every 6.x and 7.0.0 version). If `files: fileInput` gets "Sorry, I am currently not able to answer your query.", send `files: fileInput.files` instead.

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

## Blue mode

The same library talks to a Vienna Blue bot when it is given a key for your app from Blue's Channels page (`vba_` and 24 letters and digits). The key picks the mode when the instance is made; every other key keeps the path through Captivate's gateway described in the rest of this README, unchanged.

```typescript
const api = await CaptivateChatAPI.create('vba_…', 'prod');
```

In Blue mode no socket is opened: `connect()` and `reconnect()` resolve at once, `isSocketActive()` is true until `dispose()`, and `getSocket()` and `getSocketId()` return `null`. Each call is one HTTPS request to Blue, which waits at most 30 seconds (an answer being written has its own time).

### Keys

| Key | What happens |
|---|---|
| `vba_…`, a key for your app | Blue mode |
| `vbw_…`, a website key | Refused: "Website keys work only in Blue's own chat window. Make a key for your app on the Channels page." |
| `vbk_…`, a whole server key | Server mode, on your own server alone: see [On your own server](#on-your-own-server). In an app, a web page or a browser worker it is refused: "Server keys work only on your own server, never in an app or a web page. Make a key for your app on the Channels page, and if this key was ever in an app or a page, get a new one there." |
| `vbk_…` cut short | Refused: "This server key isn't whole. Copy it again from the Channels page." |
| Any other `vb…_` key | Refused: "This key isn't for apps. Make a key for your app on the Channels page." |
| Anything else | Captivate's gateway, as before |

`isBlueKey(key)` (exported) tells you whether a key is shaped like one of Blue's.

### Options

Given when the instance is made, beside the tunables above, or later with `configure()`. All are optional and read for Blue's keys alone.

| Option | What it is |
|---|---|
| `blueUrl` | Blue's address. `prod` uses `https://vienna-blue-backend.prod.captivat.io`, `dev` `https://vienna-blue-backend.dev.captivat.io` |
| `fetch` | A fetch to use in place of the global one: `expo/fetch`, Electron's `net.fetch` or a polyfill |
| `stream` | How answers are read: `"auto"` (the default), `"fetch"`, `"xhr"` or `"whole"` |
| `storage` | Where each user's secret is kept: `{ get, set, remove }`, or an object with `getItem`, `setItem` and `removeItem` (React Native's AsyncStorage, as it is); each may return a Promise. `localStorage`, else memory, without it. A store that fails is left for memory |
| `randomValues` | `(bytes: Uint8Array) => Uint8Array`, a secure random source where `crypto.getRandomValues` is missing (React Native: `expo-crypto`). Without either, the instance isn't made: "Blue mode needs a secure random source here. Add one, or pass options.randomValues." |
| `userSecret` | `(userId) => string \| Promise<string>`: the user's secret from your own server, so a user has one list on every device |

### How answers are read

An answer comes back while it is written, as one line of JSON an event. How the library reads it is picked before the message goes out, since a request that was sent can't be read again:

| Runtime | How it reads | The answer while it's written |
|---|---|---|
| Browsers, Electron (its windows and its main process, with Node's `fetch` or `options.fetch: net.fetch`), Node 20.15 and later, Deno, Bun; React Native with `expo/fetch` (Expo SDK 52 and later) passed as `options.fetch` | `fetch` and its response's body | Yes |
| React Native's own `fetch`, Capacitor, older browsers | `XMLHttpRequest` | Yes |
| Anything else | `fetch`, the response read whole | No: the same events, all at the end |

`options.stream` (`"fetch"`, `"xhr"` or `"whole"`) overrides the pick. Where `TextDecoder` is missing (Hermes), the library decodes the bytes itself. The answer shows while it's written only when the bot's AI writes it that way too: an organization's own AI that doesn't stream gives the whole answer at the end, whichever way it is read.

The connection counts as cut when its headers don't come within 30 seconds, when nothing at all comes for 45 seconds while it is open (Blue sends a blank line every 15 seconds to keep it busy), when a body read whole hasn't ended 330 seconds after the message was sent, when it ends before the answer does, or when a line is over 1 MB (or, through `XMLHttpRequest`, the whole body over 2 MB). A cut message is never sent again: the answer goes on in Blue, and the library reads it back. There is no other time limit, since an answer may take up to 300 seconds.

### Runtimes

- **A web app** lists its address on the key, as the browser sends it in `Origin`: scheme, host and port (`https://app.example.com`, `http://localhost:5173`).
- **Electron.** A window on a dev server lists that address. A packaged app's pages need an address too: register the app's own scheme before the app is ready, and list `app://myapp` on the key, exactly as written:

  ```javascript
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
  ```

  A `file://` page, or a scheme registered without those privileges, sends an `Origin` of `null`, which no key can list. The library writes one console warning there ("This app's pages aren't on a web address, so the key can't check where they are. Use the library from the app's main process, or register the app's own scheme and list its address on the key."), and such an app uses the library from its main process. The main process sends no `Origin`, so the key needs no address for it; it reads answers with Node's `fetch`, or with Electron's own network (its proxy settings) given `fetch: net.fetch`. Its users' secrets are kept in memory unless `options.storage` keeps them (in a file, say). A server key is refused in Electron, its main process too.
- **React Native** (Hermes or JSC) reads answers through `XMLHttpRequest`, so they show while they're written; on Expo SDK 52 and later `fetch` from `expo/fetch` may be passed as `options.fetch`. Pass a store and a random source, and read back an answer dropped in the background when the app comes back:

  ```javascript
  import AsyncStorage from '@react-native-async-storage/async-storage';
  import * as Crypto from 'expo-crypto';

  const api = await CaptivateChatAPI.create('vba_…', 'prod', {
    storage: AsyncStorage,
    randomValues: (bytes) => Crypto.getRandomValues(bytes),
  });
  AppState.addEventListener('change', (state) => { if (state === 'active') conversation.resume(); });
  ```

  Phones behind one carrier address share that address's limits (below). `examples/react-native` is a one-screen Expo app that does all of this.
- **A server** sending for its users uses a server key: see [On your own server](#on-your-own-server). An app key there would count every user as one address.

### Answers

`sendMessage` works as it does with core's keys, and three listeners are new: `onDelta` for the answer while it's written, `onAnswer` for the final answer with its sources, and `onStep` for a typing line.

```typescript
conversation.onStep((label) => showTyping(label));                   // "Looking into it"
conversation.onDelta((draft, { reset }) => showDraft(draft));        // the answer so far
conversation.onMessage((content, type) => show(content, type));      // once per answer, as before
conversation.onAnswer(({ text, sources, stopped, choices }) => showSources(sources));
await conversation.sendMessage('Where is my order?');
```

- `onDelta(draft, { reset })` gets the whole answer so far, not the piece, once per piece the network brings. Its `[1]` markers are taken out, since a draft's numbers aren't the final answer's. `reset: true` comes with an empty draft when what was shown should be dropped. A runtime that reads the answer whole gives no drafts.
- `onMessage(content, type)` gets each answer once, at its end, as `[{ type: 'text', text }]` with type `'ai_agent'`, never once per draft. The text is Markdown, as Blue's own chat window draws it (bold, lists, links, `[n]` source markers, and a `\` before a mark meant as a character): draw it as Markdown, or take the marks out before showing it as plain text. Without `onAnswer`, the text ends with its sources, after a blank line ("Sources:", then a line a source; one whose title can't be shown reads "Internal document"). An answer with no words gives no `onMessage`, and neither does a stopped one. An answer that failed gives a string, `"[Error: …]"`, with type `'error'`, and goes to `onError` as well.
- `onAnswer({ text, sources, stopped, choices, offer })` comes once an answer is done. `sources` are numbered as the `[n]` in `text`. `choices` are quick replies: show them as buttons and send the one pressed as a message, `sendMessage(choice)`. `offer` is a form the bot offered, which goes to `onActionReceived` too. `renumber(text, sources, keep)` (exported) renumbers the markers and the list together for an app that shows only some sources.
- `onConversationUpdate` gets `{ type, conversationId }`: `'answering'` while a dropped answer is still being written, `'stopped'`, `'busy'` while your message waits for an answer this conversation is giving elsewhere, and `'unavailable'` when the assistant couldn't answer.
- `onError` gets `{ conversationId, errorCode, errorDesc, retryAfter }`, `errorCode` the HTTP status when there was one. `off('bot_message', cb)`, `off('answer', cb)`, `off('delta', cb)` and `off('step', cb)` remove a listener.

`sendMessage` resolves once the answer has started, and rejects when the message is refused (`error.errorDesc` holds the words). Messages go one at a time: a second one waits until the first answer's connection has closed. One sent while the conversation answers elsewhere (another tab or device) waits for that answer and then goes, for 10 minutes at most.

**Stop:** `await conversation.stop()` stops the answer being written and resolves `{ stopped }`; `onAnswer` then gets `{ text: 'Stopped.', sources: [], stopped: true }`. `stopped: false` means nothing was being answered, or the answer had just ended. A message still waiting is dropped and never sent. Closing the connection yourself doesn't stop an answer: Blue goes on writing it.

**A dropped connection** never sends the message again. The answer goes on in Blue, and the library reads it back, matched by the message's own id: what the app already got isn't given twice. When the message never reached Blue, the app gets "Your message didn't go through. Send it again.", and the message can be sent again safely. Phones pause connections in the background, so call `conversation.resume()` when the app comes back to the foreground: an answer still pending is read back at once.

### Conversations by user

```typescript
const conversation = await api.createConversation('user-1', {}, { conversation_title: 'Orders' }, 'bot-first');
const { conversations, pagination } = await api.getUserConversations({ userId: 'user-1', pagination: { page: 1, limit: 20 } });
api.forgetUser('user-1');                                            // at sign-out
```

**The user's secret.** Blue never ties a user's conversations to their ID (often an email address): each user gets a secret, which every call about their conversations carries. By default it is made on the user's first conversation and kept on the device, per key and user, in `options.storage`, else `localStorage`, else memory (Electron's main process and React Native without a store lose the list when they restart). Its name holds a hash of the user's ID, never the ID. So a user has one list on each device. For one list on every device, give `options.userSecret(userId)`, which asks your own server for the user's secret. A good secret is `base64url(HMAC-SHA256(key, "vba-user:" + userId))`, made with a key your server keeps for this alone, never the app key's signing key, so a new signing key leaves every list as it was. Two rules:

- Your server gives a user's secret only to that user, signed in. An endpoint that answers for any ID is the same as trusting whatever ID an app sends.
- A secret anyone can work out from the ID, such as a plain hash of it, is no secret.

The library checks only its form: 43 to 128 letters, digits, `-` or `_`. Anything else is refused: "options.userSecret must give a secret of 43 to 128 letters, digits, - or _ (base64url)." Call `api.forgetUser(userId)` when the user signs out: the secret kept on the device and the user's handles go.

**What each call does:**

- `createConversation(userId, userBasicInfo, metadata, autoStart, privateMetadata, { timeoutMs })` starts the conversation at once, within `timeoutMs` (20 seconds by default). Blue keeps `metadata` with it as you send it, up to 4 KB, except its top-level `user_id` and `user_token`, which stay in memory and are never stored (so put a customer's token only in `user_token`, and leave out of the metadata what you wouldn't store). Past 4 KB it is refused before sending: "Blue keeps at most 4 KB of metadata with a conversation. Keep less in it." `userBasicInfo` and `privateMetadata` are never sent. With `'bot-first'`, the bot's greeting comes to `onMessage` on the next tick, and to `onAnswer` with its starter questions as `choices`; it is never stored, so `getTranscript()` gives it first until the conversation's first message.
- `getConversation(id)` gives a handle whose user is the one kept with the conversation on this device, else the last user named on this instance. `getConversation(id, userId)` takes the named user's secret instead, for a conversation this instance has no handle for. When neither is known, each of its calls refuses: "This conversation's user isn't known on this device. List the user's conversations first."
- `getUserConversations(userId | { userId, pagination })` lists the user's conversations, most recently active first, up to 50 a page, with core's `pagination` (`page`, `pageSize`, `total`, `totalPages`, `hasNextPage`, `hasPrevPage`). Each conversation's `metadata.channelMetadata` holds `conversationCreatedAt`, `conversationUpdatedAt`, `lastChatMessage`, `preview` and `custom`, the metadata Blue keeps. Filters and searches aren't available: they are left out, with one console warning. A user with no secret on this device has none.
- `deleteUserConversations(userId)` deletes all of the user's conversations, and resolves `{ deleted, busy }`: one still answering stays, counted in `busy`. `conversation.delete()` deletes one, refused with "This conversation is still answering. Try again in a moment." while it answers. A delete is a delete: `softDelete` is ignored.
- `conversation.getMetadata()` gives core's shape, `channelMetadata` where apps on 7.0 read it (`event.event_payload.content.channelMetadata`, `metadata.event.event_payload.content.channelMetadata`, `metadata.channelMetadata` and `channelMetadata`), read from Blue only when the handle doesn't already know it. `conversation.setMetadata(metadata)` changes what Blue keeps a top-level key at a time (a `null` removes one), never sending `user_id` or `user_token`; a call of only those (a sign-in) sends nothing.
- `conversation.getTranscript()` gives the conversation's messages as `{ message_id, sender, from, content, text, sources, timestamp, createdAt, files?, stopped? }`, `sender` and `from` `'user'` or `'bot'`.
- Not in Blue mode: `setPrivateMetadata` sends nothing (one warning: "Blue mode doesn't keep private metadata, so it wasn't sent."); `setTimeToLive(90)` resolves, since files sent in a chat are kept with it for 90 days, and any other number is refused with status `501`; `editMessage` is refused with status `501`, "Editing a message isn't available here."; `CaptivateChatManager` refuses Blue's keys: "Use one CaptivateChatAPI for each app key. CaptivateChatManager is for Captivate's own keys."

### Who the customer is, forms and quick replies

```typescript
const conversation = await api.createConversation('user-1', {}, { user_id: 'C-1042', user_token: tokenFromYourServer, order_number: 'A-1001' });
conversation.onActionReceived(([{ id, data }]) => showForm(id, data));    // the bot's forms, look-ups and links
await conversation.sendAction(id, { choice: 'send', values: { email: 'sam@example.com' } });
await conversation.setMetadata({ user_id: null });                        // at sign-out
```

**Who's signed in.** Name your signed-in customer in the metadata, as Blue's website chat does: `user_id`, their ID in your own system (letters, digits and `- _ . :`, at most 64; an email address isn't one), and `user_token`, a token your server signed for it. `createConversation`'s metadata names them first, then each `setMetadata` that has a `user_id` (one without a `user_token` names the ID alone); `user_id: null` says no one is signed in. They go with every message and every press as `user: { id, token }`, and are held in memory only: never stored on the device or with the conversation, and never logged. An ID outside that form, or a token that isn't text of at most 2,048 characters, counts as no one, with one console warning ("user_id must be letters, digits and - _ . : (at most 64), so the chat goes on without knowing who's signed in."). `createConversation`'s first argument names whose list the conversation is in, and is never sent as the customer's ID.

- **The token** is a JWT your server signs as it does for the website chat: HS256 with your app key's signing key, `sub` the ID, `aud` your `vba_` key, `iat`, and `exp` at most an hour later. Keep the signing key on your server. Never put it in the app. Once it expires Blue no longer knows who's signed in: give a fresh one with `setMetadata({ user_id, user_token })`. The library never asks for one itself.
- **What Blue trusts it for:** a look-up of the customer's own records (an order's status, say) runs only for a signed ID. A course agent makes its course for the `user_id` as sent, signed or not, with the conversation's kept `client_name`, so your app's users can name another ID for a course.

**Details.** Some bots look things up with what your app already knows (an order number, a plan). Blue tells the library the names its look-ups read, and the library sends those alone with each message and press, from the metadata's top level, when the value is text or a number of at most 200 characters (a longer one is left out, with one console warning). Nothing else of the metadata goes with a message: it is only kept with the conversation, where no model reads it. `user_id` and `user_token` are never details. A handle from `getConversation(id)` learns the names with one read of the conversation before its first message, press or `setMetadata`, or sooner when you call `getTranscript()` or `getMetadata()`.

**Forms.** While an `onActionReceived` listener is registered, the bot may offer a form under an answer: the listener gets `[{ id, data }]`, `data` the offer as Blue sends it (`kind`, `title`, `intro`, `fields`, `consent`, `sendLabel`, `cancelLabel`, `lookUp`, `link`), and `onAnswer`'s `offer` holds it too. Without the listener the bot gives its by-hand words instead, or asks a look-up's details in the chat. Draw the fields, then send them:

- `sendAction(id, { choice: 'send', values })` sends the form (`choice: 'cancel'` closes it). `values` are by field name, as text: numbers go as their digits, `true` and `false` as "yes" and "no"; anything else is refused before sending. The bot's reply comes to `onMessage` as one message, and to `onAnswer` as `{ text, sources: [], offer }`, `offer` the press's own answer.
- A look-up (`lookUp: true`) answers with what it found: its rows come as lines of the same message ("Status: Shipped"), before the bot's words. The rows are Markdown too, with a `\` before a mark in a value ("Order: ORD\_1042"): draw them as Markdown. When it found nothing, or couldn't check, its words for the customer are the message ("I couldn't find that. Check the details and press Check again."), so label its button with the offer's `sendLabel`, which is "Check".
- A link (`kind: 'link'`) opens in the browser: open `link.url`, its `params` filled from the fields. There's nothing to send, so `sendAction` with `'send'` on it is refused before sending: "This offer is a link: open its link.url in the browser. There's nothing to send."
- A refused press rejects, and goes to `onError`, in words the user can see: "Sign in again in the app, then try once more." when the look-up needs a signed-in customer; "This can't be done any more. Ask again in the chat." when the form has closed; "That form can't be sent like that. Check it and try again." with the refused fields' names in `error.fields`; "You've sent this a few times already. Please try again later." with `error.retryAfter`.
- An id that isn't one of the bot's offers sends nothing, with one console warning: "That action isn't one of the bot's forms, so nothing was sent."

**Quick replies.** When the bot asks something with set answers ("Yes, send it", "No, cancel"), `onAnswer`'s `choices` holds them: show them as buttons, and send the one pressed as a message, `sendMessage(choice)`. An app without `onAnswer` shows none, and its users type the reply.

### Files

```typescript
const files = await conversation.fileManager.createMultiple({ files: [photo, invoice] });
await conversation.sendMessage({ text: 'Here is the invoice', files });
```

A key for your app always takes files. `conversation.fileManager.create({ file, fileName, fileType })`, `createFile` and `createMultiple` work as they do with core's keys and return the same types, but the file goes to Blue, which reads it on its server for this conversation alone (never into the bot's knowledge) and keeps it with the conversation for 90 days. Each file asks Blue for a place and is then sent there by the app itself, one file at a time; each file object gets `upload: { uploadId, expiresAt }`, and its `textContent.text` is empty. Pass the result, its `files`, or an array of file objects as `sendMessage`'s `files`, with or without `text`.

- **What it takes:** pictures (PNG, JPG or WebP), PDFs, Word, Excel and PowerPoint files, and text, Markdown and CSV files, by the file name's extension; 20 MB a file; 5 files with one message; 20 in a conversation. Each is checked before anything is sent, in words the user can see: "I can read pictures (PNG, JPG or WebP), PDFs, Word, Excel and PowerPoint files, and text, Markdown and CSV files.", "A file can be at most 20 MB." and "You can send up to 5 files with one message." A conversation with its 20 files gives "This conversation can't take more files. Start a new conversation to send more."
- **What it doesn't:** `storage: false` (a file Blue would read from your own URL) is refused: "This app can't send files." A file object that didn't come from `conversation.fileManager` is refused when sent: "A file you attached couldn't be found. Attach it again and send your message." `CaptivateChatFileManager.create`, `createFile` and `createMultiple` called with a Blue key are refused: "Use conversation.fileManager with a key for your app."
- **When it fails:** a file's place lasts 15 minutes, which is as long as sending it may take; one that couldn't be sent gives "The assistant couldn't answer just now. Please try again." Past the key's files for the day: "This chat can't take more files today. You can still type your question." A file too big for the bot's AI to look at, once sent: "That file is too big for the assistant to look at. Send a smaller picture or PDF, or paste the part that matters as text."

### Limits

Blue counts a key for your app by the address each call comes from, so an office, or phones behind one carrier address, count as one:

- An address: 10 messages a minute, and as many conversation starts, reads, Stops and form presses; 20 files a minute and 200 MB of files a day (UTC).
- The key, across all its addresses: 600 messages a minute, and as many of each other call; 100 files a minute; and a day (UTC) of 5,000 answers, 1,000 new conversations and 2 GB of files.
- A user: at most 20 conversations with no message yet. Past that, a new one is refused: "Too many new conversations at once. Send a message in one first." A conversation with no message goes after a day.

Past a minute's limit a call is refused with "Too many messages just now. Try again in a minute." and `error.retryAfter`; past a day's, "This chat has answered all it can for today. Please try again tomorrow." (for files, "This chat can't take more files today. You can still type your question."); a form's press has its own words, above. Nothing is sent again by itself.

### Errors

Blue mode's errors carry words your app can show as they are, never the server's own: `error.errorDesc` (and `onError`'s `errorDesc`) holds them, `error.status` the HTTP status (none when Blue couldn't be reached or the call ran out of time), `error.retryAfter` a `429`'s wait in seconds, and `error.fields` the names of a form's refused fields. The message reads like the gateway's: `HTTP request failed: 404 Not Found: This conversation isn't available any more. Start a new one.` None of the words contains "410" or "gone".

A key Blue refuses (`401` or `403`) shows "This app can't reach its assistant right now." to the user and writes once to the console: "The key was refused. Check it is a key for your app, turned on, and that this address is listed on it."

A page that isn't on a web address (a `file:` page, or an Origin of `null`) gets one console warning, since the key can't check where it is: use the library from the app's main process, or register the app's own scheme and list its address on the key.

### On your own server

A server that talks to the bot for its own users (a web app's server routes, a support tool, a backend for your mobile app) uses a server key from the Channels page ("On your own server": `vbk_`, its id and a long secret). The whole key picks server mode, where your server names, on every call, which of its users it is talking for, and each user has their own conversations and their own limits.

```typescript
// Once per server process: the key from the server's settings, never in a page, an app or a log.
const api = await CaptivateChatAPI.create(process.env.BLUE_SERVER_KEY, 'prod');

// In each request, for its signed-in user:
const conversation = conversationId
  ? api.getConversation(conversationId, user.id, { user_id: user.id })             // the user on every call, and who the customer is
  : await api.createConversation(user.id, {}, { user_id: user.id }, 'user-first');
const answered = new Promise((resolve, reject) => { conversation.onAnswer(resolve); conversation.onError(reject); });
conversation.onDelta((draft) => send({ draft }));                                  // the answer so far: replace, never append
await conversation.sendMessage(text);                                              // resolves once the answer has begun
send({ answer: await answered }); end();
```

**First, the user's ID is your server's word.** Blue can't check it: it trusts the ID your server sends, and binds each conversation to the key and that ID. So:

- Never let a user choose the ID your server sends, or each user can reach the others' conversations.
- Use an ID nobody can guess: a random ID from your own user records, never an email address or a running number. Anyone holding the key could otherwise read and delete a guessed user's conversations.
- The ID is 1 to 128 visible characters, without spaces. Anything else is refused before sending: "On a server, each user's ID must be 1 to 128 visible characters, without spaces."

**The key is a secret.** Keep it in your server's settings, never in a web page, an app or a log, and keep the `Authorization` header out of your request logs and monitoring. The library never logs the key, the `Authorization` header or a user's ID, even with `setDebugMode(true)`: its lines name a key by its id alone. If the key gets out, press "Get a new key" on the Channels page: the old key stops at once, and your users' conversations stay with the new one.

**Where it runs.** Node 20.15 and later, Deno, Bun and Cloudflare Workers. The library refuses a server key where it can tell it isn't on a server: a web page, a browser worker, React Native and Electron (an Electron app, even its main process, uses a key for your app). A server passing on a browser's request must not copy the browser's `Origin`: Blue refuses any call with a server key that carries one.

**One instance, a handle per request.** Make one instance for the server and share it. It keeps nothing between requests, so one user's request never acts as another's and memory doesn't grow with your users:

- `createConversation(userId, …)`, `getConversation(id, userId)` and `getUserConversations(userId)` give fresh handles carrying that user. A handle and its listeners are for the request that made them: make a new one in the next request.
- `getConversation(id)` without a user throws: "On a server, name the user on every call: getConversation(id, userId)."
- A fresh handle knows nothing of the last request: pass `getConversation`'s third argument, the request's metadata (`{ user_id, …the details your bot's look-ups read }`), to say who the customer is and give the details. It is held in memory and never sent as it is. Without it, the message goes with no customer. The handle reads the names of the details from Blue once, before its first message.
- `deleteUserConversations(userId)` and `conversation.delete()` delete a user's conversations, at most 200 calls a key a day: past that, "No more conversations can be deleted today. Please try again tomorrow."
- `forgetUser` and `releaseConversation` do nothing, since nothing is kept.
- Nothing is stored on the machine: `options.storage` and `options.userSecret` aren't used, with one console warning ("Server mode keeps nothing on this machine, so storage and userSecret aren't used.").

**Who the customer is.** The user your server names (`userId`) says whose conversations and limits they are. The customer goes in the metadata's `user_id`, as from an app, but never with a token: `user_token` isn't sent, with one console warning ("Blue takes the customer your server names from user_id, so user_token isn't sent."). Blue trusts that `user_id` for a look-up of the customer's own records (an order's status, say) only on a key whose "Your server tells Blue who's signed in" switch the owner turned on; otherwise a look-up shows only what isn't personal. A course agent takes it as sent.

**Limits.** Each user their own: 10 messages a minute, and as many starts, reads and Stops. The key has 600 a minute across its users, and a day (UTC) of 5,000 answers, 1,000 new conversations and 2 GB of files; past a day's cap, "This chat has answered all it can for today. Please try again tomorrow."

**Refusals.** Your users see the same words as from an app (the table above). The console says why, once: "This server key was refused because the request came from a web page. Use it only on your own server." when a call carried an `Origin`, and "The server key was refused. Check it is the newest key from the Channels page and that it is turned on." for any other refusal of the key.

**Without the library,** every call to Blue's `/v1/chat` routes carries `Authorization: Bearer vbk_…` and `X-Blue-User: <your server's ID for the user>`, and never an `Origin`. A message needs a conversation first: `POST /v1/chat/conversations`, then `POST /v1/chat` with its `conversationId`.

## Connection Lifecycle

Worth understanding if you are building anything long-lived:

- **Sends are HTTP, replies are WebSocket.** Every outbound request carries the current `socket_id`; the server pushes the response back over that socket. A request is only deliverable while the socket is alive.
- **The socket can die without your code noticing.** AWS API Gateway closes idle WebSocket connections after 10 minutes and caps any connection at 2 hours. Mobile browsers suspend backgrounded tabs, which closes sockets silently.
- **Check before you send.** `isSocketActive()` is a cheap synchronous check: `true` only while the socket is open and has its id. Instances from `create()` also auto-reconnect before any network call.
- **A failed connect can be tried again.** `create()` and `connect()` reject after `connectTimeoutMs` when the gateway never sends `socket_connected`. The instance is left with no socket, so calling `create()` again, or `reconnect()`, opens a new one. Each `reconnect()` makes up to `maxReconnectAttempts` tries.
- **One round of tries, then it's yours.** When the connection closes unexpectedly the library reconnects by itself, with one round of up to `maxReconnectAttempts` tries `reconnectDelay` apart (5 tries 3 seconds apart, by default). If every try fails it logs "Automatic reconnection failed" and stops; nothing keeps trying after that, though the gateway or the network may be back a minute later. Watch `isSocketActive()` (below) and call `reconnect()` yourself, which starts a new round. An instance from `create()` also reconnects, one round, before its next network call.
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

## Known limits

With a core key (Captivate's gateway, not Blue mode), one thing the library can't fix on its own: it needs a change in the gateway or in core, and is with that team.

- **Deleting one conversation has no visible effect.** `conversation.delete()` (soft or hard) succeeds, but the conversation is still listed by `getUserConversations()` and its transcript can still be read. `deleteUserConversations(userId, { softDelete: false })` does remove a user's conversations.

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

4. **(v7.1.0)** Override the conversation-start timeout for a single call:
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
     const text = typeof message === 'string' ? message : message.map((part) => part.text ?? '').join('');
     console.log(`${type}: ${text}`);
   });
   ```

`type` is `'ai_agent'` for bot messages, `'human_agent'` for live chat, and `'error'` when the message could not be retrieved.

`message` is passed on as the sender sent it: from the bot or a live agent, a list of parts, `[{ type: 'text', text: 'Hello!' }]`; for an error, a string such as `"[Error: Bot unavailable]"`. Its type is `MessageContent` (`MessagePart[] | string`). On a connection shared by several conversations, each hears the replies that name it (7.1.1) and those that name none.

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

const allFiles = fileInputs.flatMap(input => [...input]);

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
import type { MessageContent, MessageSender } from 'captivate-chat-api';

const handler = (message: MessageContent, type: MessageSender) => console.log(message);
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

As of v7.1.0 this returns cached instances when the API already holds a handle for a conversation, so listeners you registered earlier are preserved instead of being silently dropped. As of v7.1.1 each of those takes the list's metadata and key, as a fresh one does.

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
      const text = typeof message === 'string' ? message : message.map((part) => part.text ?? '').join('');
      console.log(`Received (${type}): ${text}`);
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
- **Node.js** (20.15 and later). Node loads `dist/captivate-chat-api.node.js` (package.json's `main`), which opens core's socket with the `ws` package on Node 20 and with Node's own WebSocket on Node 22 and later. Browsers, React Native and bundlers for them load `dist/captivate-chat-api.js` (`browser`). Requiring `dist/captivate-chat-api.js` by its path on Node 20 gives the browser file, where core mode can't connect. `require('captivate-chat-api')` and `import { CaptivateChatAPI } from 'captivate-chat-api'` (a `.mjs` file or `"type": "module"`) both load the Node build.
- **React Native**
- **Electron** (its windows and its main process)

Blue mode's runtimes, and what each needs, are under [Runtimes](#runtimes).

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
  **(v7.1.0)** Updates timeouts and reconnection tunables on a live instance.

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

- **`getConversation(conversationId: string, userId?: string, metadata?: object): Conversation`**
  Retrieves a conversation by ID, creating a local handle if not cached. **(v7.1.0)** No longer returns `void`. With a server key, `userId` names the user on every call, `metadata` (`user_id` and the details) is held in memory for the request, and the handle is a fresh one, never cached ([On your own server](#on-your-own-server)). With an app key, `userId` names whose secret opens a conversation this instance has no handle for.

- **`releaseConversation(conversationId: string): void`**
  **(v7.1.0)** Drops a conversation from the local cache and detaches its socket listener. Does not delete it server-side.

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
  **(v7.1.0)** Re-binds this conversation to the current socket. Idempotent; called automatically after a reconnect.

- **`detachListeners(): void`**
  **(v7.1.0)** Detaches the socket listener. Call when discarding an instance.

- **`off(eventType: string, callback: Function): void`** / **`removeAllListeners(): void`**
  **(v7.1.0)** Removes registered event callbacks: `off` takes the callback you gave the `on...` method (for `onMessage()`, with `'bot_message'` or `'livechat_message'`), and `removeAllListeners()` every one of the conversation.

#### Events

- **`onMessage(callback: (message: MessageContent, type: MessageSender) => void): void`**
  Listens for new messages. `message` is a list of parts (`[{ type: 'text', text }]`) from the bot or a live agent, and a string for an error. `type` is `'ai_agent'`, `'human_agent'`, or `'error'`. A callback typed `(message: string, type: string)`, as before 7.1.0, still compiles.

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

interface MessagePart {
  type: string;          // 'text' for text
  text?: string;
  [key: string]: unknown;
}

type MessageContent = MessagePart[] | string;  // a string only for an error
type MessageSender = 'ai_agent' | 'human_agent' | 'error';
```

## Troubleshooting

**`410 Gone` from the server, or replies that never arrive.**
Fixed in v7.1.0. Conversations now read `socket_id` live instead of capturing it, so a reconnect no longer strands them. If you are on an older version, recreate conversations after every reconnect.

**Only one conversation receives messages.**
Fixed in v7.1.0. Listeners were assigned to `socket.onmessage`, so each new conversation overwrote the previous one's handler.

**Every conversation receives every reply.**
Fixed in v7.1.1: a conversation ignores a reply that names another one. On 7.1.0 and before, keep one conversation per instance, or tell your own replies apart in your app.

**`create()` rejects with `Connection timeout: socket_connected not received`.**
The gateway opened the socket but never named it. Call `create()` again: since v7.1.0 the instance is left with no socket and connects afresh. Before v7.1.0 the second call returned an instance whose replies were lost.

**`Max reconnection attempts (N) reached` on every reconnect.**
Fixed in v7.1.0: each `reconnect()` gets its own `maxReconnectAttempts` tries.

**`[object Object]` where the bot's words should be.**
`onMessage`'s `message` is a list of parts, not a string: join their `text`. See [Send and Receive Messages](#send-and-receive-messages).

**`Timeout: No conversation_start_success received from WebSocket`, but the conversation exists.**
Fixed in v7.1.0. The timer was never cleared and fired even after success. If you still see this on the current version, the backend genuinely exceeded the deadline — raise `conversationStartTimeoutMs`.

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
npm run build       # webpack: dist/captivate-chat-api.js (browsers), dist/captivate-chat-api.node.js (Node) and their type files, then scripts/check-node-build.mjs
```

`npm test -- connection` runs only the test files whose path holds `connection`. The tests never reach a server: `test/fakes/` holds a WebSocket, a fetch, an XMLHttpRequest and storage that the tests answer by hand, and a console that keeps what the library logs (`TEST_LOGS=1 npm test` prints it too).

`test/core/` covers today's path through Captivate's gateway: the socket's address, connecting and the guard that reconnects, `dispose`, the HTTP envelope and its errors, the messages a conversation hears (with a reply too big for the socket, fetched from its link), creating a conversation and a user's list. They pass before and after every change.

Before a release, `test-e2e-chat.html` is also run by hand against the dev gateway, with a dev key.

### Blue mode's runtimes

```bash
npm run test:electron   # npm run build, then server mode on plain Node and the Electron harness
```

`test/electron/` has its own `package.json`, pinning the newest stable Electron and the oldest still supported (`electron` and `electron-oldest`), installed there the first time. It starts a stand-in for Blue on `127.0.0.1` that replays `test/fixtures/blue-mode` a line at a time, and checks the built `dist` in each: the main process with Node's `fetch` and with `net.fetch` (drafts and the final answer, no `Origin`); a hidden window on `http://127.0.0.1` (drafts in the page, its address as `Origin`); a `file://` page (the warning once, no crash); a page on a registered `app://myapp` (its `Origin` through the preflight, drafts); and a server key in the main process (refused in its words). Before Electron, `node-server-mode.js` runs server mode on plain Node against the same stand-in: two users through one instance at once, each with its own drafts and answers. On Linux without a display it runs Electron under `xvfb-run`.

`examples/react-native` is an Expo app (Expo 51, React Native 0.74) for the phones, run by hand from its README; `test-e2e-chat.blue.html` is a page for Blue mode by hand in a browser (drafts, Stop, a dropped connection read back), with a placeholder key to replace with an app key.
