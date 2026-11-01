import type { WorkItemRepository } from "./repository";
import type { BoardContext, CreateWorkItemInput, WorkItem, WorkItemDetail, WorkItemPatch, WorkItemQuery } from "./types";

/**
 * Small TTL cache with in-flight de-duplication: two tools asking for the
 * same thing at once share one request.
 */
export class TtlCache {
  private entries = new Map<string, { value: Promise<unknown>; expires: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return hit.value as Promise<T>;
    const value = load();
    this.entries.set(key, { value, expires: this.now() + ttlMs });
    // Never cache failures.
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }

  set<T>(key: string, ttlMs: number, value: T) {
    this.entries.set(key, { value: Promise.resolve(value), expires: this.now() + ttlMs });
  }

  invalidate(prefix: string) {
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key);
  }

  /** Drops expired entries; called occasionally so the map doesn't grow forever. */
  sweep() {
    const now = this.now();
    for (const [key, e] of this.entries) if (e.expires <= now) this.entries.delete(key);
  }
}

export const CONTEXT_TTL_MS = 15 * 60_000;
export const QUERY_TTL_MS = 60_000;
export const ITEM_TTL_MS = 30_000;

/**
 * Caches a remote board per user: query results for a minute and items for
 * 30 seconds (filled from query results, so "tell me about the second one"
 * needs no request). Any write drops that user's queries and the changed
 * items. The project context is cached by the inner board's own loader
 * (see boardFactory), because the inner board needs it for every call too.
 */
export class CachedBoard implements WorkItemRepository {
  constructor(
    private readonly inner: WorkItemRepository,
    private readonly cache: TtlCache,
    /** Namespaces entries by user and project. */
    private readonly prefix: string,
  ) {}

  context(): Promise<BoardContext> {
    return this.inner.context();
  }

  async query(q: WorkItemQuery): Promise<WorkItem[]> {
    const items = await this.cache.get(`${this.prefix}q:${JSON.stringify(q)}`, QUERY_TTL_MS, () => this.inner.query(q));
    for (const item of items) this.cache.set(`${this.prefix}item:${item.id}`, ITEM_TTL_MS, item);
    return items;
  }

  get(id: number): Promise<WorkItem | null> {
    return this.cache.get(`${this.prefix}item:${id}`, ITEM_TTL_MS, () => this.inner.get(id));
  }

  getDetail(id: number): Promise<WorkItemDetail | null> {
    return this.cache.get(`${this.prefix}detail:${id}`, ITEM_TTL_MS, () => this.inner.getDetail(id));
  }

  async create(input: CreateWorkItemInput): Promise<WorkItem> {
    const item = await this.inner.create(input);
    this.afterWrite([item.id, input.parentId ?? undefined]);
    return item;
  }

  async update(id: number, patch: WorkItemPatch, expectedRev?: number): Promise<WorkItem> {
    try {
      const item = await this.inner.update(id, patch, expectedRev);
      this.afterWrite([id, item.parentId ?? undefined, patch.parentId ?? undefined]);
      this.cache.set(`${this.prefix}item:${id}`, ITEM_TTL_MS, item);
      return item;
    } catch (err) {
      // A conflict means our copy is stale.
      this.afterWrite([id]);
      throw err;
    }
  }

  async deleteComment(itemId: number, commentId: number): Promise<void> {
    await this.inner.deleteComment(itemId, commentId);
    this.afterWrite([itemId]);
  }

  private afterWrite(ids: Array<number | undefined>) {
    this.cache.invalidate(`${this.prefix}q:`);
    for (const id of ids) {
      if (id === undefined) continue;
      this.cache.invalidate(`${this.prefix}item:${id}`);
      this.cache.invalidate(`${this.prefix}detail:${id}`);
    }
  }
}
