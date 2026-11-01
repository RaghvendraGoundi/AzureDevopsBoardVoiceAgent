import { headers } from "next/headers";
import Link from "next/link";
import { LogoMark, TypeIcon } from "@/components/voice/icons";
import { StateBadge } from "@/components/voice/WorkItemCard";
import { loadSprintBoard } from "@/lib/devops/sprintBoard";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const board = await loadSprintBoard(await headers());

  return (
    <div className="scene min-h-dvh">
      <div className="bg" />
      <div className="vig" />
      <div className="relative z-10">
        <header className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <LogoMark />
            <span className="disp logotxt text-[17px] font-bold tracking-[-0.01em]">
              DevOps<span> Voice</span>
            </span>
            {board.ok && <span className="sub2 ml-3 hidden sm:inline">{board.subtitle}</span>}
          </div>
          <Link href="/voice" className="pill sm">
            Back to voice
          </Link>
        </header>

        {!board.ok ? (
          <p role="alert" className="card mx-4 text-sm text-danger sm:mx-6">
            {board.error}
          </p>
        ) : (
          <>
            <h1 className="serif px-4 pt-2 pb-5 text-[40px] leading-none sm:px-6">{board.title}</h1>
            <main className="grid gap-4 px-4 pb-8 sm:grid-cols-2 sm:px-6 xl:grid-cols-[repeat(auto-fit,minmax(0,1fr))]">
              {board.columns.map((column) => (
                <section key={column.category} className="panel p-3" aria-label={column.label}>
                  <h2 className="flex items-center justify-between px-2 pt-1 pb-3 text-[15px] font-semibold">
                    {column.label}
                    <span className="mono text-xs text-muted">{column.items.length}</span>
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {column.items.map((i) => (
                      <li key={i.id} className="card p-3.5!">
                        <div className="meta">
                          <span className="tg">
                            <TypeIcon type={i.type} />
                            {i.type}
                          </span>
                          <span>#{i.id}</span>
                          <span className="ml-auto">
                            <StateBadge state={i.state} category={i.stateCategory} />
                          </span>
                        </div>
                        <p className="ttl text-[15px]!">
                          {i.url ? (
                            <a href={i.url} target="_blank" rel="noreferrer" className="hover:underline">
                              {i.title}
                            </a>
                          ) : (
                            i.title
                          )}
                        </p>
                        {i.parentId && <p className="sub2 truncate">↳ #{i.parentId} {i.parentTitle}</p>}
                        <p className="sub2 mt-1">
                          {i.assignedTo?.displayName ?? "Unassigned"}
                          {i.priority !== null && ` · P${i.priority}`}
                        </p>
                      </li>
                    ))}
                    {column.items.length === 0 && <li className="sub2 px-2 py-3">Nothing here.</li>}
                  </ul>
                </section>
              ))}
            </main>
          </>
        )}
      </div>
    </div>
  );
}
