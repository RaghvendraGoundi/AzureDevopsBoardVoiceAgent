import type { ToolResponse } from "@/types/voice";
import { getBoardFor } from "./boardFactory";
import { getPendingActions } from "./pendingActions";
import { WorkItemError } from "./repository";
import { executeTool } from "./tools";

/** Runs a tool as the user behind `headers`, turning sign-in/config problems into a tool error the model can explain. */
export async function runToolFor(headers: Headers, name: string, args: unknown): Promise<ToolResponse> {
  let session;
  try {
    session = await getBoardFor(headers);
  } catch (err) {
    const message = err instanceof WorkItemError ? err.message : "The board isn't available right now.";
    return { output: { ok: false, error: message }, uiEvents: [{ type: "error", message }] };
  }
  return executeTool(name, args, { board: session.board, actions: getPendingActions(), userKey: session.userKey });
}
