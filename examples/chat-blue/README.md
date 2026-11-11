# Web chat with a Vienna Blue bot

A one-page web chat that talks to a bot published in Vienna Blue, through this library's Blue mode (a key for your app, `vba_…`). It shows:

- the answer while it's written (a yellow bubble that grows, then turns grey when the answer is done);
- the answer's sources, numbered as the `[n]` markers in it;
- quick replies as buttons (the bot's starter questions after its greeting, and set answers when it asks something);
- **Stop**, which stops the answer being written;
- **Test reconnect**, which asks a question, cuts the connection at the answer's first words (as a lost network would) and shows the library reading the answer back from Blue, once, without sending the question again;
- the user's conversations, newest first, each opening with its messages read back.

The log under the chat says what the library did at each step.

## Run it

1. **Install Node.js 20.15 or later** (`node --version` to check). Nothing else: the page uses the library's built file in `dist`, and the small server uses Node alone. There is no `npm install` to run.

2. **Get a key for your app** (skip this on Lance's laptop: the dev key for the knowledge base "Serene test 10 Nov SDK" is already in `C:\Users\delva\.claude\secrets\blue-sdk-dev.env`, with `http://localhost:5173` listed on it).
   1. Sign in to Blue (dev: https://vienna-blue.dev.captivatechat.ai) and open a knowledge base whose bot is published.
   2. Turn on developer mode: tap the Vienna Blue logo, top left, 7 times. (Until "Your own app" is on for everyone, it shows only in developer mode.)
   3. Open **Channels** in the sidebar. Under **Your own app**, press **Make a key for my app**.
   4. Under **Where it can run**, type `http://localhost:5173` and press **Add**.
   5. Press **Copy the key**.

3. **Put the key in a file.** Make `examples/chat-blue/.env` (copy `.env.example` beside it) holding one line:

   ```
   BLUE_APP_KEY=vba_paste_your_key_here
   ```

   The file is ignored by git. To use a key file kept somewhere else, set `KEY_FILE` instead (step 4).

4. **Start it** from the library's folder:

   ```powershell
   cd C:\Users\delva\captivate\captivate-chat-api-blue-mode
   node examples\serve.mjs chat-blue
   ```

   Or, with the key file kept elsewhere (PowerShell):

   ```powershell
   $env:KEY_FILE = "$HOME\.claude\secrets\blue-sdk-dev.env"; node examples\serve.mjs chat-blue
   ```

   It prints `chat-blue is running: open http://localhost:5173 (Ctrl+C stops it)`.

5. **Open http://localhost:5173** in Chrome, Edge, Firefox or Safari. Use `localhost`, not `127.0.0.1`: the key lists `http://localhost:5173` exactly.

## What success looks like

1. The header says **Ready · Blue mode (dev)**.
2. Press **New conversation**: the bot's greeting appears (for "Serene test 10 Nov SDK", "Hi! How can I help?") with up to three starter questions as buttons.
3. Press a starter question: a yellow bubble grows while the answer is written, then turns grey with **Sources** under it.
4. Ask for something long ("Give me every price and return rule, item by item") and press **Stop**: the answer ends with *Stopped.*
5. Press **Test reconnect**: the chat says "The connection was cut. The library reads the answer back from Blue…", then "Recovered: the whole answer was read back, once.", and the log says `Test: recovered in … s, the answer came once`.
6. Press **New conversation** again, then **Refresh the list**: both conversations are listed. Press the older one: its messages come back, sources and all.

## Settings

- `MODE=prod` in the `.env` file talks to Blue's production backend; the default, `dev`, talks to `https://vienna-blue-backend.dev.captivat.io`. The key must come from the same deployment.
- The user ID box names whose conversations these are. The page remembers it in this browser, and the library keeps that user's secret here too, so the list is this browser's.

## If something is wrong

- **"This app can't reach its assistant right now."** Blue refused the key: check the key is turned on in Channels, that `http://localhost:5173` is listed under "Where it can run", and that the page was opened at `http://localhost:5173`.
- **"No key found."** when starting: the `.env` file is missing or its line isn't `BLUE_APP_KEY=…`.
- **The page says it needs a key that starts with vba_**: a website key (`vbw_`) or a server key (`vbk_`) was used. Server keys belong on a server, never in a page.

The key reaches the browser, because the library runs there with it: a key for your app is made for that, and the sites listed on it stop other websites using it. Never put a server key (`vbk_`) in a page.
