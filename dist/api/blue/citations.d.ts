import { BlueSource } from './ndjson';
/** A draft as an app shows it: its markers out, and the end that could still become one held back. */
export declare function draftText(draft: string): string;
/** "Sources:" and a line per source, as Vienna 1's sourcesFooter writes it; "" with none. */
export declare function sourcesFooter(sources: BlueSource[]): string;
/** The final text with its footer after a blank line, or the text alone when there are no sources. */
export declare function withFooter(text: string, sources: BlueSource[]): string;
/**
 * For an app that hides some sources: the text's markers and the list renumbered together, 1 to k
 * by first use (then the kept sources the text never cites, in their order), the hidden ones'
 * markers taken out with the spaces before them, but for one a kept marker follows ("a seat
 * [2][1]" reads "a seat [1]"). A comma list counts as the markers side by side. `keep` names the
 * sources kept, by number or by a test. The library never calls it: the backend's numbers already
 * match the final text.
 */
export declare function renumber(text: string, sources: BlueSource[], keep: number[] | ((source: BlueSource) => boolean)): {
    text: string;
    sources: BlueSource[];
};
