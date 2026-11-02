"use client";

import { useEffect, useState } from "react";
import { useVoiceSession } from "@/hooks/voice/useVoiceSession";
import { AgentStatus } from "./AgentStatus";
import { CallDock } from "./CallDock";
import { CallStage } from "./CallStage";
import { ChangeToast } from "./ChangeToast";
import { ChatPanel } from "./ChatPanel";
import { VoicePicker } from "./VoicePicker";
import { ChatIcon, KeyboardIcon, MicIcon, WorkspaceIcon } from "./icons";
import { STARS_SHADOW } from "./sceneStars";
import { SessionDialog } from "./SessionDialog";
import { TopBar } from "./TopBar";
import { WorkspacePanel } from "./WorkspacePanel";

/** True on screens wide enough for side panels; phones and small tablets get bottom sheets. */
function useWide() {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return wide;
}

/**
 * The voice page, variant B ("Ink and signal"): the orb first, with Chat and
 * Workspace sliding in from the edges when there's something to show.
 */
export function VoiceWorkspace() {
  const s = useVoiceSession();
  const { state, conversations: c } = s;
  const wide = useWide();
  const [chatOpen, setChatOpen] = useState(false);
  const [workOpen, setWorkOpen] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [focusChat, setFocusChat] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const live = state.connection === "connected" || s.demoRunning;
  const locked = live || state.connection === "connecting";
  const currentTitle = c.conversations.find((x) => x.id === c.currentId)?.title ?? null;

  // Results or a change to confirm bring the workspace in.
  useEffect(() => {
    if (state.results || state.pending || state.detail) setWorkOpen(true);
  }, [state.results, state.pending, state.detail]);
  // Space does what tapping the orb does: start a call, or cut the assistant off.
  // (In push-to-talk calls the session hook owns Space for talking.)
  const pttCall = live && s.mode === "ptt" && s.engine === "realtime";
  const speaking = state.status === "speaking";
  const { start, interrupt } = s;
  useEffect(() => {
    if (pttCall || s.demoRunning || pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      // Typing, or a focused control that Space already activates.
      if (t?.closest("input, textarea, select, button, a, [contenteditable], [role=dialog]")) return;
      if (!locked) {
        e.preventDefault();
        void start();
      } else if (live && speaking) {
        e.preventDefault();
        interrupt();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pttCall, locked, live, speaking, start, interrupt, s.demoRunning, pickerOpen]);

  // On a phone only one sheet is open at a time.
  useEffect(() => {
    if (!wide && chatOpen && workOpen) setChatOpen(false);
  }, [wide, workOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const openChat = () => {
    setChatOpen(true);
    if (!wide) setWorkOpen(false);
  };
  const openWork = () => {
    setWorkOpen(true);
    if (!wide) setChatOpen(false);
  };

  const messageCount = state.transcript.filter((e) => e.text.trim()).length;
  const resultCount = state.results?.items.length ?? 0;

  const chat = (variant: "panel" | "sheet") => (
    <ChatPanel
      variant={variant}
      transcript={state.transcript}
      conversations={c.conversations}
      currentId={c.currentId}
      loadingId={c.loadingId}
      locked={locked}
      canType={s.engine === "realtime" && !s.demoRunning}
      onClose={() => setChatOpen(false)}
      onNew={() => {
        c.newConversation();
        setWorkOpen(false);
      }}
      onOpen={(id) => {
        void c.open(id);
        if (wide) setWorkOpen(true);
      }}
      onDelete={(id) => void c.remove(id)}
      onSend={s.sendText}
      focusKey={focusChat}
      live={live}
      results={state.results}
      onOpenWorkspace={openWork}
      onFocusItem={(id) => {
        s.focusItem(id);
        openWork();
      }}
    />
  );
  const work = (variant: "panel" | "sheet") => (
    <WorkspacePanel
      variant={variant}
      state={state}
      busy={state.activeTool !== null}
      onClose={() => setWorkOpen(false)}
      onResolve={s.resolvePending}
      onDismissError={s.dismissError}
      board={s.board}
      onStopWaiting={s.stopWaiting}
    />
  );

  return (
    <div className="scene flex h-dvh flex-col">
      <div className="bg" />
      <div className="stars" style={{ boxShadow: STARS_SHADOW }} aria-hidden />
      <div className="floor" aria-hidden />
      <div className="vig" aria-hidden />
      <div className="scan" aria-hidden />
      <AgentStatus status={state.status} activeTool={state.activeTool} />

      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <TopBar
          connection={state.connection}
          demoRunning={s.demoRunning}
          engine={s.engine}
          voice={s.voice}
          onOpenPicker={() => setPickerOpen(true)}
          onEngineChange={s.setEngine}
        />

        <div className="relative flex min-h-0 flex-1">
          {wide && (
            <>
              <aside
                aria-label="Chat"
                aria-hidden={!chatOpen}
                inert={!chatOpen}
                className={`panel hud absolute top-2 bottom-5 left-5 z-10 w-[min(400px,30vw)] overflow-hidden transition-[transform,opacity] duration-500 ease-[cubic-bezier(.2,.8,.2,1)] ${
                  chatOpen ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-[110%] opacity-0"
                }`}
              >
                <div className="sheen" aria-hidden />
                <div className="relative z-[1] h-full">{chat("panel")}</div>
              </aside>
              <aside
                aria-label="Workspace"
                aria-hidden={!workOpen}
                inert={!workOpen}
                className={`panel hud absolute top-2 right-5 bottom-5 z-10 w-[min(440px,34vw)] overflow-hidden transition-[transform,opacity] duration-500 ease-[cubic-bezier(.2,.8,.2,1)] ${
                  workOpen ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-[110%] opacity-0"
                }`}
              >
                <div className="sheen" aria-hidden />
                <div className="relative z-[1] h-full">{work("panel")}</div>
              </aside>
            </>
          )}

          {!(wide && chatOpen) && (
            <button className="edge l" onClick={openChat} aria-label="Open chat" aria-expanded={chatOpen}>
              <ChatIcon size={18} />
              <span className="v">Chat</span>
              {messageCount > 0 && <span className="n">{messageCount}</span>}
            </button>
          )}
          {!(wide && workOpen) && (
            <button className="edge r" onClick={openWork} aria-label="Open workspace" aria-expanded={workOpen}>
              <WorkspaceIcon size={18} />
              <span className="v">Workspace</span>
              {state.pending ? <span className="nd" aria-label="A change is waiting for your yes" /> : resultCount > 0 && <span className="n">{resultCount}</span>}
            </button>
          )}

          {/* As in the design, the orb stays centred and panels slide over the scene; only
              narrower screens make room for open panels. */}
          <main
            className={`flex min-w-0 flex-1 flex-col items-center px-14 transition-[padding] duration-500 ${
              wide && chatOpen ? "max-[1359px]:pl-[calc(min(400px,30vw)+40px)]" : ""
            } ${wide && workOpen ? "max-[1359px]:pr-[calc(min(440px,34vw)+40px)]" : ""}`}
          >
            <div className="@container flex min-h-0 w-full flex-1 flex-col items-center pt-3.5 [container-type:inline-size]">
              <CallStage
                state={state}
                mode={s.mode}
                talking={s.talking}
                muted={s.muted}
                captions={captions}
                demoRunning={s.demoRunning}
                levels={s.levels}
                narrowCaptions={wide && (chatOpen || workOpen)}
                onOrb={() => (live ? s.interrupt() : !locked && void s.start())}
                onStopWaiting={s.stopWaiting}
              />

            </div>
            {!locked && !s.demoRunning && (
              <div className="idlebar">
                <p className="hint">
                  Tap the orb or press <kbd className="kbd">SPACE</kbd> to start
                </p>
                {s.engine === "realtime" && (
                  <div className="seg" role="radiogroup" aria-label="How you talk">
                    {(["handsfree", "ptt"] as const).map((m) => (
                      <button key={m} role="radio" aria-checked={s.mode === m} onClick={() => s.setMode(m)}>
                        {m === "handsfree" ? <MicIcon size={17} /> : <KeyboardIcon size={17} />}
                        {m === "handsfree" ? "Hands-free" : "Push to talk"}
                      </button>
                    ))}
                  </div>
                )}
                {/* The scripted demo confirms a real change, so it's only offered on the emulated board. */}
                {state.boardInfo?.provider !== "azure" && (
                  <button className="textbtn" onClick={s.startDemo}>
                    Or watch a scripted demo
                  </button>
                )}
              </div>
            )}
            {(live || state.connection === "connecting") && (
            <div className="flex w-full justify-center pt-2 pb-5">
              <CallDock
                connection={state.connection}
                status={state.status}
                mode={s.mode}
                talking={s.talking}
                muted={s.muted}
                captions={captions}
                demoRunning={s.demoRunning}
                levels={s.levels}
                onStop={s.stop}
                onToggleMute={s.toggleMute}
                onToggleCaptions={() => setCaptions((v) => !v)}
                onInterrupt={s.interrupt}
                onType={() => {
                  openChat();
                  setFocusChat((n) => n + 1);
                }}
                onTalkStart={s.pttStart}
                onTalkEnd={s.pttEnd}
                onStopDemo={s.stopDemo}
              />
            </div>
            )}
          </main>
        </div>
      </div>

      {!wide && (chatOpen || workOpen) && (
        <div className="fixed inset-0 z-30" role="dialog" aria-modal="true" aria-label={chatOpen ? "Chat" : "Workspace"}>
          <button className="absolute inset-0 bg-[rgba(2,4,10,0.55)]" aria-label="Close" onClick={() => (chatOpen ? setChatOpen(false) : setWorkOpen(false))} />
          <div className="panel hud animate-rise absolute inset-x-0 bottom-0 flex h-[80dvh] flex-col rounded-b-none! border-b-0">
            <div className="sheen" aria-hidden />
            <div className="sheet-grab relative z-[1]" aria-hidden />
            <div className="relative z-[1] min-h-0 flex-1">{chatOpen ? chat("sheet") : work("sheet")}</div>
          </div>
        </div>
      )}

      <ChangeToast activity={state.activity} />
      {pickerOpen && (
        <VoicePicker
          engine={s.engine}
          voices={s.voices}
          mode={s.mode}
          locked={locked}
          onClose={() => setPickerOpen(false)}
          onConfirm={(engine, voice, mode) => {
            s.setEngine(engine);
            s.setVoice(voice, engine);
            if (engine === "realtime") s.setMode(mode);
            setPickerOpen(false);
          }}
        />
      )}

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
          setChatOpen(false);
          setWorkOpen(false);
        }}
        onDismiss={s.dismissSessionSummary}
      />
    </div>
  );
}
