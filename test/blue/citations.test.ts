// An answer's [n] markers (first-channels-library-spec §2.4; gaps G6, G15): a draft without them,
// the footer as Vienna 1 writes it, and renumber() for an app that hides some sources.
import './helpers';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftText, renumber, sourcesFooter, withFooter } from '../../src/api/blue/citations';
import { renumber as exported } from '../../src/index';

test('a draft loses its markers and comma lists with the spaces before them', () => {
  assert.equal(draftText('£12 a seat [1].'), '£12 a seat.');
  assert.equal(draftText('£12 a seat [1, 2].'), '£12 a seat.');
  assert.equal(draftText('£12 a seat [1,2][3] and more [12].'), '£12 a seat and more.');
  assert.equal(draftText('Tabs\t[4] too.'), 'Tabs too.');
  assert.equal(draftText('[1] first.'), ' first.');
  assert.equal(draftText('Words [a] and [1234] stay.'), 'Words [a] and [1234] stay.');
});

test('a marker or a list cut in half at the end is held back, and comes out whole', () => {
  for (const held of ['£12 a seat [', '£12 a seat [1', '£12 a seat [12', '£12 a seat [1,', '£12 a seat [1, ', '£12 a seat [1, 2', '£12 a seat  ']) {
    assert.equal(draftText(held), '£12 a seat', JSON.stringify(held));
  }
  assert.equal(draftText('£12 a seat [1, 2]'), '£12 a seat');
  assert.equal(draftText('£12 a seat [1, 2].'), '£12 a seat.');
  assert.equal(draftText('Ask about 漢字 or 🎉 groups [3'), 'Ask about 漢字 or 🎉 groups');
});

test('the footer: "Sources:", a line a source, an untitled one an internal document, after a blank line', () => {
  const sources = [
    { number: 1, title: 'Price list 2026', page: 2 },
    { number: 2, title: 'Pricing', url: 'https://acme.example/pricing' },
    { number: 3, title: null },
    { number: 4, title: '  [Draft] <notes>\n  ' },
  ];
  assert.equal(
    sourcesFooter(sources),
    'Sources:\n- [1] Price list 2026, page 2\n- [2] Pricing – https://acme.example/pricing\n- [3] Internal document\n- [4] Draft) ＜notes>'
  );
  assert.equal(sourcesFooter([]), '');
  assert.equal(withFooter('Hello.', []), 'Hello.');
  assert.equal(withFooter('Hi [1].', [{ number: 1, title: 'A' }]), 'Hi [1].\n\nSources:\n- [1] A');
});

test('renumber(): the kept sources 1 to k by first use, the hidden ones\' markers out with their spaces', () => {
  const sources = [
    { number: 1, title: 'A' },
    { number: 2, title: 'Internal' },
    { number: 3, title: 'C' },
  ];
  assert.deepEqual(renumber('One [1], two [2], three [3].', sources, [1, 3]), {
    text: 'One [1], two, three [2].',
    sources: [
      { number: 1, title: 'A' },
      { number: 2, title: 'C' },
    ],
  });
  // A kept marker after a hidden one keeps the run's spaces; a comma list is the markers side by side.
  assert.equal(renumber('A seat [2][1].', sources, [1]).text, 'A seat [1].');
  assert.equal(renumber('A seat [2, 3].', sources, (s) => s.title !== 'Internal').text, 'A seat [1].');
  // First use decides, and a kept source the text never cites goes last.
  assert.deepEqual(renumber('Then [3] before [1].', sources, [1, 3]).sources.map((s) => s.title), ['C', 'A']);
  assert.deepEqual(renumber('Only [3].', sources, [1, 3]).sources, [
    { number: 1, title: 'C' },
    { number: 2, title: 'A' },
  ]);
  // A number no source has is left as it was.
  assert.equal(renumber('See [9].', sources, [1]).text, 'See [9].');
  assert.equal(exported, renumber);
});
