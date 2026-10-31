import { getUserKey } from "@/lib/devops/boardFactory";
import { getConversationStore, historySection } from "./store";

/** The history section for a conversation being resumed, or null for a fresh one. */
export async function resumeHistory(headers: Headers, conversationId: unknown): Promise<string | null> {
  if (typeof conversationId !== "string" || !conversationId) return null;
  const userKey = await getUserKey(headers).catch(() => null);
  if (!userKey) return null;
  return historySection(await getConversationStore().get(userKey, conversationId));
}
