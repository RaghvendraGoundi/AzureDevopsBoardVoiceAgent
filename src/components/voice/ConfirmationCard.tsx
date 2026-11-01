"use client";

import { useState } from "react";
import type { WorkItem } from "@/lib/devops/types";
import type { PendingAction } from "@/types/voice";
import { CheckIcon, CloseIcon, TypeIcon } from "./icons";
import { StateBadge } from "./WorkItemCard";

type Field = { key: string; label: string; value: (i: WorkItem) => string };

const FIELDS: Field[] = [
  { key: "type", label: "Type", value: (i) => i.type },
  { key: "parent", label: "Parent", value: (i) => (i.parentId ? `#${i.parentId} ${i.parentTitle ?? ""}`.trim() : "None") },
  { key: "sprint", label: "Sprint", value: (i) => i.sprintName ?? "Backlog" },
  { key: "assignedTo", label: "Assigned to", value: (i) => i.assignedTo?.displayName ?? "Unassigned" },
  { key: "priority", label: "Priority", value: (i) => (i.priority === null ? "None" : String(i.priority)) },
  { key: "tags", label: "Tags", value: (i) => i.tags.join(", ") || "None" },
];

interface Props {
  action: PendingAction;
  onResolve: (actionId: string, decision: "confirm" | "cancel") => Promise<void>;
}

/** A proposed change, shown until the user says yes or no (or taps a button). Layout from variant B. */
export function ConfirmationCard({ action, onResolve }: Props) {
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const { before, after } = action;
  const isUpdate = action.kind === "update" && !!before;

  async function resolve(decision: "confirm" | "cancel") {
    setBusy(decision);
    try {
      await onResolve(action.actionId, decision);
    } finally {
      setBusy(null);
    }
  }

  const stateChanged = isUpdate && before.state !== after.state;
  const renamed = isUpdate && before.title !== after.title;
  const rows = isUpdate
    ? FIELDS.filter((f) => f.value(before) !== f.value(after))
    : FIELDS.filter((f) => f.key !== "tags" || after.tags.length > 0);

  return (
    <section className="card att animate-rise p-5!" aria-label="Change waiting for your confirmation">
      <div className="flex items-center justify-between">
        <span className="att-label">
          <i aria-hidden />
          {isUpdate ? "Waiting for your yes" : "New item · waiting for your yes"}
        </span>
        <span className="sub2">Voice or tap</span>
      </div>

      <div className="meta mt-4">
        <span className="tg">
          <TypeIcon type={after.type} />
          {after.type}
        </span>
        {isUpdate && <span>#{after.id}</span>}
      </div>
      <h3 className="ttl mt-2! mb-4! text-[20px]!">{renamed ? before.title : after.title}</h3>

      {stateChanged && (
        <div className="mb-3.5 flex items-center gap-3">
          <span className="state big" data-cat={before.stateCategory}>
            <i aria-hidden />
            {before.state}
          </span>
          <span className="h-0 flex-1 border-t-2 border-dashed border-[rgba(255,86,0,0.55)]" aria-label="changes to" />
          <StateBadge state={after.state} category={after.stateCategory} big />
        </div>
      )}

      {(renamed || rows.length > 0) && (
        <dl className="mb-3 flex flex-col gap-1.5 text-sm">
          {renamed && (
            <div className="flex gap-2">
              <dt className="sub2 w-24 shrink-0">Title</dt>
              <dd>→ {after.title}</dd>
            </div>
          )}
          {rows.map((f) => (
            <div key={f.key} className="flex gap-2">
              <dt className="sub2 w-24 shrink-0">{f.label}</dt>
              <dd>
                {isUpdate && <span className="text-muted">{f.value(before)} → </span>}
                {f.value(after)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {action.kind === "update" && action.changes?.comment && (
        <p className="sub2 mb-1.5">Note to add: “{action.changes.comment}”</p>
      )}
      <p className="sub2 mb-4">Nothing changes on the board until you confirm.</p>

      <div className="flex gap-3">
        <button onClick={() => resolve("cancel")} disabled={busy !== null} className="pill lg flex-1">
          <CloseIcon size={20} />
          Cancel
        </button>
        <button onClick={() => resolve("confirm")} disabled={busy !== null} className="pill pri lg flex-[1.4]">
          <CheckIcon size={20} />
          {busy === "confirm" ? "Saving…" : "Confirm"}
        </button>
      </div>
    </section>
  );
}
