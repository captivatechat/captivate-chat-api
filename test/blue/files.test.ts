// Files (first-channels-library-spec §2.9; gaps G14, G16): checked before anything is sent, a
// place asked of Blue and the file PUT there with exactly its headers, core's return types with
// the place added, a message naming its files' places, and each refusal in §1.2's words.
import { FakeWebSocket, appKey } from './helpers';
import { clearLogs, linesAt } from '../fakes/console';
import { FakeFetch, FakeResponse, RecordedRequest, jsonResponse } from '../fakes/fetch';
import { FakeClock } from '../fakes/clock';
import { Call, NDJSON, SECRET, blueConversation, flush, record } from './answers';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CaptivateChatAPI } from '../../src/api/CaptivateChatAPI';
import { CaptivateChatFileManager } from '../../src/api/CaptivateChatFileManager';
import { Conversation } from '../../src/api/Conversation';
import { BlueError } from '../../src/api/blue/transport';
import { FILE_MAX_BYTES } from '../../src/api/blue/files';
import { CONSOLE_WORDS, SETUP_WORDS, WORDS } from '../../src/api/blue/words';

const BASE = 'https://vienna-blue-backend.prod.captivat.io';
const ID = '0000000000000000000000c1';
const PLACE = 'https://files.example.test/uploads/abc?X-Amz-Signature=made-up';
const uploadId = (n: number) => n.toString(16).padStart(32, '0');

let fake: FakeFetch;
let clock: FakeClock;
let api: CaptivateChatAPI;
let conversation: Conversation;

beforeEach(async () => {
  FakeWebSocket.reset();
  clearLogs();
  fake = new FakeFetch().install();
  clock = new FakeClock();
  api = await CaptivateChatAPI.create(appKey(), 'prod', { stream: 'fetch' });
  conversation = blueConversation(api, clock, ID);
});

afterEach(() => {
  api.dispose();
  fake.restore();
});

const pdf = (name = 'order.pdf', text = '%PDF-1.4 made up') => new File([text], name, { type: 'application/pdf' });
/** A Blob that says it is `size` bytes, without holding them. */
const sized = (size: number) => Object.defineProperty(new Blob(['x']), 'size', { value: size });
const slot = (n = 1, headers: Record<string, string> = { 'Content-Type': 'application/pdf' }) =>
  jsonResponse({ uploadId: uploadId(n), url: `${PLACE}&n=${n}`, headers, expiresAt: '2099-01-01T00:00:00.000Z' }, 201);
const stored = () => new FakeResponse({ status: 200, body: '' });
const uploads = () => fake.requests.filter((r) => r.method === 'POST' && r.url === `${BASE}/v1/chat/uploads`);
const puts = () => fake.requests.filter((r) => r.method === 'PUT');
const sends = () => fake.requests.filter((r) => r.method === 'POST' && r.url === `${BASE}/v1/chat`);
const line = (event: unknown) => `${JSON.stringify(event)}\n`;
const answer = () =>
  new FakeResponse({ headers: NDJSON, body: [line({ type: 'conversation', conversationId: ID }), line({ type: 'text', text: 'Got it.' }), line({ type: 'done' })] });

async function refusal(run: () => Promise<unknown>): Promise<BlueError> {
  try {
    await run();
  } catch (error) {
    return error as BlueError;
  }
  assert.fail('expected a refusal');
}

test('each check comes before anything is sent: the type, 20 MB, 5 at once and storage: false, in their words', async () => {
  const wrongType = await refusal(() => conversation.fileManager.create({ file: pdf('notes.exe') }));
  assert.equal(wrongType.message, WORDS.fileType);
  assert.equal(wrongType.errorDesc, WORDS.fileType);
  const noExtension = await refusal(() => conversation.fileManager.create({ file: new Blob(['x']) }));
  assert.equal(noExtension.errorDesc, WORDS.fileType);
  const tooBig = await refusal(() => conversation.fileManager.create({ file: sized(FILE_MAX_BYTES + 1), fileName: 'big.pdf' }));
  assert.equal(tooBig.errorDesc, WORDS.fileOver20MB);
  const six = await refusal(() => conversation.fileManager.createMultiple({ files: [1, 2, 3, 4, 5, 6].map((n) => pdf(`${n}.pdf`)) }));
  assert.equal(six.errorDesc, WORDS.filesPerMessage);
  const byUrl = await refusal(() => conversation.fileManager.create({ file: pdf(), storage: false, url: 'https://example.test/a.pdf' }));
  assert.equal(byUrl.errorDesc, WORDS.cantSendFiles);
  // One bad file among good ones: none of them goes.
  const mixed = await refusal(() => conversation.fileManager.createMultiple({ files: [pdf('a.pdf'), pdf('b.zip')] }));
  assert.equal(mixed.errorDesc, WORDS.fileType);
  // Exactly 20 MB, a name in capitals and every listed type pass the check.
  fake.reply(slot(), stored());
  await conversation.fileManager.create({ file: sized(FILE_MAX_BYTES), fileName: 'SCAN.PDF' });
  assert.equal(uploads().length, 1);
  assert.equal(fake.requests.length, 2, 'the refused files asked for no place');
});

test('a file gets its place from Blue, then is PUT there with exactly the place\'s headers, never the key', async () => {
  const file = pdf('order.pdf');
  fake.reply(slot(7, { 'Content-Type': 'application/pdf', 'x-amz-meta-made-up': 'yes' }), stored());
  const manager = await conversation.fileManager.create({ file });
  const [ask] = uploads();
  assert.equal(ask.headers.authorization, `Bearer ${(api as any).blue.apiKey}`);
  assert.equal(ask.headers['x-blue-conversation'], SECRET);
  assert.deepEqual(ask.json, { fileName: 'order.pdf', contentType: 'application/pdf', size: file.size, conversationId: ID });
  const [put] = puts();
  assert.equal(put.url, `${PLACE}&n=7`);
  assert.deepEqual(put.headers, { 'content-type': 'application/pdf', 'x-amz-meta-made-up': 'yes' });
  assert.equal(put.body, file, 'the file itself, as given');
  // Core's type, each file with its place and no text, since Blue reads files on its server.
  assert.ok(manager instanceof CaptivateChatFileManager);
  assert.equal(manager.files.length, 1);
  const [object] = manager.files;
  assert.equal(object.filename, 'order.pdf');
  assert.equal(object.type, 'application/pdf');
  assert.equal(object.file, file);
  assert.deepEqual(object.upload, { uploadId: uploadId(7), expiresAt: '2099-01-01T00:00:00.000Z' });
  assert.deepEqual(object.textContent, {
    type: 'file_content',
    text: '',
    metadata: { source: 'file_attachment', originalFileName: 'order.pdf', storageType: 'direct' },
  });
  assert.equal(manager.getFilename(), 'order.pdf');
  // The place's address is never logged: anyone holding it could send the file.
  assert.ok(!linesAt('log').some((l) => l.includes('files.example.test')));
  assert.ok(!linesAt('warn').some((l) => l.includes('files.example.test')));
});

test('createFile gives its first file, createMultiple core\'s manager with every file, one place at a time', async () => {
  fake.reply(slot(1), stored());
  const one = await conversation.fileManager.createFile({ file: pdf('a.pdf'), fileName: 'renamed.pdf', fileType: 'application/pdf' });
  assert.equal(one.filename, 'renamed.pdf');
  assert.equal(one.upload?.uploadId, uploadId(1));
  fake.reply(slot(2), stored(), slot(3, { 'Content-Type': 'text/csv' }), stored());
  const many = await conversation.fileManager.createMultiple({ files: [pdf('b.pdf'), new File(['a,b'], 'c.csv', { type: 'text/csv' })] });
  assert.ok(many instanceof CaptivateChatFileManager);
  assert.deepEqual(many.files.map((f) => f.upload?.uploadId), [uploadId(2), uploadId(3)]);
  assert.deepEqual(fake.requests.slice(2).map((r) => r.method), ['POST', 'PUT', 'POST', 'PUT']);
  // A type the backend wouldn't take as a type's form is left out: the extension's is signed.
  fake.reply(slot(4), stored());
  await conversation.fileManager.create({ file: pdf('d.pdf'), fileType: 'not a type' });
  assert.equal(uploads()[3].json.contentType, undefined);
});

test('sendMessage({ text, files }) names the files\' places as attachments, whatever shape core\'s apps pass them in', async () => {
  fake.reply(slot(1), stored(), slot(2), stored());
  const manager = await conversation.fileManager.createMultiple({ files: [pdf('a.pdf'), pdf('b.pdf')] });
  fake.reply(answer());
  await conversation.sendMessage({ text: 'Here they are', files: manager });
  await flush();
  assert.deepEqual(sends()[0].json.attachments, [{ uploadId: uploadId(1) }, { uploadId: uploadId(2) }]);
  assert.equal(sends()[0].json.message, 'Here they are');
  // Its files array, createFile's objects in an array, and files alone with no words.
  fake.reply(answer());
  await conversation.sendMessage({ text: 'Again', files: manager.files });
  await flush();
  assert.deepEqual(sends()[1].json.attachments, [{ uploadId: uploadId(1) }, { uploadId: uploadId(2) }]);
  fake.reply(answer());
  await conversation.sendMessage({ files: [manager.files[1], manager.files[1]] });
  await flush();
  assert.deepEqual(sends()[2].json.attachments, [{ uploadId: uploadId(2) }], 'one file named twice goes once');
  assert.equal(sends()[2].json.message, '');
  // No files: no attachments at all.
  fake.reply(answer());
  await conversation.sendMessage('Plain');
  await flush();
  assert.equal('attachments' in sends()[3].json, false);
});

test('a file without a place from conversation.fileManager, or more than 5, is refused before sending', async () => {
  const core = { filename: 'a.pdf', type: 'application/pdf', textContent: { type: 'file_content', text: 'x', metadata: {} } };
  const calls: Call[] = record(conversation, ['onError']);
  const without = await refusal(() => conversation.sendMessage({ text: 'Hi', files: [core] }));
  assert.equal(without.errorDesc, WORDS.fileNotFound);
  const six = [1, 2, 3, 4, 5, 6].map((n) => ({ upload: { uploadId: uploadId(n), expiresAt: '' } }));
  const tooMany = await refusal(() => conversation.sendMessage({ text: 'Hi', files: six }));
  assert.equal(tooMany.errorDesc, WORDS.filesPerMessage);
  assert.equal(sends().length, 0);
  assert.equal(calls.length, 0, 'a check before sending is the rejection alone');
});

test('too_many_files reads in its own words, on the place and on the send, with no key-refused warning', async () => {
  const tooMany = () => jsonResponse({ error: { code: 'too_many_files', message: 'This conversation has as many files as it can take.' } }, 400);
  fake.reply(tooMany());
  const onPlace = await refusal(() => conversation.fileManager.create({ file: pdf() }));
  assert.equal(onPlace.errorDesc, WORDS.tooManyFiles);
  assert.equal(onPlace.status, 400);
  assert.equal(onPlace.code, 'too_many_files');
  assert.equal(puts().length, 0);
  const calls: Call[] = record(conversation, ['onError']);
  fake.reply(tooMany());
  const onSend = await refusal(() => conversation.sendMessage({ text: 'Hi', files: [{ upload: { uploadId: uploadId(1), expiresAt: '' } }] }));
  assert.equal(onSend.errorDesc, WORDS.tooManyFiles);
  assert.deepEqual(calls[0].args[0], { conversationId: ID, errorCode: 400, errorDesc: WORDS.tooManyFiles });
  assert.ok(!linesAt('warn').some((l) => l.includes(CONSOLE_WORDS.keyRefused)));
  assert.ok(!onPlace.errorDesc.includes('as many files as it can take'), 'the backend\'s own words never pass through');
});

test('a place refused by its type, its size or the day\'s files, and a send\'s 413 and gone file, in §1.2\'s words', async () => {
  fake.reply(jsonResponse({ error: { code: 'unsupported_type', message: 'I can read…' } }, 400));
  assert.equal((await refusal(() => conversation.fileManager.create({ file: pdf() }))).errorDesc, WORDS.fileType);
  fake.reply(jsonResponse({ error: { code: 'too_large', message: 'A file can be at most 20 MB.' } }, 413));
  assert.equal((await refusal(() => conversation.fileManager.create({ file: pdf() }))).errorDesc, WORDS.fileOver20MB);
  fake.reply(jsonResponse({ error: { code: 'day_limit' } }, 429, { 'Retry-After': '40000' }));
  const day = await refusal(() => conversation.fileManager.create({ file: pdf() }));
  assert.equal(day.errorDesc, WORDS.dayOfFiles);
  assert.equal(day.retryAfter, 40000);
  fake.reply(jsonResponse({ error: { code: 'rate_limited' } }, 429, { 'Retry-After': '30' }));
  assert.equal((await refusal(() => conversation.fileManager.create({ file: pdf() }))).errorDesc, WORDS.tooMany);
  const files = [{ upload: { uploadId: uploadId(1), expiresAt: '' } }];
  fake.reply(jsonResponse({ error: { code: 'too_large' } }, 413));
  assert.equal((await refusal(() => conversation.sendMessage({ text: 'Hi', files }))).errorDesc, WORDS.fileTooBig);
  fake.reply(jsonResponse({ error: { code: 'invalid_attachment' } }, 400));
  assert.equal((await refusal(() => conversation.sendMessage({ text: 'Hi', files }))).errorDesc, WORDS.fileNotFound);
  // Without files a send's 413 is a message too long.
  fake.reply(jsonResponse({ error: { code: 'too_large' } }, 413));
  assert.equal((await refusal(() => conversation.sendMessage('x'.repeat(10)))).errorDesc, WORDS.shortenIt);
});

test('a PUT the storage refuses, or that can\'t reach it, is the "couldn\'t answer" words, never tried again', async () => {
  fake.reply(slot(1), new FakeResponse({ status: 403, body: '<Error>SignatureDoesNotMatch</Error>' }));
  const refused = await refusal(() => conversation.fileManager.create({ file: pdf() }));
  assert.equal(refused.errorDesc, WORDS.couldntAnswer);
  assert.equal(refused.status, undefined, 'the storage\'s status isn\'t Blue\'s');
  assert.ok(!linesAt('warn').some((l) => l.includes(CONSOLE_WORDS.keyRefused)), 'the storage refusing isn\'t the key refused');
  fake.reply(slot(2), new TypeError('network error'));
  assert.equal((await refusal(() => conversation.fileManager.create({ file: pdf() }))).errorDesc, WORDS.couldntAnswer);
  assert.equal(puts().length, 2);
  // A place's answer that isn't one: nothing is PUT.
  fake.reply(jsonResponse({ uploadId: 'nope', url: PLACE }, 201));
  assert.equal((await refusal(() => conversation.fileManager.create({ file: pdf() }))).errorDesc, WORDS.couldntAnswer);
  assert.equal(puts().length, 2);
});

test('a PUT may take until its place runs out, then is cut', async () => {
  const soon = new Date(Date.now() + 200).toISOString();
  let seen: RecordedRequest | undefined;
  fake.reply(
    jsonResponse({ uploadId: uploadId(1), url: PLACE, headers: {}, expiresAt: soon }, 201),
    (request) =>
      new Promise<FakeResponse>((_, reject) => {
        seen = request;
        request.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })
  );
  const cut = await refusal(() => conversation.fileManager.create({ file: pdf() }));
  assert.equal(cut.errorDesc, WORDS.couldntAnswer);
  assert.equal(seen?.signal?.aborted, true);
});

test('CaptivateChatFileManager\'s own calls refuse a Blue key; core\'s keys keep them', async () => {
  const key = (api as any).blue.apiKey as string;
  for (const run of [
    () => CaptivateChatFileManager.create({ file: pdf(), apiKey: key }),
    () => CaptivateChatFileManager.createFile({ file: pdf(), apiKey: key }),
    () => CaptivateChatFileManager.createMultiple({ files: [pdf()], apiKey: key }),
  ]) {
    await assert.rejects(run, (error: Error) => error.message === SETUP_WORDS.fileManagerKey);
  }
  assert.equal(fake.requests.length, 0);
  // A core key goes to core's file-to-text service, as before.
  fake.reply(jsonResponse({ success: true, text: 'read', fileKey: 'k', presignedUrl: 'https://example.test/k', expiresIn: 7200 }));
  const core = await CaptivateChatFileManager.create({ file: pdf(), apiKey: 'core-key' });
  assert.equal(core.getTextContent(), 'read');
  assert.equal(fake.last?.url, 'https://file-to-text.prod.captivat.io/api/file-to-text');
});
