# Web chat with a Captivate bot (core)

A one-page web chat that talks to a Captivate bot through Captivate's gateway, this library's core path (any key that isn't one of Vienna Blue's). Messages go out over HTTPS and replies come back on one WebSocket. It shows:

- each reply as it arrives, with typing dots while the bot works (core's gateway sends each reply whole, so there is no answer-while-it's-written here: that is Blue mode's);
- the reply's sources: core's bots name them in the text, "(Source: guide.pdf)", and the page turns them into `[n]` markers and a list;
- quick replies as buttons, when the bot sends buttons or actions (`onActionReceived`);
- **Stop**, which with a core key has nothing to stop: the page says so, and the library writes one console warning;
- **Test reconnect**, which closes the socket, shows it closed, reconnects (a new socket id) and sends "Are you still there?" to show the conversation follows the new socket and its reply arrives;
- the user's conversations, each opening with its messages read back.

The header shows the socket's state and the last characters of its id all the time; the log under the chat says what the library did.

## Run it

1. **Install Node.js 20.15 or later** (`node --version` to check). Nothing else: the page uses the library's built file in `dist`, and the small server uses Node alone. There is no `npm install` to run.

2. **Have a core API key** for a Captivate bot. On Lance's laptop, the dev gateway's key is already in `C:\Users\delva\.claude\secrets\core-dev.env` (`CORE_DEV_API_KEY`).

3. **Put the key in a file.** Make `examples/chat-core/.env` (copy `.env.example` beside it) holding one line:

   ```
   CAPTIVATE_API_KEY=paste_your_core_key_here
   ```

   The file is ignored by git. `CORE_DEV_API_KEY=` works as the name too, so the secrets file can be used as it is (step 4).

4. **Start it** from the library's folder:

   ```powershell
   cd C:\Users\delva\captivate\captivate-chat-api-blue-mode
   node examples\serve.mjs chat-core
   ```

   Or, with the key file kept elsewhere (PowerShell):

   ```powershell
   $env:KEY_FILE = "$HOME\.claude\secrets\core-dev.env"; node examples\serve.mjs chat-core
   ```

   It prints `chat-core is running: open http://localhost:5174 (Ctrl+C stops it)`.

5. **Open http://localhost:5174** in a browser.

## What success looks like

1. The header says **Socket open · core (dev) · socket id …**.
2. Press **New conversation**: typing dots, then the bot's greeting (on the dev key's bot, "Hello! I'm a General Information Chatbot…").
3. Ask "What can the Acrobat AI Assistant do? Please cite your sources.": typing dots, then the reply with a `[1]` marker and **Sources** under it.
4. Press **Stop**: the chat says "Nothing to stop: core's gateway sends each reply whole, and stop() works only with a key from Blue."
5. Press **Test reconnect**: the header turns to **Socket closed**, then back to **Socket open** with another id; the bot answers "Are you still there?"; the chat says "Recovered: the conversation follows the new socket and its replies arrive."
6. Press **New conversation** again, then **Refresh the list**, then the older conversation: its messages come back.

## Settings

- `MODE=prod` in the `.env` file uses Captivate's production gateway; the default is `dev`. The key must be for the same gateway.
- The user ID box names whose conversations these are; the page remembers it in this browser.

## Good to know

- Every conversation on one socket hears every reply, since the gateway's replies don't say which conversation they belong to (the library's README, "Known limits"). So only the open conversation listens here: switching conversations takes the listeners off the one left.
- The key reaches the browser, because the library runs there with it.
