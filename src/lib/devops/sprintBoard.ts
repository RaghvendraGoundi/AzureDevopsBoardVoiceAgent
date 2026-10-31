import { getBoardFor } from "./boardFactory";
import { currentSprint, daysLeft, statesInCategories } from "./process";
import { WorkItemError } from "./repository";
import { STATE_CATEGORIES, type StateCategory, type WorkItem } from "./types";

export const BOARD_COLUMNS: Array<{ category: StateCategory; label: string }> = [
  { category: "Proposed", label: "To do" },
  { category: "InProgress", label: "In progress" },
  { category: "Resolved", label: "Resolved" },
  { category: "Completed", label: "Done" },
];

export type SprintBoard =
  | {
      ok: true;
      provider: "emulated" | "azure";
      title: string;
      subtitle: string;
      columns: Array<{ category: StateCategory; label: string; items: WorkItem[] }>;
    }
  | { ok: false; error: string };

/** The team's current sprint (or the backlog if there is none), grouped into columns by state category. */
export async function loadSprintBoard(headers: Headers): Promise<SprintBoard> {
  try {
    const { board } = await getBoardFor(headers);
    const ctx = await board.context();
    const sprint = currentSprint(ctx);
    const items = await board.query({
      iteration: sprint?.path ?? "backlog",
      states: statesInCategories(ctx, STATE_CATEGORIES.filter((c) => c !== "Removed")),
      top: 200,
    });
    return {
      ok: true,
      provider: ctx.provider,
      title: `${ctx.project} · ${sprint?.name ?? "Backlog"}`,
      subtitle: sprint ? `${daysLeft(sprint)} days left · ${ctx.team}` : ctx.team,
      columns: BOARD_COLUMNS.map((c) => ({ ...c, items: items.filter((i) => i.stateCategory === c.category) })),
    };
  } catch (err) {
    return { ok: false, error: err instanceof WorkItemError ? err.message : "The board isn't available right now." };
  }
}
