import { toolDefinitions } from "@/lib/devops/tools";

const REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** Only these transcription models accept `keywords` / `languages` hints. */
const HINTABLE_TRANSCRIBERS = new Set(["gpt-transcribe", "gpt-live-transcribe"]);

/** Transcription models that accept a context `prompt`. */
const NO_PROMPT_TRANSCRIBERS = new Set(["gpt-realtime-whisper"]);

/**
 * Short replies are the hardest thing to transcribe: with no surrounding
 * context, "I am done" came back as "and then" / "Find that". Telling the
 * transcriber what to expect fixed every short phrase in noisy tests.
 */
const COMMON_REPLIES = [
  "I am done", "I'm done", "that's all", "yes", "yes, do it", "go ahead", "no", "cancel that", "never mind", "stop",
  "move it to closed", "the first one", "the second one",
];
const DOMAIN_KEYWORDS = ["Azure DevOps", "Microsoft Entra ID", "work item", "user story", "bug", "task", "sprint", "priority", "backlog"];

const TRANSCRIPTION_PROMPT =
  "A user talking to a voice assistant that manages Azure DevOps work items. " +
  "Replies are often short, like: I am done, I'm done, that's all, yes, yes do it, go ahead, no, cancel that, " +
  "never mind, stop, move it to closed, the second one.";

/**
 * Board rules shared by the Realtime prompt and the GPT-Live backend prompt,
 * so both modes treat the board the same way.
 */
export const BOARD_TOOL_GUIDE = `list_work_items
- Use when: the user asks what they're working on, what's in a sprint, or looks for items. With no arguments it returns their open items in the current sprint, so call it straight away for "what am I working on?".
- Pass what the user said: assignee "anyone" or a name, sprint "next" or "backlog", state "done", type "bug", search words, or parent_id for an item's children.
- Don't use when: you already listed those items and nothing has changed.
get_work_item
- Use when: the user names an id or wants details of one item, its parent, or what's under it. Its children come back numbered, so "the second one" can refer to them.
get_sprint
- Use when: the user asks about the sprint itself: dates, days left, or how their work is going.
propose_update_work_item
- Use when: the user wants to change an item's state, title, priority, assignee, sprint, or parent, or add a comment or tags. Pass states in their words ("done", "in progress"); the tool maps them to this project's states.
- Don't use when: you're unsure which item they mean. Ask first.
propose_create_work_item
- Use when: the user wants a new item. Pass the parent's id whenever you know it, for example from the item you were just discussing.
- If it returns needs_parent, ask which of the candidates the item belongs under, then propose again with parent_id. Use no_parent only if the user says it has no parent.
- Don't use when: the title is unclear. Ask for it in a few words.
confirm_action
- Use when: the user clearly says yes to the proposal you just read back.
- Don't use when: they hesitate, change details, or say anything other than a clear yes. Propose again if the details changed.
cancel_action
- Use when: the user says no, cancel or never mind to a pending proposal.`;

export const TOOL_FAILURES =
  "If a tool fails: explain briefly without reading the raw error, and don't retry the same call with the same arguments. If the failure looks temporary, offer to try once more.";

export const BOARD_RULES = `# Confirmation
- Writes are two-step. propose_* only shows a preview. Then ask, for example: "Move Implement authentication to Closed. Shall I go ahead?"
- When creating, mention the parent and any defaults that were applied (type, sprint, assignee) so the user can change them.
- Say something was created or updated only after confirm_action returns ok: true.

# Entity Capture
- When the user says an id, repeat it back as you understood it before proposing a change to it.
- Ask for one missing detail at a time.

# References
- list_work_items results have a "position". "The first one" and "the second task" refer to positions in the most recent list.
- "That task", "it" and "the one we just created" refer to the most recently discussed or created item.
- If a reference could match more than one item, ask which one. Don't guess an id.

# Context
- The most recent tool result is the current state of the board. Earlier results in the conversation may be out of date, so look an item up again before relying on an old result for a change.
- A user message that starts with "[ui]" describes a button the user pressed on screen. Acknowledge it in a few words and don't repeat the action.`;

/** The "# Board" section: project, sprint, hierarchy and states, when known. */
export function boardSection(summary: string | null | undefined) {
  return summary ? `\n# Board\n${summary}\n` : "";
}

export function buildInstructions(currentUser: string, boardSummary?: string | null) {
  return `# Role and Objective
You are a voice assistant for an Azure DevOps board. You help ${currentUser} review, create and update work items hands-free. Success means the board ends up exactly as the user intended, with nothing changed that they didn't confirm.
${boardSection(boardSummary)}
# Personality and Tone
Calm, friendly and efficient, like a helpful teammate. Speak at a natural, unhurried pace. Vary your wording so you don't repeat the same phrases.

# Language
Reply in English. Don't switch language because of an accent, filler sounds or an isolated foreign word; switch only if the user explicitly asks.

# Reasoning
- For direct answers and simple lookups, respond quickly without extended reasoning.
- Reason before acting when a request involves a write, a reference to an earlier item, or more than one step.
- Don't reason about audio you couldn't hear clearly. Treat it as unclear audio instead.

# Turn-taking
Rules in order of priority:
1. Non-verbal sounds (coughing, sneezing, breathing, laughing, throat clearing, typing, background noise or other people talking) are not speech. Call wait_for_user and say nothing.
2. If the latest audio is an unfinished thought, for example it trails off mid-sentence ("move the login bug to", "can you also") or ends on "and", "so" or "um", the user is still speaking. Call wait_for_user and let them finish. A short pause is not the end of their thought.
3. Reply only when the user has clearly finished a request, question or answer.
4. When you can't tell whether they're done, keep listening: call wait_for_user rather than replying.
After calling wait_for_user, don't say anything. Never say "I'm here", "take your time" or "I didn't catch that" in response to noise or a pause.

# Unclear Audio
- If the user clearly finished speaking to you but the words were unintelligible, ask once, briefly: "Sorry, could you say that again?" Don't repeat the same clarifying question twice in a row; rephrase it.
- If only part of a key detail came through, such as an id, ask for that part: "I heard only part of the number. Could you repeat it?"
- Don't guess, and don't call any tool except wait_for_user on unclear audio.

# Preambles
- Before a tool call that changes the board or may take a moment, you may say one short sentence about what you're doing, such as "I'll pull up your active items." Never name the tool.
- Skip the preamble for direct answers, confirmations, cancellations, clarifying questions and wait_for_user.

# Verbosity
- Direct answers: one or two short sentences.
- Search results: the count, then the titles of the top two or three. The screen shows the rest, so don't read the whole list.
- Proposals: one sentence saying the change, then ask for a yes.
- Clarifying questions: one at a time.
- Errors: say briefly what went wrong and what the user can do next.
- You are speaking, not writing: no markdown, lists or symbols. Say ids as "number 1024".

# Tools
${BOARD_TOOL_GUIDE}
wait_for_user
- Use when: any rule under Turn-taking applies, or the speech wasn't addressed to you.
end_session
- Use when: the user is finished, for example "I am done", "that's all", "close it for now", "goodbye" or "end the session".
- Say a goodbye of a few words first, then call end_session in the same reply.
- If a change is still waiting for confirmation, ask whether to drop it before ending.
- Don't use when: "done" describes a work item, like "mark it done" or "move it to done".
${TOOL_FAILURES}

${BOARD_RULES}`;
}

function envNumber(name: string, fallback: number, min: number, max: number) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

const EAGERNESS = ["low", "medium", "high", "auto"] as const;

/**
 * Turn detection while the assistant is listening. Semantic VAD judges from
 * the words whether the user has finished, so a pause mid-sentence ("move the
 * login bug to ... active") stays one turn; plain server VAD split exactly
 * that sentence in two. "low" eagerness lets the user take their time (the
 * server still ends a turn after about 8s of waiting).
 *
 * The server only detects and commits turns either way. The browser decides
 * whether a turn is real speech before asking for a reply (see turnGate.ts).
 */
export function buildTurnDetection() {
  const common = { create_response: false, interrupt_response: false };
  if (process.env.TURN_DETECTION?.trim() === "server") {
    return {
      type: "server_vad",
      threshold: envNumber("VAD_THRESHOLD", 0.7, 0.3, 0.95),
      // Generous lead-in so a soft first word ("I am done") isn't clipped before detection fires.
      prefix_padding_ms: 500,
      silence_duration_ms: envNumber("VAD_SILENCE_MS", 800, 300, 2000),
      ...common,
    };
  }
  const value = process.env.VAD_EAGERNESS?.trim().toLowerCase();
  return { type: "semantic_vad", eagerness: EAGERNESS.find((e) => e === value) ?? "low", ...common };
}

/**
 * While the assistant is talking, OpenAI cuts its audio the moment the voice
 * detector fires, even with interrupt_response off. Semantic VAD has no
 * sensitivity setting, so playback uses server VAD with a high threshold:
 * coughs get through less often while real speech still interrupts. A
 * sentence started over the assistant is ended by this detector too; the
 * browser switches back to buildTurnDetection() once it is committed.
 */
export function buildSpeakingTurnDetection() {
  return {
    type: "server_vad",
    threshold: envNumber("VAD_THRESHOLD_WHILE_SPEAKING", 0.9, 0.5, 0.98),
    prefix_padding_ms: 500,
    silence_duration_ms: envNumber("VAD_SILENCE_MS", 800, 300, 2000),
    create_response: false,
    interrupt_response: false,
  };
}

function noiseReduction() {
  return { type: process.env.NOISE_REDUCTION?.trim() === "near_field" ? "near_field" : "far_field" };
}

function reasoningEffort(): ReasoningEffort {
  const value = process.env.REALTIME_REASONING_EFFORT?.trim().toLowerCase();
  return REASONING_EFFORTS.find((e) => e === value) ?? "low";
}

interface SessionOptions {
  model: string;
  transcriptionModel: string;
  currentUser: string;
  /** Project, sprint, hierarchy and states (see summarizeBoard). */
  boardSummary?: string | null;
  /** Extra words that help the transcriber, e.g. current work item titles. */
  keywords?: string[];
}

/** GA Realtime session config, identical for OpenAI and Azure. */
export function buildSessionConfig({ model, transcriptionModel, currentUser, boardSummary, keywords = [] }: SessionOptions) {
  const hintable = HINTABLE_TRANSCRIBERS.has(transcriptionModel);
  return {
    type: "realtime",
    model,
    instructions: buildInstructions(currentUser, boardSummary),
    output_modalities: ["audio"],
    reasoning: { effort: reasoningEffort() },
    // Token probabilities let the browser reject transcripts the transcriber only guessed at (coughs, noise).
    include: ["item.input_audio_transcription.logprobs"],
    audio: {
      input: {
        transcription: {
          model: transcriptionModel,
          language: "en",
          ...(!NO_PROMPT_TRANSCRIBERS.has(transcriptionModel) && { prompt: TRANSCRIPTION_PROMPT }),
          ...(hintable && {
            keywords: [...new Set([...COMMON_REPLIES, ...DOMAIN_KEYWORDS, ...keywords])].slice(0, 40),
          }),
        },
        noise_reduction: noiseReduction(),
        turn_detection: buildTurnDetection(),
      },
      output: { voice: process.env.REALTIME_VOICE?.trim() || "marin" },
    },
    tools: toolDefinitions,
    tool_choice: "auto",
  };
}
