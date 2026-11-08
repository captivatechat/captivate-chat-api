// Storage the tests can read back: a localStorage-like one (sync) and an AsyncStorage-like
// one (React Native's, every call a promise). Both record every write.

export class FakeStorage {
  private readonly items = new Map<string, string>();
  /** Every setItem and removeItem, in order. */
  readonly writes: { op: 'set' | 'remove'; key: string; value?: string }[] = [];

  get length(): number {
    return this.items.size;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.items.has(key) ? (this.items.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, String(value));
    this.writes.push({ op: 'set', key, value: String(value) });
  }

  removeItem(key: string): void {
    this.items.delete(key);
    this.writes.push({ op: 'remove', key });
  }

  clear(): void {
    this.items.clear();
  }

  /** Everything stored, for assertions. */
  entries(): [string, string][] {
    return [...this.items];
  }
}

/** AsyncStorage's shape: the same store, every call answered on a later turn. */
export class FakeAsyncStorage {
  readonly store = new FakeStorage();

  async getItem(key: string): Promise<string | null> {
    await Promise.resolve();
    return this.store.getItem(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    await Promise.resolve();
    this.store.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    await Promise.resolve();
    this.store.removeItem(key);
  }
}

/** Storage that throws on every call, as a private window's or a blocked site's can. */
export class ThrowingStorage {
  getItem(): string | null {
    throw new Error('Storage is not available');
  }
  setItem(): void {
    throw new Error('Storage is not available');
  }
  removeItem(): void {
    throw new Error('Storage is not available');
  }
}
