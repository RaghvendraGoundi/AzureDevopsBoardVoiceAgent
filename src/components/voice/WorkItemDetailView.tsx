"use client";

import { useState } from "react";
import type { WorkItemDetail } from "@/lib/devops/types";
import { relativeTime } from "./time";
import { ChevronLeftIcon, ChevronRightIcon, CommentIcon, EditIcon, ExternalIcon, FlagIcon, SendIcon, TrashIcon, TypeIcon } from "./icons";
import { StateBadge, typeTone } from "./WorkItemCard";

interface Props {
  detail: WorkItemDetail;
  /** Where "back" goes: the list, or nothing when the item was opened on its own. */
  backLabel: string | null;
  onBack: () => void;
  onOpen: (id: number) => void;
  onProposeComment: (id: number, text: string) => Promise<boolean>;
  onProposeDescription: (id: number, text: string) => Promise<boolean>;
  onProposeDeleteComment: (id: number, commentId: number) => Promise<boolean>;
}

const initial = (name: string | undefined | null) => (name?.trim()[0] ?? "?").toUpperCase();

/**
 * One work item in full: where it sits (its parents, each clickable), its
 * details and description, what's under it, and its discussion. Changes made
 * here are proposals, confirmed like any other.
 */
export function WorkItemDetailView({ detail, backLabel, onBack, onOpen, onProposeComment, onProposeDescription, onProposeDeleteComment }: Props) {
  const [editing, setEditing] = useState(false);
  const [draftDesc, setDraftDesc] = useState(detail.description);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const chain = [...detail.ancestors].reverse();

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim() || sending) return;
    setSending(true);
    if (await onProposeComment(detail.id, comment.trim())) setComment("");
    setSending(false);
  };

  const submitDescription = async () => {
    setSending(true);
    if (await onProposeDescription(detail.id, draftDesc)) setEditing(false);
    setSending(false);
  };

  return (
    <article className="wdetail animate-rise" aria-label={`${detail.type} ${detail.id}`}>
      {backLabel && (
        <button className="backbtn" onClick={onBack}>
          <ChevronLeftIcon size={16} />
          {backLabel}
        </button>
      )}

      {chain.length > 0 && (
        <nav className="crumbs" aria-label="Parents">
          {chain.map((a, i) => (
            <span key={a.id} className="contents">
              {i > 0 && <ChevronRightIcon size={14} className="flex-none text-muted" />}
              <button className="crumb" onClick={() => onOpen(a.id)} title={`Open ${a.type} #${a.id}`}>
                <span className={`ty-dot ${typeTone(a.type)}`} aria-hidden>
                  <TypeIcon type={a.type} size={13} />
                </span>
                <span className="truncate">{a.title}</span>
              </button>
            </span>
          ))}
        </nav>
      )}

      <header className="wd-head">
        <div className="crow">
          <span className={`ty ${typeTone(detail.type)}`}>
            <i aria-hidden>
              <TypeIcon type={detail.type} size={16} />
            </i>
            {detail.type}
            <span className="id">#{detail.id}</span>
          </span>
          <StateBadge state={detail.state} category={detail.stateCategory} />
        </div>
        <h2 className="wd-title">{detail.title}</h2>
        {detail.url && (
          <a className="extlink" href={detail.url} target="_blank" rel="noreferrer">
            Open in Azure DevOps
            <ExternalIcon />
          </a>
        )}
      </header>

      <dl className="facts">
        <div>
          <dt>Assigned</dt>
          <dd>
            <span className="ava" aria-hidden>
              {detail.assignedTo ? initial(detail.assignedTo.displayName) : "–"}
            </span>
            <span className="truncate">{detail.assignedTo?.displayName ?? "Unassigned"}</span>
          </dd>
        </div>
        <div>
          <dt>Sprint</dt>
          <dd>{detail.sprintName ?? "Backlog"}</dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd className={detail.priority === 1 ? "text-[#ffb083]" : ""}>
            {detail.priority !== null ? (
              <>
                <FlagIcon /> P{detail.priority}
              </>
            ) : (
              "None"
            )}
          </dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{detail.changedAt ? relativeTime(Date.parse(detail.changedAt)) : "–"}</dd>
        </div>
      </dl>
      {detail.tags.length > 0 && (
        <p className="tagrow">
          {detail.tags.map((t) => (
            <span key={t} className="tagchip">
              {t}
            </span>
          ))}
        </p>
      )}

      <section className="wd-sec" aria-labelledby="wd-desc">
        <div className="wd-sec-h">
          <h3 id="wd-desc">Description</h3>
          {!editing && (
            <button
              className="minibtn"
              onClick={() => {
                setDraftDesc(detail.description);
                setEditing(true);
              }}
            >
              <EditIcon size={14} />
              {detail.description ? "Edit" : "Add"}
            </button>
          )}
        </div>
        {editing ? (
          <div className="flex flex-col gap-2">
            <label className="sr-only" htmlFor="wd-desc-edit">
              Description
            </label>
            <textarea id="wd-desc-edit" className="wd-textarea" rows={6} value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button className="pill sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="pill sm pri" disabled={sending || draftDesc.trim() === detail.description.trim()} onClick={submitDescription}>
                Preview change
              </button>
            </div>
          </div>
        ) : detail.description ? (
          <div className="wd-desc">
            {detail.description.split(/\n\s*\n/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        ) : (
          <p className="sub2">No description yet. Add one here, or ask “write a good description for this”.</p>
        )}
      </section>

      {detail.children.length > 0 && (
        <section className="wd-sec" aria-labelledby="wd-children">
          <div className="wd-sec-h">
            <h3 id="wd-children">Under this {detail.type.toLowerCase()}</h3>
            <span className="sub2">{detail.children.length}</span>
          </div>
          <ul className="kids">
            {detail.children.map((c) => (
              <li key={c.id}>
                <button className="kid" onClick={() => onOpen(c.id)}>
                  <span className={`ty-dot ${typeTone(c.type)}`} aria-hidden>
                    <TypeIcon type={c.type} size={13} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <StateBadge state={c.state} category={c.stateCategory} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="wd-sec" aria-labelledby="wd-comments">
        <div className="wd-sec-h">
          <h3 id="wd-comments">Comments</h3>
          <span className="sub2">{detail.comments.length}</span>
        </div>
        <form className="cbox" onSubmit={submitComment}>
          <label className="sr-only" htmlFor="wd-comment">
            Add a comment
          </label>
          <CommentIcon size={16} className="flex-none text-muted" />
          <input id="wd-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment" />
          <button type="submit" className="ibtn" aria-label="Preview comment" disabled={!comment.trim() || sending}>
            <SendIcon size={16} />
          </button>
        </form>
        {detail.comments.length === 0 ? (
          <p className="sub2 mt-2">No comments yet.</p>
        ) : (
          <ol className="clist">
            {detail.comments.map((c) => (
              <li key={c.id} className="citem">
                <span className="ava" aria-hidden>
                  {initial(c.author)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="cmeta">
                    <b>{c.author}</b>
                    {c.createdAt && <span>{relativeTime(Date.parse(c.createdAt))}</span>}
                  </p>
                  <p className="ctext">{c.text}</p>
                </div>
                <button className="ibtn cdel" onClick={() => onProposeDeleteComment(detail.id, c.id)} aria-label={`Delete ${c.author}'s comment`}>
                  <TrashIcon size={15} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
