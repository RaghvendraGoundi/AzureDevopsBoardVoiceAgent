import type { WorkItem, WorkItemComment, WorkItemDetail, WorkItemPatch } from "@/lib/devops/types";

export type AgentStatus = "idle" | "connecting" | "listening" | "processing" | "speaking" | "error";
export type ConnectionState = "disconnected" | "connecting" | "connected" | "failed";

export interface PendingAction {
  actionId: string;
  kind: "create" | "update" | "delete_comment";
  message: string;
  /** For updates: the item before the change. */
  before?: WorkItem;
  /** The item as it will look after the change (for creates, a draft without a real id). */
  after: WorkItem;
  changes?: WorkItemPatch;
  /** For delete_comment: the comment that would go. */
  comment?: WorkItemComment;
  expiresAt: string;
}

/** Events emitted by the backend tools; the workspace renders from these. */
export type WorkspaceEvent =
  | { type: "work_items_loaded"; title: string; items: WorkItem[] }
  | { type: "work_item_focused"; item: WorkItem }
  /** One item opened in full: parents, children, comments. `quiet` refreshes it without bringing it to the front. */
  | { type: "work_item_detail"; detail: WorkItemDetail; quiet?: boolean }
  | { type: "work_item_preview"; action: PendingAction }
  | { type: "confirmation_resolved"; actionId: string; outcome: "confirmed" | "cancelled" | "expired" }
  | { type: "work_item_updated"; item: WorkItem; before: WorkItem }
  | { type: "work_item_created"; item: WorkItem }
  | { type: "error"; message: string };

/** Provider-agnostic events produced by the realtime client. */
export type VoiceEvent =
  | { type: "connection"; state: ConnectionState; error?: string }
  | { type: "agent_status"; status: AgentStatus }
  | { type: "user_transcript"; id: string; text: string; final: boolean }
  | { type: "assistant_transcript"; id: string; text: string; final: boolean }
  /** The user talked over the assistant; any reply still streaming was cut off. */
  | { type: "assistant_interrupted" }
  /** The call is about to end: the assistant is saying goodbye, or the user pressed End. */
  | { type: "session_closing"; by: "assistant" | "user" }
  | { type: "tool_started"; callId: string; tool: string; args: unknown }
  | { type: "tool_finished"; callId: string; tool: string; ok: boolean }
  | WorkspaceEvent;

export interface ToolResponse {
  /** Result handed back to the model as the function_call_output. */
  output: Record<string, unknown>;
  /** Events for the live workspace. */
  uiEvents: WorkspaceEvent[];
}

export const TOOL_LABELS: Record<string, string> = {
  list_work_items: "Searching Azure DevOps…",
  get_sprint: "Checking the sprint…",
  get_work_item: "Looking up work item…",
  propose_create_work_item: "Preparing new work item…",
  propose_update_work_item: "Preparing update…",
  propose_delete_comment: "Preparing to delete a comment…",
  confirm_action: "Updating work item…",
  cancel_action: "Cancelling…",
  wait_for_user: "Listening…",
  end_session: "Ending session…",
};
