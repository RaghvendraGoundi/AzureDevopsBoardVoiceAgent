"use client";

import { useState } from "react";
import type { WorkItem } from "@/lib/devops/types";
import type { PendingAction } from "@/types/voice";
import { CheckIcon, CloseIcon, TypeIcon } from "./icons";
import { StateBadge } from "./WorkItemCard";

type Field = { key: string; label: string; value: (i: WorkItem) => string };

const FIELDS: Field[] = [
  { key: "parent", label: "Parent", value: (i) => (i.parentId ? `#${i.parentId} ${i.parentTitle ?? ""}`.trim() : "None") },
  { key: "sprint", label: "Sprint", value: (i) => i.sprintName ?? "Backlog" },
  { key: "assignedTo", label: "Assigned", value: (i) => i.assignedTo?.displayName ?? "Unassigned" },
  { key: "priority", label: "Priority", value: (i) => (i.priority === null ? "None" : `P${i.priority}`) },
  { key: "tags", label: "Tags", value: (i) => i.tags.join(", ") || "None" },
];

interface Props {
  action: PendingAction;
  onResolve: (actionId: string, decision: "confirm" | "cancel") => Promise<void>;
}

/**
 * A proposed change, shown until the user says yes or no (or taps a button).
 * Updates show the move as old → new with a flowing arrow; new items show a
 * "blueprint" of the item that will be created.
 */
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

  const buttons = (
    <div className="mt-4 flex gap-3">
      <button onClick={() => resolve("cancel")} disabled={busy !== null} className="pill lg flex-1">
        <CloseIcon size={20} />
        Cancel
      </button>
      <button onClick={() => resolve("confirm")} disabled={busy !== null} className="pill pri lg flex-[1.4]">
        <CheckIcon size={20} />
        {busy === "confirm" ? (isUpdate ? "Applying…" : "Creating…") : isUpdate ? "Confirm" : "Create"}
      </button>
    </div>
  );

  if (!isUpdate) {
    const chips = FIELDS.filter((f) => f.key !== "parent" && (f.key !== "tags" || after.tags.length > 0));
    return (
      <section className="card att animate-rise p-5!" aria-label="New item waiting for your confirmation">
        <div className="flex items-center justify-between">
          <span className="att-label">
            <i aria-hidden />
            New {after.type.toLowerCase()} · waiting for your yes
          </span>
          <span className="sub2">Voice or tap</span>
        </div>

        <div className="blueprint mt-4">
          <div className="meta">
            <span className="tg">
              <TypeIcon type={after.type} />
              {after.type}
            </span>
            <span className="text-[#b9fe6f]">NEW</span>
          </div>
          <h3 className="ttl mt-2! mb-1! text-[20px]!">{after.title}</h3>
          {after.parentId && (
            <p className="sub2 truncate">
              ↳ under #{after.parentId} {after.parentTitle}
            </p>
          )}
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[{ key: "type", label: "Type", value: (i: WorkItem) => i.type }, ...chips].map((f) => (
              <div key={f.key} className="chip">
                <dt>
                  <span>{f.label}</span>
                </dt>
                <dd>
                  <b title={f.value(after)}>{f.value(after)}</b>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="sub2 mt-3">Nothing is created until you confirm.</p>
        {buttons}
      </section>
    );
  }

  const stateChanged = before.state !== after.state;
  const renamed = before.title !== after.title;
  const rows = FIELDS.filter((f) => f.value(before) !== f.value(after));

  return (
    <section className="card att animate-rise p-5!" aria-label="Change waiting for your confirmation">
      <div className="flex items-center justify-between">
        <span className="att-label">
          <i aria-hidden />
          Waiting for your yes
        </span>
        <span className="sub2">Voice or tap</span>
      </div>

      <div className="meta mt-4">
        <span className="tg">
          <TypeIcon type={after.type} />
          {after.type}
        </span>
        <span>#{after.id}</span>
      </div>
      <h3 className="ttl mt-2! mb-4! text-[20px]!">{before.title}</h3>

      {stateChanged && (
        <div className="mb-3.5 flex items-center gap-3">
          <StateBadge state={before.state} category={before.stateCategory} big />
          <span className="flowline" aria-label="changes to" />
          <StateBadge state={after.state} category={after.stateCategory} big />
        </div>
      )}

      {(renamed || rows.length > 0) && (
        <dl className="mb-2 flex flex-col gap-2 text-sm">
          {renamed && (
            <div className="flex items-center gap-2">
              <dt className="sub2 w-20 shrink-0">Title</dt>
              <span className="flowline sm" aria-hidden />
              <dd className="min-w-0 truncate font-semibold">{after.title}</dd>
            </div>
          )}
          {rows.map((f) => (
            <div key={f.key} className="flex items-center gap-2">
              <dt className="sub2 w-20 shrink-0">{f.label}</dt>
              <dd className="flex min-w-0 items-center gap-2">
                <span className="truncate text-muted">{f.value(before)}</span>
                <span className="flowline sm" aria-label="changes to" />
                <span className="truncate font-semibold">{f.value(after)}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {action.changes?.comment && <p className="sub2 mb-1.5">Note to add: “{action.changes.comment}”</p>}
      <p className="sub2">Nothing changes on the board until you confirm.</p>
      {buttons}
    </section>
  );
}
