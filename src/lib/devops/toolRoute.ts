import { SpanStatusCode, trace } from "@opentelemetry/api";
import { aliasBookFor, redactForModel, unaliasArgs } from "@/lib/privacy/redact";
import { getTelemetry } from "@/lib/telemetry";
import type { ToolResponse } from "@/types/voice";
import { getPrincipal } from "@/lib/auth/principal";
import { getBoardFor } from "./boardFactory";
import { policyFor } from "./policy";
import { getPendingActions } from "./pendingActions";
import { WorkItemError } from "./repository";
import { executeTool } from "./tools";
import { timeoutResult } from "@/lib/voice/toolRun";

/** No tool call holds a voice call up for longer than this. */
export const TOOL_SERVER_DEADLINE_MS = 20_000;

/** Ends a slow tool call with an error the model can explain (the work itself may still finish). */
function withDeadline(name: string, work: Promise<ToolResponse>, ms = TOOL_SERVER_DEADLINE_MS): Promise<ToolResponse> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<ToolResponse>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[tool] ${name} passed its ${ms / 1000}s deadline`);
      resolve(timeoutResult(name));
    }, ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Runs a tool as the user behind `headers`, turning sign-in/config problems into a tool error the model can explain. */
export async function runToolFor(headers: Headers, name: string, args: unknown): Promise<ToolResponse> {
  let session;
  let principal;
  try {
    [session, principal] = await Promise.all([getBoardFor(headers), getPrincipal(headers)]);
    if (!principal) throw new WorkItemError("You need to sign in again.", "unauthorized");
  } catch (err) {
    const message = err instanceof WorkItemError ? err.message : "The board isn't available right now.";
    return { output: { ok: false, error: message }, uiEvents: [{ type: "error", message }] };
  }
  // The model only ever sees email aliases; turn the ones it sends back into real addresses.
  // For trying the "still working" experience locally: never active in production.
  const delay = process.env.NODE_ENV !== "production" ? Number(process.env.DEBUG_TOOL_DELAY_MS) || 0 : 0;
  if (delay && name !== "confirm_action") await new Promise((r) => setTimeout(r, delay));
  const book = aliasBookFor(principal.userKey);
  const realArgs = unaliasArgs(args, book);
  const started = performance.now();
  const result = await trace.getTracer("devops-voice").startActiveSpan(`tool ${name}`, async (span) => {
    try {
      const r = await withDeadline(
        name,
        executeTool(name, realArgs, {
          board: session.board,
          actions: getPendingActions(),
          // Confirmations belong to the signed-in person, whichever board they're on.
          userKey: principal.userKey,
          policy: policyFor(principal.role),
        }),
      );
      span.setAttribute("tool.ok", r.output.ok !== false);
      if (r.output.ok === false) span.setStatus({ code: SpanStatusCode.ERROR, message: String(r.output.error ?? "") });
      return r;
    } finally {
      span.end();
    }
  });
  getTelemetry().toolCall({
    userKey: principal.userKey,
    sessionId: headers.get("x-voice-session"),
    tool: name,
    args,
    ok: result.output.ok !== false,
    error: result.output.ok === false ? String(result.output.error ?? "") : null,
    durationMs: performance.now() - started,
  });
  const { value: output, aliases } = redactForModel(result.output, book);
  return { ...result, output, ...(Object.keys(aliases).length && { aliases }) };
}
