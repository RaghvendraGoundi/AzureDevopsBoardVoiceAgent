"use client";

import Link from "next/link";
import { useState } from "react";
import { useVoiceSession } from "@/hooks/voice/useVoiceSession";
import { AgentStatus } from "./AgentStatus";
import { ConversationList } from "./ConversationList";
import { ConversationTranscript } from "./ConversationTranscript";
import { DevOpsWorkspace } from "./DevOpsWorkspace";
import { SessionDialog } from "./SessionDialog";
import { VoiceControls } from "./VoiceControls";
import { VoiceOrb } from "./VoiceOrb";

export function VoiceWorkspace() {
  const s = useVoiceSession();
  const { state, conversations: c } = s;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const locked = state.connection === "connected" || state.connection === "connecting" || s.demoRunning;
  const currentTitle = c.conversations.find((x) => x.id === c.currentId)?.title ?? null;

  const list = (
    <ConversationList
      conversations={c.conversations}
      currentId={c.currentId}
      loadingId={c.loadingId}
      locked={locked}
      onNew={() => {
        c.newConversation();
        setDrawerOpen(false);
      }}
      onOpen={(id) => {
        void c.open(id);
        setDrawerOpen(false);
      }}
      onDelete={(id) => void c.remove(id)}
    />
  );

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={() => setDrawerOpen(true)}
            className="rounded-lg border border-line px-2 py-1 text-xs font-medium hover:bg-panel-2 lg:hidden"
            aria-label="Show conversations"
          >
            ☰
          </button>
          <span className="size-2.5 shrink-0 rounded-full bg-accent" />
          <span className="font-semibold">DevOps Voice</span>
          <span className="hidden truncate text-sm text-muted sm:inline">{currentTitle ? `· ${currentTitle}` : "· New conversation"}</span>
        </div>
        <Link href="/board" className="shrink-0 text-sm text-muted hover:text-fg">
          View board →
        </Link>
      </header>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Conversations">
          <button className="absolute inset-0 bg-black/50" aria-label="Close conversations" onClick={() => setDrawerOpen(false)} />
          <div className="animate-rise absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-panel">{list}</div>
        </div>
      )}

      <main className="grid flex-1 gap-4 p-4 sm:p-6 lg:min-h-0 lg:grid-cols-[240px_minmax(340px,420px)_1fr]">
        <aside className="hidden rounded-2xl border border-line bg-panel lg:block lg:min-h-0">{list}</aside>

        <section className="flex flex-col rounded-2xl border border-line bg-panel lg:min-h-0" aria-label="Voice assistant">
          <div className="flex flex-col items-center gap-3 px-4 pt-6 pb-4">
            <VoiceOrb status={state.status} levels={s.levels} />
            <AgentStatus status={state.status} activeTool={state.activeTool} />
            <VoiceControls
              connection={state.connection}
              muted={s.muted}
              demoRunning={s.demoRunning}
              mode={s.mode}
              talking={s.talking}
              engine={s.engine}
              onEngineChange={s.setEngine}
              onModeChange={s.setMode}
              onTalkStart={s.pttStart}
              onTalkEnd={s.pttEnd}
              onStart={s.start}
              onStop={s.stop}
              onToggleMute={s.toggleMute}
              onDemo={s.startDemo}
              onStopDemo={s.stopDemo}
            />
            {state.connectionError && (
              <p role="alert" className="max-w-xs text-center text-xs text-danger">
                {state.connectionError}
              </p>
            )}
          </div>
          <div className="min-h-64 flex-1 overflow-y-auto border-t border-line lg:min-h-0">
            <ConversationTranscript entries={state.transcript} />
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-panel/50 p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto" aria-label="DevOps workspace">
          <DevOpsWorkspace state={state} onResolve={s.resolvePending} onDismissError={s.dismissError} />
        </section>
      </main>

      <SessionDialog
        closing={state.connection === "connected" ? state.closing : null}
        summary={state.sessionSummary}
        conversationTitle={currentTitle}
        onContinue={() => {
          s.dismissSessionSummary();
          void s.start();
        }}
        onNewConversation={() => {
          s.dismissSessionSummary();
          c.newConversation();
        }}
        onDismiss={s.dismissSessionSummary}
      />
    </div>
  );
}
