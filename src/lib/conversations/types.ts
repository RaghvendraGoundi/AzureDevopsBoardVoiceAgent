import type { WorkItem } from "@/lib/devops/types";

/** Shared by the server store, the API and the browser. */

export interface ConversationTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
}

/** A board change made during the conversation, for the activity list. */
export interface ConversationChange {
  id: string;
  kind: "created" | "updated" | "cancelled";
  item: WorkItem;
  before?: WorkItem;
  at: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: ConversationTurn[];
  changes: ConversationChange[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  turnCount: number;
  /** The last thing said, for the list. */
  preview: string;
}

export const DEFAULT_TITLE = "New conversation";

export function summarize(c: Conversation): ConversationSummary {
  const last = c.turns.at(-1);
  return { id: c.id, title: c.title, updatedAt: c.updatedAt, turnCount: c.turns.length, preview: last?.text.slice(0, 80) ?? "" };
}

/** A short title from the first thing the user said: "What am I working on this sprint?" → "What am I working on this sprint". */
export function titleFrom(text: string): string {
  const clean = text.replace(/[?.!,]+$/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return DEFAULT_TITLE;
  const words = clean.split(" ");
  const short = words.slice(0, 8).join(" ");
  return (words.length > 8 ? `${short}…` : short).replace(/^./, (c) => c.toUpperCase());
}
