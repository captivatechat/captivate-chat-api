import { BlueOffer } from './ndjson';
import { BlueError } from './transport';
/** An offer's id, as the backend's press route takes it. */
export declare const OFFER_ID: RegExp;
/** One row of a record a look-up found. */
export interface BlueLookupRow {
    label: string;
    value: string;
}
/** POST /v1/chat/:id/offers/:offerId's answer: Blue's PublishedOfferAnswer, as the backend sends it. */
export interface BluePressAnswer {
    offer: {
        id: string;
        status: string;
    };
    /** A look-up's: the rows found, or why nothing was (`message`). */
    lookup?: {
        state: 'found' | 'not_found' | 'failed';
        rows?: BlueLookupRow[][];
        more?: number;
        message?: string;
    };
    messages: {
        _id?: string;
        role?: string;
        content?: unknown;
        at?: string;
        [field: string]: unknown;
    }[];
}
/** The backend's asText: a value as words in Blue's Markdown, escaped, on one line, never a link. */
export declare function asText(text: string): string;
/** The backend's rowsText: "Status: Shipped" a line for one record, one numbered line each for several. */
export declare function rowsText(rows: readonly BlueLookupRow[][], more: number | undefined, label: string | undefined): string;
/**
 * A press's answer as one message: a look-up's rows (or its words when it found nothing), then the
 * bot's reply. The customer's own "Sent: …" line is the app's to show, so it is left out.
 */
export declare function pressText(answer: BluePressAnswer, offer: BlueOffer | undefined): string;
/**
 * A press's values as the route takes them, text alone: numbers as their digits, true and false
 * as "yes" and "no" (a yes-or-no field's values). Anything else is refused before sending, in
 * §1.2's words for a refused form, its name in `fields`.
 */
export declare function pressValues(values: unknown): Record<string, string> | BlueError;
