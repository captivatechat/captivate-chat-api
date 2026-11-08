// Files in Blue mode (first-channels-library-spec §2.9; gaps G14, G16): checked here first by
// the backend's own limits, then each given a place by POST /v1/chat/uploads and PUT there by
// the app itself, so Blue reads it on its server. A message names its files by their places'
// ids. Always on for app keys (decision 10 (c)).
import { CaptivateChatFileManager } from '../CaptivateChatFileManager';
import { BlueTransport, blueError } from './transport';
import { WORDS } from './words';

/** What a customer can send, as Blue's shared/published-chat/constants.ts lists them. */
export const FILE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.md', '.markdown', '.csv'];
/** The biggest file, as the backend takes it. */
export const FILE_MAX_BYTES = 20 * 1024 * 1024;
/** Files with one message. */
export const FILES_PER_MESSAGE = 5;
/** A place's PUT must start within this when its answer gives no expiresAt (the backend's UPLOAD_URL_SECONDS). */
const PUT_MS = 15 * 60 * 1000;

const UPLOAD_ID = /^[0-9a-f]{32}$/;
/** The backend's check of a contentType's form; a type that fails it is left out, since the extension's is signed. */
const MEDIA_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/;

/** A file's place, kept on its file object for the message that sends it. */
export interface BlueUpload {
  uploadId: string;
  expiresAt: string;
}

/** What conversation.fileManager's calls take, as core's do. */
export interface BlueFileInput {
  file: Blob;
  fileName?: string;
  fileType?: string;
  /** Core's `false` (a file referenced by its URL) is refused. */
  storage?: boolean;
  url?: string;
}

/** For the developer: what the library can't PUT. */
const NOT_A_FILE = 'fileManager takes a File or a Blob as file.';

/** A check before sending: its words, as an Error the app can show (`errorDesc`). */
function refused(words: string): Error {
  const error = new Error(words) as Error & { errorDesc: string };
  error.errorDesc = words;
  return error;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/** A file's name and type as core's create gives them. */
function named(input: BlueFileInput): { name: string; type: string } {
  const file = input.file as Blob & { name?: unknown };
  const name = (input.fileName || (typeof file?.name === 'string' && file.name) || `attachment_${Date.now()}`).trim();
  const type = input.fileType || (typeof file?.type === 'string' && file.type) || 'application/octet-stream';
  return { name, type };
}

/** Every file checked before any is sent: storage, the extension, 20 MB, and 5 at once. */
function checked(inputs: BlueFileInput[]): { input: BlueFileInput; name: string; type: string; size: number }[] {
  if (inputs.length > FILES_PER_MESSAGE) throw refused(WORDS.filesPerMessage);
  return inputs.map((input) => {
    if (input.storage === false) throw refused(WORDS.cantSendFiles);
    const { name, type } = named(input);
    if (!FILE_EXTENSIONS.includes(extensionOf(name))) throw refused(WORDS.fileType);
    const size = (input.file as Blob | undefined)?.size;
    if (typeof size !== 'number' || !Number.isFinite(size)) throw new Error(NOT_A_FILE);
    if (size > FILE_MAX_BYTES) throw refused(WORDS.fileOver20MB);
    return { input, name, type, size };
  });
}

/** Asks Blue for a file's place, then PUTs the file there; the PUT may take until its place runs out (gaps G16). */
async function upload(
  transport: BlueTransport,
  conversationId: string,
  secret: string,
  file: { input: BlueFileInput; name: string; type: string; size: number }
): Promise<BlueUpload> {
  const slot = await transport.request<{ uploadId?: unknown; url?: unknown; headers?: unknown; expiresAt?: unknown }>(
    'POST',
    '/v1/chat/uploads',
    {
      call: 'upload',
      secret,
      body: {
        fileName: file.name,
        ...(MEDIA_TYPE.test(file.type) ? { contentType: file.type } : {}),
        size: file.size,
        conversationId,
      },
    }
  );
  const uploadId = slot?.uploadId;
  const url = slot?.url;
  if (typeof uploadId !== 'string' || !UPLOAD_ID.test(uploadId) || typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    throw blueError(WORDS.couldntAnswer);
  }
  const headers: Record<string, string> = {};
  if (slot.headers && typeof slot.headers === 'object') {
    for (const [name, value] of Object.entries(slot.headers as Record<string, unknown>)) {
      if (typeof value === 'string') headers[name] = value;
    }
  }
  const expiresAt = typeof slot.expiresAt === 'string' ? slot.expiresAt : new Date(Date.now() + PUT_MS).toISOString();
  const until = Date.parse(expiresAt);
  await put(transport, url, headers, file.input.file, Number.isNaN(until) ? PUT_MS : Math.max(0, until - Date.now()));
  return { uploadId, expiresAt };
}

/**
 * The file to its place with exactly the place's headers, both signed. Never logged by its
 * address, which lets anyone holding it send the file; a failure is the "couldn't answer" words.
 */
async function put(transport: BlueTransport, url: string, headers: Record<string, string>, body: Blob, timeoutMs: number): Promise<void> {
  const fetchImpl = transport.fetchImpl;
  if (!fetchImpl) throw blueError(WORDS.couldntAnswer);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const untrack = transport.track({ abort: () => controller?.abort() });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const call = fetchImpl(url, { method: 'PUT', headers, body, credentials: 'omit', signal: controller?.signal });
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error('timed out'));
    }, timeoutMs);
  });
  let status: number | undefined;
  try {
    const response = await Promise.race([call, deadline]);
    status = response?.status;
    if (!response?.ok) throw new Error('refused');
  } catch (_) {
    call.catch(() => undefined);
    transport.logger.log(`Blue PUT upload: ${status ?? 'not reached'}`);
    throw blueError(WORDS.couldntAnswer);
  } finally {
    clearTimeout(timer);
    untrack();
  }
  transport.logger.log(`Blue PUT upload: ${status}`);
}

/** One file object, in core's shape, with its place added and no text (Blue reads files on its server). */
function fileObject(file: { input: BlueFileInput; name: string; type: string }, place: BlueUpload) {
  return {
    filename: file.name,
    type: file.type,
    file: file.input.file,
    textContent: {
      type: 'file_content' as const,
      text: '',
      metadata: { source: 'file_attachment' as const, originalFileName: file.name, storageType: 'direct' as const },
    },
    upload: place,
  };
}

/** conversation.fileManager in Blue mode: core's three calls, returning core's types. */
export function blueFileManager(
  transport: BlueTransport,
  conversationId: string,
  secret: () => Promise<string>
): {
  create(options: BlueFileInput): Promise<CaptivateChatFileManager>;
  createFile(options: BlueFileInput): Promise<CaptivateChatFileManager['files'][number]>;
  createMultiple(options: { files: Blob[]; storage?: boolean; urls?: string[] }): Promise<CaptivateChatFileManager>;
} {
  // One at a time, so a refused file stops the rest and the minute's limit on places isn't spent at once.
  const made = async (inputs: BlueFileInput[]): Promise<CaptivateChatFileManager> => {
    const files = checked(inputs);
    const key = await secret();
    const objects = [];
    for (const file of files) objects.push(fileObject(file, await upload(transport, conversationId, key, file)));
    // Core's constructor holds one file; the list replaces it, as core's createMultiple does.
    const first = objects[0] ?? fileObject({ input: { file: undefined as any }, name: '', type: '' }, { uploadId: '', expiresAt: '' });
    const manager = new CaptivateChatFileManager(first.file, first.textContent, first.type);
    (manager as any).files = objects;
    return CaptivateChatFileManager.createProxy(manager);
  };
  return {
    create: (options) => made([options]),
    createFile: async (options) => (await made([options])).files[0],
    createMultiple: (options) =>
      made((Array.isArray(options?.files) ? options.files : []).map((file) => ({ file, storage: options.storage }))),
  };
}

/**
 * A message's `attachments`, from what core's apps pass as `files`: a file manager, its `files`,
 * an array of either, or one file object. A file without a place from conversation.fileManager is
 * refused before sending, and so are more than 5.
 */
export function attachmentsOf(files: unknown): { uploadId: string }[] {
  if (files === undefined || files === null) return [];
  const objects: unknown[] = [];
  const take = (item: unknown) => {
    const inner = (item as { files?: unknown } | null)?.files;
    if (Array.isArray(inner)) objects.push(...inner);
    else objects.push(item);
  };
  if (Array.isArray(files)) files.forEach(take);
  else take(files);
  const ids: string[] = [];
  for (const object of objects) {
    const uploadId = (object as { upload?: { uploadId?: unknown } } | null)?.upload?.uploadId;
    if (typeof uploadId !== 'string' || !UPLOAD_ID.test(uploadId)) throw refused(WORDS.fileNotFound);
    if (!ids.includes(uploadId)) ids.push(uploadId);
  }
  if (ids.length > FILES_PER_MESSAGE) throw refused(WORDS.filesPerMessage);
  return ids.map((uploadId) => ({ uploadId }));
}
