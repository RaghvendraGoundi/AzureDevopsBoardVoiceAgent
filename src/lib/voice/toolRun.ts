import { TOOL_LABELS, type ToolResponse } from "@/types/voice";

/**
 * Board tool calls from the browser, bounded and visible: every call has a
 * deadline, can be cancelled ("Stop waiting"), and the clients can ask how
 * long the current one has been running, so the assistant can tell the user
 * what's happening instead of going quiet.
 */

/** The browser gives up on a tool call after this long (the server's own limit is shorter). */
export const TOOL_CLIENT_TIMEOUT_MS = 25_000;
/** A call running this long gets a spoken "still working on it" if the user talks. */
export const STATUS_AFTER_MS = 2_000;
/** …and one proactively, if it's still running this long. */
export const PROACTIVE_STATUS_MS = 7_000;

const WRITES = new Set(["confirm_action"]);

export function timeoutResult(tool: string): ToolResponse {
  const message = WRITES.has(tool)
    ? "The board took too long to answer, so I can't tell whether the change was saved. Look the item up before trying again."
    : "The board took too long to answer, so I stopped waiting. Nothing was changed.";
  return { output: { ok: false, error: message, code: "timeout" }, uiEvents: [{ type: "error", message }] };
}

export function cancelledResult(tool: string): ToolResponse {
  const message = WRITES.has(tool)
    ? "Stopped waiting for the board. The change may still go through; check the item before trying again."
    : "Stopped waiting for the board, as asked. Nothing was changed.";
  return { output: { ok: false, error: message, code: "cancelled" }, uiEvents: [] };
}

interface Running {
  name: string;
  startedAt: number;
  cancel: () => void;
}

export class RunningTools {
  private running = new Map<string, Running>();

  constructor(
    private readonly timeoutMs = TOOL_CLIENT_TIMEOUT_MS,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Runs one tool call; resolves with a timeout or cancellation result instead of hanging. */
  run(callId: string, name: string, exec: () => Promise<ToolResponse>): Promise<ToolResponse> {
    return new Promise<ToolResponse>((resolve) => {
      let settled = false;
      const done = (r: ToolResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.running.delete(callId);
        resolve(r);
      };
      const timer = setTimeout(() => done(timeoutResult(name)), this.timeoutMs);
      this.running.set(callId, { name, startedAt: this.now(), cancel: () => done(cancelledResult(name)) });
      exec().then(done, () =>
        done({
          output: { ok: false, error: "The board service couldn't be reached." },
          uiEvents: [{ type: "error", message: "The board service couldn't be reached." }],
        }),
      );
    });
  }

  /** "Stop waiting": every running call resolves now with a cancellation result. */
  cancelAll() {
    for (const r of [...this.running.values()]) r.cancel();
  }

  get busy() {
    return this.running.size > 0;
  }

  /** The longest-running call, if any. */
  longest(): { name: string; ms: number } | null {
    let best: { name: string; ms: number } | null = null;
    for (const r of this.running.values()) {
      const ms = this.now() - r.startedAt;
      if (!best || ms > best.ms) best = { name: r.name, ms };
    }
    return best;
  }
}

/** What the assistant is told when it should give the user a quick status update. */
export function statusNote(running: { name: string; ms: number }, userSpoke: boolean): string {
  const what = (TOOL_LABELS[running.name] ?? "Working on the board…").replace(/…$/, "").toLowerCase();
  const seconds = Math.max(1, Math.round(running.ms / 1000));
  return [
    `[status] A board request is still running (${what}, ${seconds} s so far).`,
    userSpoke
      ? "The user just said something: answer it briefly if you can without the board, and tell them you're still working on the earlier request and will share the result when it's ready."
      : "Tell the user in one short sentence that you're still working on it.",
    "Don't call any tools in this reply.",
  ].join(" ");
}
