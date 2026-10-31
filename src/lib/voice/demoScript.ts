import type { WorkspaceAction } from "@/hooks/voice/workspaceReducer";
import type { ToolResponse } from "@/types/voice";
import { executeToolRemote } from "./toolExecutor";

/**
 * Simulated conversation for trying the workspace without a voice provider.
 * Speech is scripted, but every tool call hits the real backend and board,
 * so the board really changes (reset it with `npm run board:reset`).
 */

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

export async function runDemo(dispatch: (a: WorkspaceAction) => void, signal: AbortSignal) {
  let seq = 0;

  async function user(text: string) {
    const id = `demo-u${++seq}`;
    dispatch({ type: "agent_status", status: "listening" });
    await sleep(500, signal);
    for (const word of text.split(" ")) {
      dispatch({ type: "user_transcript", id, text: `${word} `, final: false });
      await sleep(90, signal);
    }
    dispatch({ type: "user_transcript", id, text, final: true });
    dispatch({ type: "agent_status", status: "processing" });
    await sleep(400, signal);
  }

  async function say(text: string) {
    const id = `demo-a${++seq}`;
    dispatch({ type: "agent_status", status: "speaking" });
    for (const word of text.split(" ")) {
      dispatch({ type: "assistant_transcript", id, text: `${word} `, final: false });
      await sleep(70, signal);
    }
    dispatch({ type: "assistant_transcript", id, text, final: true });
    await sleep(600, signal);
  }

  async function tool(name: string, args: unknown): Promise<ToolResponse> {
    const callId = `demo-call${++seq}`;
    dispatch({ type: "tool_started", callId, tool: name, args });
    await sleep(500, signal);
    const result = await executeToolRemote(name, args);
    result.uiEvents.forEach(dispatch);
    dispatch({ type: "tool_finished", callId, tool: name, ok: result.output.ok !== false });
    return result;
  }

  try {
    dispatch({ type: "connection", state: "connected" });

    await user("Hey, what am I working on this sprint?");
    const list = await tool("list_work_items", {});
    const items = (list.output.items as { id: number; title: string; type: string }[] | undefined) ?? [];
    if (items.length < 2) {
      await say(`You have ${items.length} open item${items.length === 1 ? "" : "s"} this sprint. Reset the board to run the full demo.`);
      return;
    }
    await say(`You have ${items.length} open items this sprint. The top ones are ${items[0].title} and ${items[1].title}.`);

    await user("Move the second one to done.");
    const proposal = await tool("propose_update_work_item", { id: items[1].id, state: "done" });
    if (proposal.output.ok === false) {
      await say(String(proposal.output.error));
      return;
    }
    await say(`${String(proposal.output.summary).replace(/\?$/, "")}. Shall I go ahead?`);

    await user("Yes, do it.");
    const done = await tool("confirm_action", { action_id: proposal.output.action_id });
    await say(done.output.ok === false ? String(done.output.error) : `Done. ${items[1].title} is finished.`);

    await user("Create a task to add logging to the sign-in flow.");
    const ask = await tool("propose_create_work_item", { title: "Add logging to the sign-in flow", type: "task" });
    const candidates = (ask.output.candidates as { id: number; title: string }[] | undefined) ?? [];
    const parent = candidates[0];
    if (!parent) {
      await say("I couldn't find a story for it to go under.");
      return;
    }
    await say(`Which story does it go under? ${parent.title}?`);

    await user(`Yes, ${parent.title}.`);
    const create = await tool("propose_create_work_item", { title: "Add logging to the sign-in flow", type: "task", parent_id: parent.id });
    await say(`${String(create.output.summary).replace(/\?$/, "")}. Create it?`);

    await user("No, cancel that.");
    await tool("cancel_action", { action_id: create.output.action_id });
    await say("Okay, I've cancelled it. Nothing was created.");
  } catch (err) {
    if (!(err instanceof DOMException && err.name === "AbortError")) {
      dispatch({ type: "error", message: "The demo couldn't reach the board service." });
    }
  } finally {
    dispatch({ type: "agent_status", status: "idle" });
    dispatch({ type: "connection", state: "disconnected" });
  }
}
