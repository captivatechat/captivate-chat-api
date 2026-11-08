// An answer's [n] markers (first-channels-library-spec §2.4; gaps G6, G15): taken out of a draft,
// whose numbers are the flow's and not the final text's; the sources footer onMessage adds as
// Vienna 1 writes it; and renumber() for an app that hides some sources. The patterns are the
// backend's (chat/utils.ts: MARKER, OPEN_END, COMMA_LIST, MARKER_RUN), copied; Vienna ports them.
import { BlueSource } from './ndjson';

// A marker or a comma list of them ("[1]", "[1, 2]"), with the spaces before it, so "£12 a seat
// [1]." reads "£12 a seat.". Each starts at the first of those spaces, as the backend's: without
// the lookbehind every space of a long run is tried against the rest of it.
const DRAFT_MARKER = /(?<![ \t])[ \t]*\[\d{1,3}(?:\s*,\s*\d{1,3})*\]/g;
// The end of a draft that could still become one: spaces, then "[", "[1", "[1," or "[1, 2".
const DRAFT_OPEN_END = /(?<![ \t])[ \t]*(?:\[(?:\d{1,3}\s*,\s*)*\d{0,3})?$/;

/** A draft as an app shows it: its markers out, and the end that could still become one held back. */
export function draftText(draft: string): string {
  return draft.replace(DRAFT_MARKER, '').replace(DRAFT_OPEN_END, '');
}

/** "Sources:" (gaps G15: after a blank line, as Vienna 1 joins it). */
const SOURCES_HEADING = 'Sources:';
/** A source the customer may not see the title of. */
const INTERNAL_SOURCE = 'Internal document';

const footerTitle = (title: string | null | undefined) =>
  (title ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/</g, '＜')
    .replace(/^[\s(]+/, '')
    .trim();

/** "Sources:" and a line per source, as Vienna 1's sourcesFooter writes it; "" with none. */
export function sourcesFooter(sources: BlueSource[]): string {
  if (!sources.length) return '';
  const line = (s: BlueSource) =>
    `- [${s.number}] ${footerTitle(s.title) || INTERNAL_SOURCE}${s.page ? `, page ${s.page}` : ''}${s.url ? ` – ${s.url}` : ''}`;
  return [SOURCES_HEADING, ...sources.map(line)].join('\n');
}

/** The final text with its footer after a blank line, or the text alone when there are no sources. */
export function withFooter(text: string, sources: BlueSource[]): string {
  const footer = sourcesFooter(sources);
  return footer ? `${text}\n\n${footer}` : text;
}

const COMMA_LIST = /\[(\d{1,3}(?:\s*,\s*\d{1,3})+)\]/g;
// Markers side by side ("[1][2]", "[1] [2]"), with the spaces before them, and each one with the spaces before it.
const MARKER_RUN = /(?<![ \t])[ \t]*\[\d{1,3}\](?:[ \t]*\[\d{1,3}\])*/g;
const RUN_MARKER = /([ \t]*)\[(\d{1,3})\]/g;
const CITATION = /\[(\d{1,3})\]/g;

/** Every match of a global pattern (String.prototype.matchAll is past the ES6 the library targets). */
function allMatches(pattern: RegExp, text: string): RegExpExecArray[] {
  const found: RegExpExecArray[] = [];
  const re = new RegExp(pattern.source, pattern.flags);
  for (let m = re.exec(text); m; m = re.exec(text)) found.push(m);
  return found;
}

/**
 * For an app that hides some sources: the text's markers and the list renumbered together, 1 to k
 * by first use (then the kept sources the text never cites, in their order), the hidden ones'
 * markers taken out with the spaces before them, but for one a kept marker follows ("a seat
 * [2][1]" reads "a seat [1]"). A comma list counts as the markers side by side. `keep` names the
 * sources kept, by number or by a test. The library never calls it: the backend's numbers already
 * match the final text.
 */
export function renumber(
  text: string,
  sources: BlueSource[],
  keep: number[] | ((source: BlueSource) => boolean)
): { text: string; sources: BlueSource[] } {
  const kept = new Set(
    sources.filter((s) => (typeof keep === 'function' ? keep(s) : keep.includes(s.number))).map((s) => s.number)
  );
  const known = new Set(sources.map((s) => s.number));
  const sideBySide = text.replace(COMMA_LIST, (_list, numbers: string) =>
    numbers
      .split(/\s*,\s*/)
      .map((n) => `[${n}]`)
      .join('')
  );
  const order = new Map<number, number>();
  for (const match of allMatches(CITATION, sideBySide)) {
    const n = Number(match[1]);
    if (kept.has(n) && !order.has(n)) order.set(n, order.size + 1);
  }
  for (const s of sources) if (kept.has(s.number) && !order.has(s.number)) order.set(s.number, order.size + 1);

  const out = sideBySide.replace(MARKER_RUN, (run) => {
    // A number no source has is left as it was.
    const parts = allMatches(RUN_MARKER, run).filter((m) => !known.has(Number(m[2])) || kept.has(Number(m[2])));
    if (!parts.length) return '';
    const lead = /^[ \t]*/.exec(run)![0];
    return (
      lead +
      parts
        .map((m, i) => {
          const n = Number(m[2]);
          return `${i ? m[1] : ''}[${order.get(n) ?? n}]`;
        })
        .join('')
    );
  });
  const renumbered = sources
    .filter((s) => kept.has(s.number))
    .map((s) => ({ ...s, number: order.get(s.number)! }))
    .sort((a, b) => a.number - b.number);
  return { text: out, sources: renumbered };
}
