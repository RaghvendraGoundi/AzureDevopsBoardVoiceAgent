import { headers } from "next/headers";
import Link from "next/link";
import { StateBadge } from "@/components/voice/WorkItemCard";
import { loadSprintBoard } from "@/lib/devops/sprintBoard";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const board = await loadSprintBoard(await headers());

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-6">
        <div>
          <span className="font-semibold">{board.ok ? board.title : "Board"}</span>
          {board.ok && <span className="ml-3 text-xs text-muted">{board.subtitle}</span>}
        </div>
        <Link href="/voice" className="text-sm text-muted hover:text-fg">
          ← Back to voice
        </Link>
      </header>
      {!board.ok ? (
        <p role="alert" className="p-6 text-sm text-danger">
          {board.error}
        </p>
      ) : (
        <main className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6 xl:grid-cols-4">
          {board.columns.map((column) => (
            <section key={column.category} className="rounded-2xl border border-line bg-panel p-3">
              <h2 className="mb-3 flex items-center justify-between px-1 text-sm font-semibold">
                {column.label}
                <span className="text-muted">{column.items.length}</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {column.items.map((i) => (
                  <li key={i.id} className="rounded-lg bg-panel-2 p-3 text-sm">
                    <p className="flex items-center justify-between gap-2 text-xs text-muted">
                      <span>
                        {i.type} · #{i.id}
                        {i.priority !== null && ` · P${i.priority}`} · rev {i.rev}
                      </span>
                      <StateBadge state={i.state} category={i.stateCategory} />
                    </p>
                    <p className="mt-1 font-medium">
                      {i.url ? (
                        <a href={i.url} target="_blank" rel="noreferrer" className="hover:underline">
                          {i.title}
                        </a>
                      ) : (
                        i.title
                      )}
                    </p>
                    {i.parentId && (
                      <p className="mt-1 truncate text-xs text-muted">
                        ↳ #{i.parentId} {i.parentTitle}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted">{i.assignedTo?.displayName ?? "Unassigned"}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </main>
      )}
    </div>
  );
}
