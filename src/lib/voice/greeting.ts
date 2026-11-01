import type { BoardInfo } from "@/lib/devops/briefing";

/**
 * What the assistant is asked to open the call with: a short, warm greeting
 * by first name, or a welcome back when the conversation already has turns.
 */
export function greetingInstruction(info: BoardInfo | null, resumed: boolean, now = new Date()): string {
  const first = info?.user?.trim().split(/\s+/)[0];
  const part = now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening";
  const who = first ? `the user, ${first}` : "the user";
  const sprint =
    info?.sprint?.daysLeft != null ? ` If it fits naturally, mention that ${info.sprint.name} has ${info.sprint.daysLeft} days left.` : "";
  return resumed
    ? `The user just reopened this conversation. Welcome ${who} back in one short, cheerful sentence and offer to pick up where you left off. Don't call any tools.`
    : `The call just started and it's ${part} for the user. Greet ${who} warmly in one short sentence, then ask what they'd like to work on.${sprint} Keep it under 25 words. Don't call any tools.`;
}
