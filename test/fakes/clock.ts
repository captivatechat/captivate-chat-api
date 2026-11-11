// A clock the tests move by hand, for Blue mode's stream (its Clock option): timers fire in
// order of when they fall due, only inside tick(), so a test can stand at 44,999 ms and look.

interface Timer {
  at: number;
  order: number;
  run: () => void;
}

export class FakeClock {
  private time = 0;
  private made = 0;
  private readonly timers = new Map<number, Timer>();

  readonly setTimeout = (run: () => void, ms: number): number => {
    this.made += 1;
    this.timers.set(this.made, { at: this.time + Math.max(0, ms), order: this.made, run });
    return this.made;
  };

  readonly clearTimeout = (id: unknown): void => {
    this.timers.delete(id as number);
  };

  readonly now = (): number => this.time;

  /** Moves time on by `ms`, firing each timer that falls due, earliest first. */
  tick(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      let next: [number, Timer] | undefined;
      for (const entry of this.timers) {
        if (entry[1].at > end) continue;
        if (!next || entry[1].at < next[1].at || (entry[1].at === next[1].at && entry[1].order < next[1].order)) next = entry;
      }
      if (!next) break;
      this.timers.delete(next[0]);
      this.time = next[1].at;
      next[1].run();
    }
    this.time = end;
  }

  /** How many timers are set. */
  get pending(): number {
    return this.timers.size;
  }
}
