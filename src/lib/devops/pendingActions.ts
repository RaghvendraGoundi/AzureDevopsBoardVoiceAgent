import { randomUUID } from "node:crypto";
import type { CreateWorkItemInput, WorkItemPatch } from "./types";

export const ACTION_TTL_MS = 5 * 60 * 1000;

export type PendingOperation =
  | { kind: "create"; input: CreateWorkItemInput; parentTitle: string | null }
  | { kind: "update"; id: number; rev: number; changes: WorkItemPatch; parentTitle?: string | null }
  | { kind: "delete_comment"; id: number; commentId: number };

interface Entry {
  op: PendingOperation;
  /** The user who proposed it; nobody else can confirm it. */
  owner: string;
  expiresAt: number;
}

export type TakeResult =
  | { ok: true; op: PendingOperation }
  | { ok: false; reason: "unknown" | "expired" };

/**
 * Write operations the model has proposed but the user hasn't confirmed yet.
 * Each action id is single-use, expires, and belongs to the user who
 * proposed it, so the model can't replay or invent confirmations and one
 * user can't confirm another's.
 */
export class PendingActionStore {
  private entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  add(op: PendingOperation, owner: string): { actionId: string; expiresAt: number } {
    this.sweep();
    const actionId = `act_${randomUUID().slice(0, 8)}`;
    const expiresAt = this.now() + ACTION_TTL_MS;
    this.entries.set(actionId, { op, owner, expiresAt });
    return { actionId, expiresAt };
  }

  /** Removes and returns the operation. A second take of the same id fails. */
  take(actionId: string, owner: string): TakeResult {
    const entry = this.entries.get(actionId);
    // Someone else's action looks exactly like one that doesn't exist.
    if (!entry || entry.owner !== owner) return { ok: false, reason: "unknown" };
    this.entries.delete(actionId);
    if (entry.expiresAt <= this.now()) return { ok: false, reason: "expired" };
    return { ok: true, op: entry.op };
  }

  private sweep() {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id);
    }
  }
}

const globalForActions = globalThis as unknown as { __pendingActionsByUser?: PendingActionStore };

export function getPendingActions(): PendingActionStore {
  globalForActions.__pendingActionsByUser ??= new PendingActionStore();
  return globalForActions.__pendingActionsByUser;
}
