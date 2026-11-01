import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { categoryOf, sprintNameFor } from "./process";
import { WorkItemError, type WorkItemRepository } from "./repository";
import { buildSeed, emulatedContext, type StoredItem } from "./seed";
import type {
  BoardContext,
  CreateWorkItemInput,
  WorkItem,
  WorkItemComment,
  WorkItemDetail,
  WorkItemPatch,
  WorkItemQuery,
} from "./types";

/** Bumped when the stored shape changes; older files are reseeded. */
const DATA_VERSION = 2;

interface BoardData {
  version: number;
  nextId: number;
  items: StoredItem[];
  /** Discussion per item id, oldest first. Optional so older files keep working. */
  comments?: Record<string, WorkItemComment[]>;
  nextCommentId?: number;
}

export interface BoardStorage {
  load(): Promise<BoardData | null>;
  save(data: BoardData): Promise<void>;
}

export function fileStorage(filePath: string): BoardStorage {
  return {
    async load() {
      try {
        return JSON.parse(await readFile(filePath, "utf8")) as BoardData;
      } catch {
        return null;
      }
    },
    async save(data) {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(data, null, 2));
    },
  };
}

export function memoryStorage(): BoardStorage {
  let data: BoardData | null = null;
  return {
    async load() {
      return data && structuredClone(data);
    },
    async save(next) {
      data = structuredClone(next);
    },
  };
}

export function validateTitle(title: string) {
  const trimmed = title.trim();
  if (trimmed.length < 3) throw new WorkItemError("Title must be at least 3 characters.", "invalid");
  if (trimmed.length > 255) throw new WorkItemError("Title must be at most 255 characters.", "invalid");
  return trimmed;
}

export function validatePriority(priority: number) {
  if (!Number.isInteger(priority) || priority < 1 || priority > 4) {
    throw new WorkItemError("Priority must be a whole number from 1 to 4.", "invalid");
  }
}

/**
 * A local stand-in for an Azure DevOps project on the Agile process, with
 * the same hierarchy, sprints and state rules the REST adapter exposes.
 * Persisted to a JSON file so changes survive restarts.
 */
export class EmulatedBoard implements WorkItemRepository {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly storage: BoardStorage,
    readonly currentUser: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async context(): Promise<BoardContext> {
    return emulatedContext(this.currentUser, this.now());
  }

  private async data(): Promise<BoardData> {
    const existing = await this.storage.load();
    if (existing?.version === DATA_VERSION) return existing;
    const items = buildSeed(this.currentUser, this.now());
    const seeded = { version: DATA_VERSION, nextId: Math.max(...items.map((i) => i.id)) + 1, items };
    await this.storage.save(seeded);
    return seeded;
  }

  /** Serialises read-modify-write cycles so concurrent tool calls can't clobber each other. */
  private mutate<T>(fn: (data: BoardData, ctx: BoardContext) => T): Promise<T> {
    const run = this.writeQueue.then(async () => {
      const [data, ctx] = await Promise.all([this.data(), this.context()]);
      const result = fn(data, ctx);
      await this.storage.save(data);
      return result;
    });
    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  private view(stored: StoredItem, all: StoredItem[], ctx: BoardContext): WorkItem {
    return {
      ...stored,
      stateCategory: categoryOf(ctx, stored.type, stored.state),
      sprintName: sprintNameFor(ctx, stored.iterationPath),
      parentTitle: stored.parentId ? (all.find((i) => i.id === stored.parentId)?.title ?? null) : null,
      url: null,
    };
  }

  /** Every item, for the board page. */
  async all(): Promise<WorkItem[]> {
    const [{ items }, ctx] = await Promise.all([this.data(), this.context()]);
    return items.map((i) => this.view(i, items, ctx));
  }

  async query(q: WorkItemQuery): Promise<WorkItem[]> {
    const [{ items }, ctx] = await Promise.all([this.data(), this.context()]);
    const text = q.text?.trim().toLowerCase();
    const assignee = q.assignee ?? { kind: "anyone" };
    return items
      .filter((i) => {
        switch (assignee.kind) {
          case "me":
            return i.assignedTo?.uniqueName === ctx.me.uniqueName;
          case "person":
            return i.assignedTo?.uniqueName.toLowerCase() === assignee.person.uniqueName.toLowerCase();
          case "unassigned":
            return !i.assignedTo;
          default:
            return true;
        }
      })
      .filter((i) =>
        q.iteration === undefined
          ? true
          : q.iteration === "backlog"
            ? i.iterationPath === ctx.backlogIteration
            : i.iterationPath === q.iteration || i.iterationPath.startsWith(`${q.iteration}\\`),
      )
      .filter((i) => !q.types?.length || q.types.includes(i.type))
      .filter((i) => !q.states?.length || q.states.includes(i.state))
      .filter((i) => q.parentId === undefined || i.parentId === q.parentId)
      .filter((i) => !text || String(i.id) === text || text.split(/\s+/).every((w) => i.title.toLowerCase().includes(w)))
      .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || b.changedAt.localeCompare(a.changedAt) || a.id - b.id)
      .slice(0, q.top ?? 50)
      .map((i) => this.view(i, items, ctx));
  }

  async get(id: number): Promise<WorkItem | null> {
    const [{ items }, ctx] = await Promise.all([this.data(), this.context()]);
    const item = items.find((i) => i.id === id);
    return item ? this.view(item, items, ctx) : null;
  }

  async getDetail(id: number): Promise<WorkItemDetail | null> {
    const [{ items, comments }, ctx] = await Promise.all([this.data(), this.context()]);
    const item = items.find((i) => i.id === id);
    if (!item) return null;
    const ancestors = [];
    for (let p = item.parentId; p !== null; ) {
      const parent = items.find((i) => i.id === p);
      if (!parent || ancestors.length > 5) break;
      ancestors.push({ id: parent.id, title: parent.title, type: parent.type, state: parent.state });
      p = parent.parentId;
    }
    const children = items.filter((i) => i.parentId === id).map((i) => this.view(i, items, ctx));
    return { ...this.view(item, items, ctx), ancestors, children, comments: [...(comments?.[id] ?? [])].reverse() };
  }

  async create(input: CreateWorkItemInput): Promise<WorkItem> {
    const title = validateTitle(input.title);
    if (input.priority != null) validatePriority(input.priority);
    return this.mutate((data, ctx) => {
      const info = ctx.types[input.type];
      if (!info) throw new WorkItemError(`Unknown work item type "${input.type}".`, "invalid");
      if (input.parentId && !data.items.some((i) => i.id === input.parentId)) {
        throw new WorkItemError(`Parent #${input.parentId} does not exist.`, "not_found");
      }
      const now = this.now().toISOString();
      const item: StoredItem = {
        id: data.nextId++,
        title,
        type: input.type,
        state: info.states[0].name,
        priority: input.priority ?? 2,
        assignedTo: input.assignedTo,
        description: input.description?.trim() ?? "",
        areaPath: input.areaPath,
        iterationPath: input.iterationPath,
        parentId: input.parentId ?? null,
        tags: input.tags ?? [],
        createdAt: now,
        changedAt: now,
        rev: 1,
      };
      data.items.push(item);
      return this.view(item, data.items, ctx);
    });
  }

  async update(id: number, patch: WorkItemPatch, expectedRev?: number): Promise<WorkItem> {
    return this.mutate((data, ctx) => {
      const item = data.items.find((i) => i.id === id);
      if (!item) throw new WorkItemError(`Work item #${id} does not exist.`, "not_found");
      if (expectedRev !== undefined && item.rev !== expectedRev) {
        throw new WorkItemError(`#${id} was changed by someone else since it was read.`, "conflict");
      }
      if (patch.state !== undefined && !ctx.types[item.type]?.states.some((s) => s.name === patch.state)) {
        throw new WorkItemError(`"${patch.state}" is not a state of ${item.type}.`, "invalid_transition");
      }
      if (patch.parentId && !data.items.some((i) => i.id === patch.parentId)) {
        throw new WorkItemError(`Parent #${patch.parentId} does not exist.`, "not_found");
      }
      if (patch.title !== undefined) item.title = validateTitle(patch.title);
      if (patch.state !== undefined) item.state = patch.state;
      if (patch.priority !== undefined) {
        validatePriority(patch.priority);
        item.priority = patch.priority;
      }
      if (patch.assignedTo !== undefined) item.assignedTo = patch.assignedTo;
      if (patch.iterationPath !== undefined) item.iterationPath = patch.iterationPath;
      if (patch.parentId !== undefined) item.parentId = patch.parentId;
      if (patch.addTags?.length) item.tags = [...new Set([...item.tags, ...patch.addTags])];
      if (patch.description !== undefined) item.description = patch.description.trim();
      if (patch.comment) {
        data.comments ??= {};
        data.nextCommentId ??= 1;
        (data.comments[id] ??= []).push({
          id: data.nextCommentId++,
          text: patch.comment.trim(),
          author: ctx.me.displayName,
          createdAt: this.now().toISOString(),
        });
      }
      item.rev += 1;
      item.changedAt = this.now().toISOString();
      return this.view(item, data.items, ctx);
    });
  }

  async deleteComment(itemId: number, commentId: number): Promise<void> {
    await this.mutate((data) => {
      const list = data.comments?.[itemId] ?? [];
      const idx = list.findIndex((c) => c.id === commentId);
      if (idx < 0) throw new WorkItemError(`Comment ${commentId} isn't on #${itemId}.`, "not_found");
      list.splice(idx, 1);
    });
  }
}

const globalForBoard = globalThis as unknown as { __emulatedBoard?: EmulatedBoard };

export function getEmulatedBoard(): EmulatedBoard {
  globalForBoard.__emulatedBoard ??= new EmulatedBoard(
    fileStorage(path.join(process.cwd(), ".data", "board.json")),
    process.env.BOARD_CURRENT_USER || "Demo User",
  );
  return globalForBoard.__emulatedBoard;
}
