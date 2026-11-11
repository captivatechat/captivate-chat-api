// Blue mode's line reader and its UTF-8 decoder (first-channels-library-spec §2.3; gaps G15).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_MAX_BYTES, lineReader, ownUtf8Stream, utf8Length, utf8Stream } from '../../src/api/blue/ndjson';

const line = (event: unknown) => `${JSON.stringify(event)}\n`;

test('lines split on newlines, keep the partial tail and give it with the piece that ends it', () => {
  const reader = lineReader();
  assert.deepEqual(reader.lines('{"type":"conversation","conversationId":"c1"}\n{"type":"del'), {
    events: [{ type: 'conversation', conversationId: 'c1' }],
  });
  assert.deepEqual(reader.lines('ta","text":"Hi"}\n'), { events: [{ type: 'delta', text: 'Hi' }] });
  assert.deepEqual(reader.lines(line({ type: 'text', text: 'Hi.' }) + line({ type: 'done' })), {
    events: [{ type: 'text', text: 'Hi.' }, { type: 'done' }],
  });
  assert.deepEqual(reader.end(), { events: [] });
});

test('carriage returns are trimmed and blank lines, the keep-alives, are skipped', () => {
  const reader = lineReader();
  assert.deepEqual(reader.lines('\n\n{"type":"reset"}\r\n\r\n   \n{"type":"done"}\r'), { events: [{ type: 'reset' }] });
  assert.deepEqual(reader.lines('\n'), { events: [{ type: 'done' }] });
  assert.deepEqual(lineReader().lines('\n\n\n'), { events: [] });
});

test('a last line without its newline is read when the body ends', () => {
  const reader = lineReader();
  assert.deepEqual(reader.lines('{"type":"text","text":"End"}\n{"type":"done"}'), { events: [{ type: 'text', text: 'End' }] });
  assert.deepEqual(reader.end(), { events: [{ type: 'done' }] });
  assert.deepEqual(reader.end(), { events: [] });
});

test('unknown types, verification and known types missing what they carry are ignored', () => {
  const reader = lineReader();
  const body = [
    { type: 'verification', verification: {} },
    { type: 'future' },
    { kind: 'delta' },
    [1, 2],
    null,
    42,
    { type: 'delta' },
    { type: 'conversation', conversationId: 7 },
    { type: 'choices', choices: ['Yes', 2] },
    { type: 'offer', offer: { title: 'No id' } },
    { type: 'error' },
    { type: 'step', label: 'Looking into it' },
  ]
    .map(line)
    .join('');
  assert.deepEqual(reader.lines(body), { events: [{ type: 'step', label: 'Looking into it' }] });
});

test('a line that is not JSON breaks the stream after the events before it', () => {
  const reader = lineReader();
  assert.deepEqual(reader.lines('{"type":"reset"}\n<html>502</html>\n{"type":"done"}\n'), {
    events: [{ type: 'reset' }],
    problem: 'not-json',
  });
  assert.deepEqual(reader.lines(line({ type: 'done' })), { events: [], problem: 'not-json' });
  assert.deepEqual(reader.end(), { events: [], problem: 'not-json' });
  assert.deepEqual(lineReader().lines('{"type":').problem, undefined);
  const cutShort = lineReader();
  cutShort.lines('{"type":');
  assert.deepEqual(cutShort.end(), { events: [], problem: 'not-json' });
});

test('the line cap is 1,048,576 UTF-8 bytes, whole or still arriving (gaps G15)', () => {
  const event = (text: string) => JSON.stringify({ type: 'delta', text });
  const room = LINE_MAX_BYTES - event('').length;
  assert.equal(lineReader().lines(`${event('a'.repeat(room))}\n`).events.length, 1);
  assert.equal(lineReader().lines(`${event('a'.repeat(room + 1))}\n`).problem, 'line-too-long');
  // Under the cap in characters, over it in bytes: é is two.
  const accented = event('é'.repeat(Math.ceil(room / 2) + 1));
  assert.ok(accented.length < LINE_MAX_BYTES);
  assert.equal(lineReader().lines(`${accented}\n`).problem, 'line-too-long');
  // A tail that grows past the cap breaks the stream before its newline comes.
  const growing = lineReader();
  assert.equal(growing.lines('{"type":"delta","text":"').problem, undefined);
  assert.equal(growing.lines('a'.repeat(LINE_MAX_BYTES)).problem, 'line-too-long');
  assert.equal(growing.lines('"}\n').problem, 'line-too-long');
});

test('utf8Length counts bytes, surrogate pairs as four', () => {
  assert.equal(utf8Length('abc'), 3);
  assert.equal(utf8Length('é'), 2);
  assert.equal(utf8Length('漢'), 3);
  assert.equal(utf8Length('🎉'), 4);
  assert.equal(utf8Length('\ud83c'), 3);
  for (const text of ['£12 a seat [1, 2].', '漢字 and 🎉 and é', '\u0000\u007f\u0080߿ࠀ￿']) {
    assert.equal(utf8Length(text), Buffer.byteLength(text, 'utf8'));
  }
});

const MIXED = 'Plain, é, 漢字, 🎉, £12 [1, 2]. 👩‍💻 done';

function decodeSplit(make: () => { decode(b: Uint8Array): string; end(): string }, bytes: Uint8Array, at: number[]): string {
  const decoder = make();
  let text = '';
  let from = 0;
  for (const cut of [...at, bytes.length]) {
    text += decoder.decode(bytes.subarray(from, cut));
    from = cut;
  }
  return text + decoder.end();
}

test('the own decoder gives every character whole, wherever the chunks split it', () => {
  const bytes = new Uint8Array(Buffer.from(MIXED, 'utf8'));
  for (let at = 0; at <= bytes.length; at++) {
    assert.equal(decodeSplit(ownUtf8Stream, bytes, [at]), MIXED, `split at byte ${at}`);
  }
  // One byte a chunk.
  assert.equal(
    decodeSplit(ownUtf8Stream, bytes, Array.from({ length: bytes.length }, (_, i) => i)),
    MIXED
  );
});

test('the own decoder reads bad bytes as TextDecoder does', () => {
  const cases = [
    [0xff, 0x41],
    [0xc0, 0xaf],
    [0xe2, 0x82],
    [0xed, 0xa0, 0x80],
    [0xf0, 0x9f, 0x8e],
    [0xf4, 0x90, 0x80, 0x80],
    [0x41, 0xc3],
    [0xe6, 0xbc, 0x41, 0xa2],
  ];
  for (const raw of cases) {
    const bytes = new Uint8Array(raw);
    const expected = new TextDecoder('utf-8').decode(bytes);
    for (let at = 0; at <= bytes.length; at++) {
      assert.equal(decodeSplit(ownUtf8Stream, bytes, [at]), expected, `${raw.join(',')} split at ${at}`);
    }
  }
});

test('utf8Stream uses TextDecoder where there is one, and the own decoder where there is none', () => {
  const bytes = new Uint8Array(Buffer.from(MIXED, 'utf8'));
  assert.equal(decodeSplit(utf8Stream, bytes, [9, 10, 17]), MIXED);
  const original = (globalThis as any).TextDecoder;
  let made = 0;
  (globalThis as any).TextDecoder = class {
    constructor() {
      made += 1;
    }
    decode() {
      return 'from TextDecoder';
    }
  };
  try {
    assert.equal(utf8Stream().decode(bytes), 'from TextDecoder');
    assert.equal(made, 1);
    delete (globalThis as any).TextDecoder;
    assert.equal(decodeSplit(utf8Stream, bytes, [9, 10, 17]), MIXED);
  } finally {
    (globalThis as any).TextDecoder = original;
  }
});
