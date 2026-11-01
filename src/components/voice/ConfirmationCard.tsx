"use client";

import { useState } from "react";
import type { WorkItem } from "@/lib/devops/types";
import type { PendingAction } from "@/types/voice";
import { TypeIcon } from "./icons";
import { StateBadge } from "./WorkItemCard";

type Field = { key: string; label: string; value: (i: WorkItem) => string };

const FIELDS: Field[] = [
  { key: "title", label: "Title", value: (i) => i.title },
  { key: "type", label: "Type", value: (i) => i.type },
  { key: "state", label: "State", value: (i) => i.state },
  { key: "parent", label: "Parent", value: (i) => (i.parentId ? `#${i.parentId} ${i.parentTitle ?? ""}`.trim() : "None") },
  { key: "sprint", label: "Sprint", value: (i) => i.sprintName ?? "Backlog" },
  { key: "assignedTo", label: "Assigned to", value: (i) => i.assignedTo?.displayName ?? "Unassigned" },
  { key: "priority", label: "Priority", value: (i) => (i.priority === null ? "None" : String(i.priority)) },
  { key: "tags", label: "Tags", value: (i) => i.tags.join(", ") || "None" },
];

function show(item: WorkItem, field: Field) {
  if (field.key === "state") return <StateBadge state={item.state} category={item.stateCategory} />;
  return <span>{field.value(item)}</span>;
}

interface Props {
  action: PendingAction;
  onResolve: (actionId: string, decision: "confirm" | "cancel") => Promise<void>;
}

/** A proposed change, shown until the user says yes or no (or taps a button). */
export function ConfirmationCard({ action, onResolve }: Props) {
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const { before, after } = action;
  const isUpdate = action.kind === "update" && before;

  async function resolve(decision: "confirm" | "cancel") {
    setBusy(decision);
    try {
      await onResolve(action.actionId, decision);
    } finally {
      setBusy(null);
    }
  }

  const rows = isUpdate
    ? FIELDS.filter((f) => f.key !== "title" && f.value(before) !== f.value(after))
    : FIELDS.filter((f) => f.key !== "title" && (f.key !== "tags" || after.tags.length > 0));
  const renamed = isUpdate && before.title !== after.title;

  return (
    <section className="card att animate-rise" aria-label="Change waiting for your confirmation">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-bold text-accent">{isUpdate ? "Waiting for your yes" : "New item, waiting for your yes"}</span>
        <span className="sub2">Voice or tap</span>
      </div>

      <div className="meta mt-3">
        <span className="tg">
          <TypeIcon type={after.type} />
          {after.type}
        </span>
        {isUpdate && <span>#{after.id}</span>}
      </div>
      <h3 className="ttl">{renamed ? before.title : after.title}</h3>

      <dl className="mt-3 flex flex-col gap-2">
        {renamed && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <dt className="w-24 shrink-0 sub2">Title</dt>
            <dd>
              → <span className="font-semibold">{after.title}</span>
            </dd>
          </div>
        )}
        {rows.map((f) => (
          <div key={f.key} className="flex flex-wrap items-center gap-2 text-sm">
            <dt className="w-24 shrink-0 sub2">{f.label}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              {isUpdate && (
                <>
                  <span className="text-muted">{show(before, f)}</span>
                  <span className="text-muted" aria-label="changes to">
                    →
                  </span>
                </>
              )}
              <span className="font-semibold">{show(after, f)}</span>
            </dd>
          </div>
        ))}
      </dl>

      {action.kind === "update" && action.changes?.comment && (
        <p className="mt-3 text-sm">
          <span className="sub2">Note to add: </span>“{action.changes.comment}”
        </p>
      )}

      <p className="sub2 mt-4">Nothing changes on the board until you confirm.</p>
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={() => resolve("cancel")} disabled={busy !== null} className="pill">
          Cancel
        </button>
        <button onClick={() => resolve("confirm")} disabled={busy !== null} className="pill pri">
          {busy === "confirm" ? "Saving…" : "Confirm"}
        </button>
      </div>
    </section>
  );
}
