import type { AgentStatus as Status } from "@/types/voice";

const LABELS: Record<Status, string> = {
  idle: "Tap start to talk to your board",
  connecting: "Connecting…",
  listening: "Listening…",
  processing: "Processing your request…",
  speaking: "Speaking…",
  error: "Something went wrong",
};

/** Announces the assistant's state to screen readers (the stage shows it visually). */
export function AgentStatus({ status, activeTool, className = "sr-only" }: { status: Status; activeTool: string | null; className?: string }) {
  return (
    <p className={className} aria-live="polite">
      {activeTool ?? LABELS[status]}
    </p>
  );
}
