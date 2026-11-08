# Blue mode on React Native: the example

One screen of an Expo app talking to a Vienna Blue bot through `captivate-chat-api`: a message sent, the answer shown while it's written, Stop, and an answer that was dropped in the background read back when the app comes to the front. It isn't part of `npm test`: it runs on phones, by hand.

It is on Expo 51 (React Native 0.74.5, Hermes), what Captivate's own React Native apps run. Expo 51's `fetch` can't read an answer while it's written, so the library reads it through `XMLHttpRequest`, which can. On Expo SDK 52 and later you may pass `fetch` from `expo/fetch` as `options.fetch` instead.

## Run it

1. Make an app key on Blue's Channels page ("Your own app") and put it in `App.js` in place of the placeholder `APP_KEY`. `MODE` is `'dev'` for Blue's dev backend.
2. From the library's own folder, build and pack it: `npm run build`, then `npm pack`. That makes `captivate-chat-api-7.1.0.tgz`, which this example installs.
3. Here: `npm install`, then a release build on a phone: `npm run android` or `npm run ios` (Xcode, and a signing team for an iPhone). Use a release build: a debug build's network inspector can hold an answer back until it ends.

To try the newest React Native, move the example to Expo's newest SDK with `npx expo install expo@latest --fix`.

## What to check

- An answer's words arrive in pieces while it's written, then the final answer with its sources.
- Stop while it's written: "Stopped." in place of the answer.
- Airplane mode while an answer is written, then back, then the app brought to the front: the answer once, read back, never twice.

## What the app passes

- `storage: AsyncStorage`, so the user's conversations stay theirs after the app restarts.
- `randomValues` from `expo-crypto`, since Hermes has no `crypto.getRandomValues`.
- `conversation.resume()` when `AppState` turns `active`.
