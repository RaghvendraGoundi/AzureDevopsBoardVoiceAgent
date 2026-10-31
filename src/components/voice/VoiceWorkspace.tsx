"use client";

import Link from "next/link";
import { useVoiceSession } from "@/hooks/voice/useVoiceSession";
import { AgentStatus } from "./AgentStatus";
import { ConversationTranscript } from "./ConversationTranscript";
import { DevOpsWorkspace } from "./DevOpsWorkspace";
import { VoiceControls } from "./VoiceControls";
import { VoiceOrb } from "./VoiceOrb";

export function VoiceWorkspace() {
  const s = useVoiceSession();
  const { state } = s;

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <header className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-accent" />
          <span className="font-semibold">DevOps Voice</span>
          <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted uppercase">
            Emulated board
          </span>
        </div>
        <Link href="/board" className="text-sm text-muted hover:text-fg">
          View board →
        </Link>
      </header>

      <main className="grid flex-1 gap-4 p-4 sm:p-6 lg:min-h-0 lg:grid-cols-[minmax(340px,420px)_1fr]">
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
    </div>
  );
}
