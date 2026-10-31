import { getBoardFor } from "./boardFactory";
import { getPendingActions } from "./pendingActions";
import { currentSprint, daysLeft, summarizeBoard } from "./process";
import { executeTool } from "./tools";

/**
 * What a voice session is told about the board up front, so the model uses
 * the project's own type and state names and knows the sprint without a
 * lookup. Starting it also warms the caches: the project context and the
 * user's current sprint work are fetched while the call is still connecting,
 * so "what am I working on?" is answered from memory.
 */

export interface BoardInfo {
  provider: "emulated" | "azure";
  project: string;
  team: string;
  user: string;
  sprint: { name: string; finishDate: string | null; daysLeft: number | null } | null;
}

export interface Briefing {
  /** Markdown lines for the instructions, or null if the board didn't answer in time. */
  summary: string | null;
  /** Titles that help the transcriber hear item names. */
  keywords: string[];
  userName: string;
  info: BoardInfo | null;
}

const timeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

export async function boardBriefing(headers: Headers, waitMs = 1500): Promise<Briefing> {
  const fallbackName = process.env.BOARD_CURRENT_USER || "the user";
  let session;
  try {
    session = await getBoardFor(headers);
  } catch {
    return { summary: null, keywords: [], userName: fallbackName, info: null };
  }
  const { board, userKey } = session;
  const ctxP = board.context();
  // Same call as the model's first "what am I working on?", so its result lands in the cache.
  const workP = ctxP.then(() => executeTool("list_work_items", {}, { board, actions: getPendingActions(), userKey }));
  ctxP.catch(() => undefined);
  workP.catch(() => undefined);

  const [ctx, work] = await Promise.all([timeout(ctxP, waitMs).catch(() => null), timeout(workP, waitMs).catch(() => null)]);
  if (!ctx) return { summary: null, keywords: [], userName: fallbackName, info: null };

  const items = (work?.uiEvents.find((e) => e.type === "work_items_loaded") as { items?: Array<{ title: string }> } | undefined)?.items ?? [];
  const sprint = currentSprint(ctx);
  return {
    summary: summarizeBoard(ctx),
    keywords: items.slice(0, 25).map((i) => i.title),
    userName: ctx.me.displayName,
    info: {
      provider: ctx.provider,
      project: ctx.project,
      team: ctx.team,
      user: ctx.me.displayName,
      sprint: sprint ? { name: sprint.name, finishDate: sprint.finishDate, daysLeft: daysLeft(sprint) } : null,
    },
  };
}
