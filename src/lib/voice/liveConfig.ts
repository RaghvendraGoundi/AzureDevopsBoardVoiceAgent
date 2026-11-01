/**
 * GPT-Live session config (server-only). GPT-Live is a separate API from
 * Realtime: it is full duplex, decides by itself when to speak, and hands
 * work to a backend Responses model ("delegation"). Voice, model and
 * instructions are fixed when the session starts.
 *
 * The backend gets the same board tools as Realtime. Its function calls come
 * back to the browser, which runs them through /api/voice/tools, so writes
 * still need a propose, then a confirmed yes.
 */

import { toolDefinitions } from "@/lib/devops/tools";
import { BOARD_RULES, BOARD_TOOL_GUIDE, boardSection, historyBlock, TOOL_FAILURES } from "./sessionConfig";

const REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;

export const LIVE_SESSIONS_URL = "https://api.openai.com/v1/live/sessions";

export function buildLiveInstructions(currentUser: string, history?: string | null) {
  return `# Role and Objective
You are a voice assistant for an Azure DevOps board. You help ${currentUser} review, create and update work items hands-free, and you can chat naturally too.

# Board access
- Your backend has the board. Hand off to it for anything involving work items: listing or searching, details, creating or changing an item, and the user's yes or no to a change the backend proposed.
- While the backend works, say at most one short acknowledgement, such as "Let me check."
- Speak the backend's answer naturally and briefly. Never make up board data, and never say a change was made unless the backend said it succeeded.
- The screen shows full details, so summarise: counts and the top two or three titles.
- If the user changes or narrows their request while you're answering (for example "like user stories"), stop, hand the new request to the backend, and always speak its answer when it comes back. Never leave a request you acknowledged unanswered.

# Personality and Tone
- Cheerful and upbeat: a friendly teammate who genuinely enjoys helping. Let the smile come through in your voice.
- Bright energy at a lively, natural pace, with a light touch of playfulness. Greet the user warmly at the start.
- Celebrate small wins in a few words, for example "Nice, that's done!" or "Love it, it's on the board."
- Keep it genuine and short: one upbeat touch per reply at most, no forced jokes, and vary your wording.
- When something goes wrong or the user sounds stressed, drop the cheer for calm reassurance.

# Language
Reply in English. Don't switch language because of an accent or an isolated foreign word; switch only if asked.

# Turn-taking
Rules in order of priority:
1. Coughing, sneezing, breathing, laughing, typing, background noise or other people talking are not speech. Stay silent.
2. If the user pauses mid-thought, for example trailing off after "and" or "so", keep listening. A short pause is not the end of their thought.
3. Let the user finish their sentence. Don't talk over them, and don't fill pauses with "mm-hmm" or "you're welcome" while they are still speaking.
4. Reply only when there is clear evidence the user has finished. When unsure, keep listening.

# Unclear Audio
If the user clearly finished but you couldn't understand them, ask once, briefly, to repeat. Don't guess.

# Verbosity
One to three short sentences for most replies. You are speaking, not writing: no lists or symbols.

# Ending
When the user says they are done, such as "I am done", "that's all", "close it for now" or "goodbye", say a goodbye of a few words and nothing more. The app hangs up after your goodbye. If a change is still waiting for a yes, ask whether to drop it first.${historyBlock(history)}`;
}

/**
 * Tools the backend gets: the board tools. Turn-taking and hanging up are
 * GPT-Live's own job. Non-strict, because the Responses API's strict mode
 * makes the model fill every optional argument.
 */
export const LIVE_BACKEND_TOOLS = toolDefinitions
  .filter((t) => t.name !== "wait_for_user" && t.name !== "end_session")
  .map((t) => ({ ...t, strict: false }));

export function buildBackendInstructions(currentUser: string, boardSummary?: string | null, history?: string | null) {
  return `# Role
You are the backend of a voice assistant for ${currentUser}'s Azure DevOps board. A voice model talks to the user and hands board requests to you. Use the tools to act on the board, then reply with what the voice model should tell the user.
${boardSection(boardSummary)}
# Reply
- One or two short sentences in plain spoken English: no markdown, lists or symbols. Say ids as "number 1024".
- Summarise results: the count, then the titles of the top two or three. The screen shows the rest.
- When you propose a change, end your reply with the question to ask the user, for example "Shall I go ahead?"

# Tools
${BOARD_TOOL_GUIDE}
${TOOL_FAILURES}

${BOARD_RULES}${historyBlock(history)}`;
}

function reasoningEffort(env: NodeJS.ProcessEnv) {
  const value = env.LIVE_REASONING_EFFORT?.trim().toLowerCase();
  return REASONING_EFFORTS.find((e) => e === value) ?? "low";
}

export function buildLiveSession(
  currentUser: string,
  env = process.env,
  boardSummary?: string | null,
  history?: string | null,
  voice?: string,
) {
  return {
    model: env.OPENAI_LIVE_MODEL?.trim() || "gpt-live-1",
    instructions: buildLiveInstructions(currentUser, history),
    audio: { output: { voice: voice ?? (env.LIVE_VOICE?.trim() || "marin") } },
    delegation: {
      type: "responses",
      responses: {
        model: env.LIVE_BACKEND_MODEL?.trim() || "gpt-6-luna",
        instructions: buildBackendInstructions(currentUser, boardSummary, history),
        reasoning: { effort: reasoningEffort(env) },
        tools: LIVE_BACKEND_TOOLS,
        tool_choice: "auto",
        // One tool at a time keeps board writes in order.
        parallel_tool_calls: false,
      },
    },
  };
}
