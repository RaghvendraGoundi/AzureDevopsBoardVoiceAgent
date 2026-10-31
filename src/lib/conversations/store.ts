import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_TITLE,
  summarize,
  titleFrom,
  type Conversation,
  type ConversationChange,
  type ConversationSummary,
  type ConversationTurn,
} from "./types";

/**
 * Conversations, one JSON file per user under .data/conversations. The user
 * key is the same one that scopes the board (see boardFactory), so each
 * person only ever sees their own conversations.
 */

const MAX_CONVERSATIONS = 200;
const MAX_TURNS = 500;
const MAX_CHANGES = 200;

export interface ConversationFiles {
  load(userKey: string): Promise<Conversation[]>;
  save(userKey: string, conversations: Conversation[]): Promise<void>;
}

export function fileConversations(dir: string): ConversationFiles {
  const file = (userKey: string) => path.join(dir, `${userKey.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  return {
    async load(userKey) {
      try {
        return JSON.parse(await readFile(file(userKey), "utf8")) as Conversation[];
      } catch {
        return [];
      }
    },
    async save(userKey, conversations) {
      await mkdir(dir, { recursive: true });
      // Write then rename, so a crash mid-write can't leave a half-written file.
      const tmp = `${file(userKey)}.${randomUUID().slice(0, 8)}.tmp`;
      await writeFile(tmp, JSON.stringify(conversations));
      await rename(tmp, file(userKey));
    },
  };
}

export function memoryConversations(): ConversationFiles {
  const data = new Map<string, Conversation[]>();
  return {
    async load(userKey) {
      return structuredClone(data.get(userKey) ?? []);
    },
    async save(userKey, conversations) {
      data.set(userKey, structuredClone(conversations));
    },
  };
}

export class ConversationStore {
  private queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly files: ConversationFiles,
    private readonly now: () => number = Date.now,
  ) {}

  /** Serialises read-modify-write per user so concurrent saves can't drop turns. */
  private mutate<T>(userKey: string, fn: (all: Conversation[]) => T): Promise<T> {
    const run = (this.queues.get(userKey) ?? Promise.resolve()).then(async () => {
      const all = await this.files.load(userKey);
      const result = fn(all);
      await this.files.save(userKey, all);
      return result;
    });
    this.queues.set(userKey, run.catch(() => undefined));
    return run;
  }

  /** Conversations with at least one message, newest first (a call that never got going leaves an empty one). */
  async list(userKey: string): Promise<ConversationSummary[]> {
    const all = await this.files.load(userKey);
    return all.filter((c) => c.turns.length > 0).sort((a, b) => b.updatedAt - a.updatedAt).map(summarize);
  }

  async get(userKey: string, id: string): Promise<Conversation | null> {
    return (await this.files.load(userKey)).find((c) => c.id === id) ?? null;
  }

  create(userKey: string, title = DEFAULT_TITLE): Promise<Conversation> {
    return this.mutate(userKey, (all) => {
      const now = this.now();
      const conversation: Conversation = { id: `conv_${randomUUID()}`, title, createdAt: now, updatedAt: now, turns: [], changes: [] };
      all.push(conversation);
      // Drop the oldest beyond the cap.
      all.sort((a, b) => b.updatedAt - a.updatedAt).splice(MAX_CONVERSATIONS);
      return conversation;
    });
  }

  /** Adds turns and changes (ignoring ones already saved) and titles the conversation from its first user turn. */
  append(
    userKey: string,
    id: string,
    update: { turns?: ConversationTurn[]; changes?: ConversationChange[]; title?: string },
  ): Promise<ConversationSummary | null> {
    return this.mutate(userKey, (all) => {
      const c = all.find((x) => x.id === id);
      if (!c) return null;
      const turnIds = new Set(c.turns.map((t) => t.id));
      for (const t of update.turns ?? []) {
        if (turnIds.has(t.id) || !t.text.trim()) continue;
        c.turns.push({ id: t.id, role: t.role, text: t.text.slice(0, 4000), at: t.at });
      }
      c.turns.sort((a, b) => a.at - b.at).splice(0, Math.max(0, c.turns.length - MAX_TURNS));
      const changeIds = new Set(c.changes.map((x) => x.id));
      for (const ch of update.changes ?? []) if (!changeIds.has(ch.id)) c.changes.push(ch);
      c.changes.splice(0, Math.max(0, c.changes.length - MAX_CHANGES));
      if (update.title?.trim()) c.title = update.title.trim().slice(0, 120);
      else if (c.title === DEFAULT_TITLE) {
        const first = c.turns.find((t) => t.role === "user");
        if (first) c.title = titleFrom(first.text);
      }
      c.updatedAt = this.now();
      return summarize(c);
    });
  }

  remove(userKey: string, id: string): Promise<boolean> {
    return this.mutate(userKey, (all) => {
      const idx = all.findIndex((c) => c.id === id);
      if (idx >= 0) all.splice(idx, 1);
      return idx >= 0;
    });
  }
}

const globalForStore = globalThis as unknown as { __conversationStore?: ConversationStore };

export function getConversationStore(): ConversationStore {
  globalForStore.__conversationStore ??= new ConversationStore(fileConversations(path.join(process.cwd(), ".data", "conversations")));
  return globalForStore.__conversationStore;
}

/**
 * The earlier turns of a conversation, for the model's instructions when a
 * session resumes it, newest kept when it's long.
 */
export function historySection(conversation: Conversation | null, maxTurns = 30, maxChars = 6000): string | null {
  if (!conversation?.turns.length) return null;
  const lines: string[] = [];
  let chars = 0;
  for (const t of conversation.turns.slice(-maxTurns).reverse()) {
    const line = `${t.role === "user" ? "User" : "Assistant"}: ${t.text.replace(/\s+/g, " ")}`;
    if (chars + line.length > maxChars) break;
    lines.unshift(line);
    chars += line.length;
  }
  const changes = conversation.changes
    .filter((c) => c.kind !== "cancelled")
    .slice(-10)
    .map((c) => `- ${c.kind} ${c.item.type} #${c.item.id} “${c.item.title}”${c.before && c.before.state !== c.item.state ? ` (${c.before.state} → ${c.item.state})` : ""}`);
  return [
    "# Earlier in this conversation",
    "This session continues an earlier conversation with the same user. Use it for references like \"that task\" or \"the one we created\". The board may have changed since, so look items up again before changing them. Don't recap it unless asked.",
    ...lines,
    ...(changes.length ? ["Changes made earlier:", ...changes] : []),
  ].join("\n");
}
