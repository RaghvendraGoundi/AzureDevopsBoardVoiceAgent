"use client";

import { useState } from "react";
import type { WorkItem } from "@/lib/devops/types";
import type { PendingAction } from "@/types/voice";
import { StateBadge } from "./WorkItemCard";

type Field = { key: string; label: string; value: (i: WorkItem) => string };

const FIELDS: Field[] = [
  { key: "title", label: "Title", value: (i) => i.title },
  { key: "type", label: "Type", value: (i) => i.type },
  { key: "state", label: "State", value: (i) => i.state },
  { key: "parent", label: "Parent", value: (i) => (i.parentId ? `#${i.parentId} ${i.parentTitle ?? ""}`.trim() : "—") },
  { key: "sprint", label: "Sprint", value: (i) => i.sprintName ?? "Backlog" },
  { key: "assignedTo", label: "Assigned to", value: (i) => i.assignedTo?.displayName ?? "Unassigned" },
  { key: "priority", label: "Priority", value: (i) => (i.priority === null ? "—" : String(i.priority)) },
  { key: "tags", label: "Tags", value: (i) => i.tags.join(", ") || "—" },
];

function show(item: WorkItem, field: Field) {
  if (field.key === "state") return <StateBadge state={item.state} category={item.stateCategory} />;
  return field.value(item);
}

interface Props {
  action: PendingAction;
  onResolve: (actionId: string, decision: "confirm" | "cancel") => Promise<void>;
}

export function ConfirmationCard({ action, onResolve }: Props) {
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const { before, after } = action;

  async function resolve(decision: "confirm" | "cancel") {
    setBusy(decision);
    try {
      await onResolve(action.actionId, decision);
    } finally {
      setBusy(null);
    }
  }

  const rows =
    action.kind === "update" && before
      ? FIELDS.filter((f) => f.value(before) !== f.value(after))
      : FIELDS.filter((f) => f.key !== "tags" || after.tags.length > 0);

  return (
    <section className="animate-rise rounded-xl border border-warn/50 bg-warn/5 p-4" aria-label="Pending change">
      <p className="text-xs font-semibold tracking-wide text-warn uppercase">
        {action.kind === "create" ? "New work item, awaiting confirmation" : `Update #${after.id}, awaiting confirmation`}
      </p>
      {action.kind === "update" && <h3 className="mt-1 font-semibold">{after.title}</h3>}
      {action.kind === "update" && action.changes?.comment && (
        <p className="mt-2 rounded-lg bg-panel-2 px-3 py-2 text-sm">
          <span className="text-muted">Comment: </span>
          {action.changes.comment}
        </p>
      )}

      <table className="mt-3 w-full text-sm">
        <tbody>
          {rows.map((f) => (
            <tr key={f.key} className="border-t border-line/60 first:border-0">
              <th className="py-1.5 pr-3 text-left font-normal text-muted">{f.label}</th>
              {action.kind === "update" && before ? (
                <td className="py-1.5">
                  <span className="text-muted line-through decoration-muted/60">{show(before, f)}</span>
                  <span className="mx-2 text-muted">→</span>
                  <span className="font-medium">{show(after, f)}</span>
                </td>
              ) : (
                <td className="py-1.5 font-medium">{show(after, f)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3 text-xs text-muted">Say “yes” or “no”, or use the buttons.</p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => resolve("confirm")}
          disabled={busy !== null}
          className="rounded-lg bg-ok px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-50"
        >
          {busy === "confirm" ? "Saving…" : "Confirm"}
        </button>
        <button
          onClick={() => resolve("cancel")}
          disabled={busy !== null}
          className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-panel-2 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
