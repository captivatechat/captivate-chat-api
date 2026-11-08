// The bot's forms, look-ups and links pressed (first-channels-library-spec §2.8; gaps G4, G5): a
// press's values as the route takes them, and its answer as one message's text. A look-up's rows
// are written as the backend writes a look-up asked in the chat (its rowsText, copied with asText),
// and a look-up that found nothing gives its words as the press's text: they are customers' words,
// an answer and not an error body.
import { BlueOffer } from './ndjson';
import { BlueError, blueError } from './transport';
import { WORDS } from './words';

/** An offer's id, as the backend's press route takes it. */
export const OFFER_ID = /^of-[0-9a-f]{24}$/;

/** One row of a record a look-up found. */
export interface BlueLookupRow {
  label: string;
  value: string;
}

/** POST /v1/chat/:id/offers/:offerId's answer: Blue's PublishedOfferAnswer, as the backend sends it. */
export interface BluePressAnswer {
  offer: { id: string; status: string };
  /** A look-up's: the rows found, or why nothing was (`message`). */
  lookup?: { state: 'found' | 'not_found' | 'failed'; rows?: BlueLookupRow[][]; more?: number; message?: string };
  messages: { _id?: string; role?: string; content?: unknown; at?: string; [field: string]: unknown }[];
}

/** The backend's LOOKUP_WORDS.showing: a look-up that matched more records than it shows. */
const showing = (shown: number, of: number, label: string) => `Showing ${shown} of ${of}. To check one, give its ${label}.`;

// A word joiner: invisible, it keeps "www." and "://" from being read as a link's start.
const JOINER = '⁠';

/** The backend's asText: a value as words in Blue's Markdown, escaped, on one line, never a link. */
export function asText(text: string): string {
  return text
    .replace(/[\\`*_{}[\]()#+!|<>~]/g, (c) => `\\${c}`)
    .replace(/\r?\n/g, ' ')
    .replace(/www\./gi, (m) => `${m.slice(0, 3)}${JOINER}.`)
    .replace(/:\/\//g, `:${JOINER}//`);
}

/** The backend's rowsText: "Status: Shipped" a line for one record, one numbered line each for several. */
export function rowsText(rows: readonly BlueLookupRow[][], more: number | undefined, label: string | undefined): string {
  const line = (row: readonly BlueLookupRow[]) => row.map((r) => `${asText(String(r.label))}: ${asText(String(r.value))}`);
  const body = rows.length === 1 ? line(rows[0]).join('\n') : rows.map((row, i) => `${i + 1}. ${line(row).join(' · ')}`).join('\n');
  return more && more > rows.length && label ? `${body}\n\n${showing(rows.length, more, asText(label))}` : body;
}

/**
 * A press's answer as one message: a look-up's rows (or its words when it found nothing), then the
 * bot's reply. The customer's own "Sent: …" line is the app's to show, so it is left out.
 */
export function pressText(answer: BluePressAnswer, offer: BlueOffer | undefined): string {
  const parts: string[] = [];
  const lookup = answer.lookup;
  if (lookup?.state === 'found' && Array.isArray(lookup.rows) && lookup.rows.length) {
    const fields = Array.isArray(offer?.fields) ? (offer!.fields as { label?: unknown }[]) : [];
    const label = typeof fields[0]?.label === 'string' ? (fields[0].label as string) : undefined;
    parts.push(rowsText(lookup.rows, lookup.more, label));
  } else if (lookup && typeof lookup.message === 'string' && lookup.message) {
    parts.push(lookup.message);
  }
  for (const message of Array.isArray(answer.messages) ? answer.messages : []) {
    if (message?.role === 'assistant' && typeof message.content === 'string' && message.content) parts.push(message.content);
  }
  return parts.join('\n\n');
}

/**
 * A press's values as the route takes them, text alone: numbers as their digits, true and false
 * as "yes" and "no" (a yes-or-no field's values). Anything else is refused before sending, in
 * §1.2's words for a refused form, its name in `fields`.
 */
export function pressValues(values: unknown): Record<string, string> | BlueError {
  if (values === undefined || values === null) return {};
  if (typeof values !== 'object' || Array.isArray(values)) return blueError(WORDS.formRefused, { fields: [] });
  const out: Record<string, string> = {};
  const refused: string[] = [];
  for (const [name, value] of Object.entries(values as Record<string, unknown>)) {
    if (typeof value === 'string') out[name] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[name] = String(value);
    else if (typeof value === 'boolean') out[name] = value ? 'yes' : 'no';
    else refused.push(name);
  }
  return refused.length ? blueError(WORDS.formRefused, { fields: refused }) : out;
}
