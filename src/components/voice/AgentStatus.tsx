import type { AgentStatus as Status } from "@/types/voice";

const LABELS: Record<Status, string> = {
  idle: "Tap start to talk to your board",
  connecting: "Connecting…",
  listening: "Listening…",
  processing: "Processing your request…",
  speaking: "Speaking…",
  error: "Something went wrong",
};

export function AgentStatus({ status, activeTool }: { status: Status; activeTool: string | null }) {
  return (
    <p className="h-6 text-center text-sm font-medium text-muted" aria-live="polite">
      {activeTool ?? LABELS[status]}
    </p>
  );
}
