// The README's claims about core's path that no other test held (10 Nov's claims map): the
// file manager's array-like use, storage, time to live and secure links, the transcript's link
// refresh, debug mode, the tunables and a conversation hearing the replies that name it.
// A claim that fails here is a finding about the library or the README, not a test to
// bend: each test says the README's words it checks.
import { FakeWebSocket, connectedApi, freshKey, until } from './helpers';
import { linesAt, clearLogs } from '../fakes/console';
import { FakeFetch, jsonResponse, textResponse, RecordedRequest } from '../fakes/fetch';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CaptivateChatAPI } from '../../src/api/CaptivateChatAPI';
import { CaptivateChatFileManager } from '../../src/api/CaptivateChatFileManager';

const FILE_TO_TEXT = 'https://file-to-text.prod.captivat.io/api/file-to-text';
const PRESIGNED = 'https://file-to-text.prod.captivat.io/api/presigned-url';

let fake: FakeFetch;

beforeEach(() => {
  FakeWebSocket.reset();
  clearLogs();
  CaptivateChatAPI.setDebugMode(false);
  fake = new FakeFetch().install();
});

afterEach(() => {
  fake.restore();
  CaptivateChatAPI.setDebugMode(false);
});

const frame = (eventType: string, payload: object) => ({ event: { event_type: eventType, event_payload: payload } });

/** The file-to-text service's answer for a stored file. */
const converted = (name: string) =>
  jsonResponse({
    success: true,
    text: `text of ${name}`,
    fileKey: `uploads/${name}`,
    presignedUrl: `https://bucket.example/${name}`,
    expiresIn: 1704070800,
    fileSize: 4,
    processingTime: 15,
  });

const pdf = (name = 'document.pdf') => new File(['%PDF'], name, { type: 'application/pdf' });

/** The form a file-to-text call sent, as name → value. */
function formOf(request: RecordedRequest): Record<string, string> {
  const out: Record<string, string> = {};
  (request.body as FormData).forEach((value, key) => {
    out[key] = typeof value === 'string' ? value : `<file ${(value as File).name}>`;
  });
  return out;
}

// README "File Manager Improvements" and "API Reference": getFilename, getTextContent,
// getFileType, getFirstFile, toFilesArray, `type: 'files'`, `files` and `length`.
test('README: the file manager convenience methods and properties read the first file', async () => {
  fake.reply(converted('document.pdf'));
  const input = await CaptivateChatFileManager.create({ file: pdf() });

  assert.equal(fake.requests[0].url, FILE_TO_TEXT);
  assert.equal(formOf(fake.requests[0]).storage, 'true', 'storage defaults to true');
  assert.equal(input.type, 'files');
  assert.equal(input.length, 1);
  assert.equal(input.files.length, 1);
  assert.equal(input.getFilename(), 'document.pdf');
  assert.equal(input.getFileType(), 'application/pdf');
  assert.equal(input.getTextContent(), 'text of document.pdf');
  assert.equal(input.getFirstFile(), input.files[0]);
  assert.deepEqual(input.toFilesArray(), input.files);
  assert.deepEqual(input.files[0].storage, {
    fileKey: 'uploads/document.pdf',
    presignedUrl: 'https://bucket.example/document.pdf',
    expiresIn: 1704070800,
    fileSize: 4,
    processingTime: 15,
  });
  assert.deepEqual(input.files[0].textContent.metadata, {
    source: 'file_attachment',
    originalFileName: 'document.pdf',
    storageType: 'direct',
  });
});

// README "Array-like Behavior": `fileInput[0] // ✅ Array access`.
test('README: fileInput[0] gives the first file object (array access)', async () => {
  fake.reply(converted('document.pdf'));
  const input = await CaptivateChatFileManager.create({ file: pdf() });
  assert.equal((input as any)[0], input.files[0]);
});

// README "File Manager Improvements": "Proxy-based implementation supports array access and iteration".
test('README: iterating a file manager gives its file objects', async () => {
  fake.reply(converted('a.pdf'), converted('b.pdf'));
  const input = await CaptivateChatFileManager.createMultiple({ files: [pdf('a.pdf'), pdf('b.pdf')] });
  assert.equal(input.length, 2);
  const seen = [...(input as unknown as Iterable<any>)];
  assert.deepEqual(
    seen.map((f) => f?.filename),
    ['a.pdf', 'b.pdf']
  );
});

// README "Developer Storage": storage: false needs a url, and the file object holds it instead of storage.
test('README: storage false needs a url, and the file object carries the url and no storage', async () => {
  await assert.rejects(CaptivateChatFileManager.create({ file: pdf(), storage: false }), {
    message: 'URL is required when storage is false for sendMessage compatibility',
  });
  assert.equal(fake.requests.length, 0, 'refused before any request');

  fake.reply(jsonResponse({ success: true, text: 'words' }));
  const input = await CaptivateChatFileManager.create({
    file: pdf(),
    storage: false,
    url: 'https://my-bucket.example/document.pdf',
  });
  assert.equal(formOf(fake.requests[0]).storage, 'false');
  assert.equal(input.files[0].url, 'https://my-bucket.example/document.pdf');
  assert.equal(input.files[0].storage, undefined);
});

// README "Multiple Files", option 2: "urls: Required when storage is false, and must match files.length".
test('README: createMultiple with storage false needs one url a file', async () => {
  await assert.rejects(
    CaptivateChatFileManager.createMultiple({ files: [pdf('a.pdf'), pdf('b.pdf')], storage: false, urls: ['https://x/a'] })
  );
  await assert.rejects(CaptivateChatFileManager.createMultiple({ files: [pdf('a.pdf')], storage: false }));
  assert.equal(fake.requests.length, 0, 'refused before any request');

  fake.reply(jsonResponse({ success: true, text: 'a' }), jsonResponse({ success: true, text: 'b' }));
  const input = await CaptivateChatFileManager.createMultiple({
    files: [pdf('a.pdf'), pdf('b.pdf')],
    storage: false,
    urls: ['https://x/a.pdf', 'https://x/b.pdf'],
  });
  assert.deepEqual(
    input.files.map((f) => f.url),
    ['https://x/a.pdf', 'https://x/b.pdf']
  );
});

// README "File expiration (TTL)": setTimeToLive(1|7|30|90) once, stored in metadata, and every
// upload through conversation.fileManager sends it; any other value is ignored; without it, none.
test('README: setTimeToLive sets the uploads ttlDays and the metadata; other values are ignored', async () => {
  const api = await connectedApi();
  const conversation = api.getConversation('conv-ttl');

  fake.reply(converted('none.pdf'));
  await conversation.fileManager.create({ file: pdf('none.pdf') });
  const plain = formOf(fake.requests[0]);
  assert.equal(plain.ttlDays, undefined, 'no expiration without setTimeToLive');
  assert.equal(plain.path, `${(api as any).apiKey}/conv-ttl`, 'the key and conversation go as the path');

  await conversation.setTimeToLive(5);
  assert.equal(fake.requests.length, 1, 'an allowed value only: 5 sends nothing');

  fake.reply(textResponse('OK'));
  await conversation.setTimeToLive(7);
  assert.equal(fake.requests[1].json.event.event_type, 'metadata');
  assert.deepEqual(fake.requests[1].json.event.event_payload.metadata, { timeToLive: 7 });

  fake.reply(converted('seven.pdf'), converted('m1.pdf'), converted('m2.pdf'), converted('one.pdf'));
  await conversation.fileManager.create({ file: pdf('seven.pdf') });
  await conversation.fileManager.createMultiple({ files: [pdf('m1.pdf'), pdf('m2.pdf')] });
  await conversation.fileManager.createFile({ file: pdf('one.pdf') });
  assert.deepEqual(
    fake.requests.slice(2).map((r) => formOf(r).ttlDays),
    ['7', '7', '7', '7']
  );

  // The legacy static create takes ttlDays itself, and drops a value outside 1, 7, 30, 90.
  fake.reply(converted('legacy.pdf'), converted('odd.pdf'));
  await CaptivateChatFileManager.create({ file: pdf('legacy.pdf'), ttlDays: 30 });
  await CaptivateChatFileManager.create({ file: pdf('odd.pdf'), ttlDays: 3 as any });
  assert.equal(formOf(fake.requests[6]).ttlDays, '30');
  assert.equal(formOf(fake.requests[7]).ttlDays, undefined);
  api.dispose();
});

// README "Secure URL Management": refreshSecureUrl(expiresIn?) and getSecureFileUrl(fileKey, expiresIn), 7200 by default.
test('README: refreshSecureUrl and getSecureFileUrl ask for a link by the file key, 2 hours by default', async () => {
  fake.reply(converted('document.pdf'));
  const input = await CaptivateChatFileManager.create({ file: pdf() });

  fake.reply(jsonResponse({ success: true, presignedUrl: 'https://fresh/1' }));
  assert.equal(await input.refreshSecureUrl(), 'https://fresh/1');
  assert.equal(fake.requests[1].url, PRESIGNED);
  assert.deepEqual(fake.requests[1].json, { fileKey: 'uploads/document.pdf', expiresIn: 7200 });

  fake.reply(jsonResponse({ success: true, presignedUrl: 'https://fresh/2' }));
  assert.equal(await input.refreshSecureUrl(3600), 'https://fresh/2');
  assert.equal(fake.requests[2].json.expiresIn, 3600);

  fake.reply(jsonResponse({ success: true, presignedUrl: 'https://fresh/3' }));
  assert.equal(await CaptivateChatFileManager.getSecureFileUrl('uploads/k.txt', 60), 'https://fresh/3');
  assert.deepEqual(fake.requests[3].json, { fileKey: 'uploads/k.txt', expiresIn: 60 });
});

// README "Secure URL Management": "getTranscript() refreshes presigned URLs automatically when they
// are within five minutes of expiry".
test('README: getTranscript refreshes a file link within five minutes of expiry and leaves a fresher one', async () => {
  const api = await connectedApi();
  const conversation = api.getConversation('conv-files');
  const now = Math.floor(Date.now() / 1000);
  const soon = { filename: 'soon.pdf', storage: { fileKey: 'uploads/soon', presignedUrl: 'https://old/soon', expiresIn: now + 120 } };
  const later = { filename: 'later.pdf', storage: { fileKey: 'uploads/later', presignedUrl: 'https://old/later', expiresIn: now + 3600 } };

  fake.reply(
    jsonResponse({ transcript: [{ message_id: 'm1', content: { text: 'files' }, files: [soon, later] }] }),
    jsonResponse({ success: true, presignedUrl: 'https://new/soon' }),
    textResponse('OK')
  );
  const transcript = (await conversation.getTranscript()) as any[];

  assert.equal(transcript[0].files[0].storage.presignedUrl, 'https://new/soon');
  assert.ok(transcript[0].files[0].storage.expiresIn >= now + 7200);
  assert.equal(transcript[0].files[1].storage.presignedUrl, 'https://old/later', 'a link with an hour left stays');
  assert.deepEqual(fake.requests[1].json, { fileKey: 'uploads/soon', expiresIn: 7200 });
  // The refreshed link is pushed to the server as an edit of that message.
  await until(() => fake.requests.length === 3);
  assert.equal(fake.requests[2].json.event.event_type, 'edit_message');
  api.dispose();
});

// README "Message Payload Format": content.files is a list of file objects
// ({ filename, type, textContent }), and "Direct Usage: Use fileInput directly as files: fileInput".
test('README: sendMessage({ text, files: fileInput }) sends content.files as a list of file objects', async () => {
  const api = await connectedApi();
  const conversation = api.getConversation('conv-send');
  fake.reply(converted('document.pdf'));
  const fileInput = await conversation.fileManager.create({ file: pdf() });

  fake.reply(textResponse('OK'));
  await conversation.sendMessage({ text: "Here's the document you requested", files: fileInput });
  const content = fake.last!.json.event.event_payload.content;
  assert.equal(content.text, "Here's the document you requested");
  assert.ok(Array.isArray(content.files), `content.files was ${JSON.stringify(content.files)?.slice(0, 80)}`);
  assert.equal(content.files[0].filename, 'document.pdf');
  api.dispose();
});

// README "Debug Mode": getDebugMode, logs prefixed [CaptivateChatAPI] only in debug mode, and
// "setDebugMode only gates log output. Warnings and errors from the library are always printed."
test('README: debug mode gates the prefixed log lines alone; warnings print either way', async () => {
  assert.equal(CaptivateChatAPI.getDebugMode(), false, 'off by default');

  const quiet = await connectedApi();
  assert.deepEqual(linesAt('log'), [], 'no log line while debug mode is off');
  // A core key has nothing to stop: stop() warns, debug mode off.
  await quiet.getConversation('c-warn').stop();
  assert.equal(linesAt('warn').length, 1);
  assert.ok(linesAt('warn')[0].startsWith('[CaptivateChatAPI] '));
  quiet.dispose();

  CaptivateChatAPI.setDebugMode(true);
  assert.equal(CaptivateChatAPI.getDebugMode(), true);
  clearLogs();
  const loud = await connectedApi();
  const lines = linesAt('log');
  assert.ok(lines.length > 0, 'debug mode logs');
  assert.ok(lines.every((l) => l.startsWith('[CaptivateChatAPI] ')), 'every log line has the prefix');
  loud.dispose();
});

// README "Configuration": the defaults, options ignored when the instance exists, configure()
// on a live instance, and a single call's timeoutMs.
test('README: the tunables default to 10000, 20000, 5 and 3000; a second constructor ignores its options; configure changes them', async () => {
  const key = freshKey();
  const api = new CaptivateChatAPI(key, 'prod');
  const tunables = () => ({
    connectTimeoutMs: (api as any).connectTimeoutMs,
    conversationStartTimeoutMs: (api as any).conversationStartTimeoutMs,
    maxReconnectAttempts: (api as any).maxReconnectAttempts,
    reconnectDelay: (api as any).reconnectDelay,
  });
  assert.deepEqual(tunables(), {
    connectTimeoutMs: 10000,
    conversationStartTimeoutMs: 20000,
    maxReconnectAttempts: 5,
    reconnectDelay: 3000,
  });

  const again = new CaptivateChatAPI(key, 'prod', { connectTimeoutMs: 1, maxReconnectAttempts: 1 });
  assert.equal(again, api);
  assert.equal(tunables().connectTimeoutMs, 10000, "the existing instance's options stay");

  api.configure({ conversationStartTimeoutMs: 30000, reconnectDelay: 10 });
  assert.equal(tunables().conversationStartTimeoutMs, 30000);
  assert.equal(tunables().reconnectDelay, 10);
  assert.equal(tunables().maxReconnectAttempts, 5, 'what configure is not given stays');
  api.dispose();
});

test("README: a single createConversation's timeoutMs overrides the instance's", async () => {
  const api = await connectedApi({ conversationStartTimeoutMs: 60000 });
  fake.reply(textResponse('OK'));
  await assert.rejects(api.createConversation('user-1', {}, {}, 'user-first', {}, { timeoutMs: 15 }), {
    message: 'Timeout: No conversation_start_success received from WebSocket within 15ms',
  });
  api.dispose();
});

// README "Handle Events": "Listeners accumulate: calling onMessage() twice registers two callbacks".
test('README: listeners accumulate, so a handler registered twice runs twice', async () => {
  const api = await connectedApi();
  const conversation = api.getConversation('conv-twice');
  let calls = 0;
  const handler = () => (calls += 1);
  conversation.onMessage(handler);
  conversation.onMessage(handler);
  FakeWebSocket.last!.receive(frame('bot_message', { content: [{ type: 'text', text: 'hi' }] }));
  assert.equal(calls, 2);
  api.dispose();
});

// README (7.1.1): "each hears the replies that name it and those that name none." It was a known
// limit until the gateway's source showed it puts conversation_id in every reply.
test('README 7.1.1: a conversation on a shared instance hears the replies that name it, not another', async () => {
  const api = await connectedApi();
  const heard: string[] = [];
  api.getConversation('conv-a').onMessage(() => heard.push('a'));
  api.getConversation('conv-b').onMessage(() => heard.push('b'));
  FakeWebSocket.last!.receive(frame('bot_message', { content: [{ type: 'text', text: 'for a' }], conversation_id: 'conv-a' }));
  assert.deepEqual(heard, ['a']);
  api.dispose();
});
