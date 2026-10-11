// Usage dedup: one API response is written as several transcript lines that
// share message.id and repeat the same usage block (spec §3.2).

export function dedupKey(messageId: string, requestId?: string): string {
  return requestId ? `${messageId}:${requestId}` : messageId;
}

export class DedupSet {
  private readonly keys = new Set<string>();

  has(key: string): boolean {
    return this.keys.has(key);
  }

  /** Returns true if the key was new. */
  add(key: string): boolean {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
  }

  get size(): number {
    return this.keys.size;
  }
}
