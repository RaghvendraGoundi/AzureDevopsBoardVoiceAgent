import type { BacklogLevel, BoardContext, Person, Sprint, StateCategory, TypeInfo } from "./types";

/**
 * Pure helpers that interpret what the user said against the project's
 * process: "story" → "User Story" or "Product Backlog Item", "done" →
 * "Closed" or "Done", "next sprint" → an iteration path, and which types may
 * sit under which.
 */

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");

const TYPE_ALIASES: Record<string, string[]> = {
  story: ["user story", "product backlog item", "requirement", "issue"],
  stories: ["user story", "product backlog item", "requirement", "issue"],
  "user story": ["user story", "product backlog item", "requirement", "issue"],
  pbi: ["product backlog item"],
  "backlog item": ["product backlog item", "user story", "requirement", "issue"],
  requirement: ["requirement", "user story", "product backlog item", "issue"],
  ticket: ["task", "issue"],
  defect: ["bug"],
};

/** The project's type name for what the user said, or null. */
export function resolveType(ctx: BoardContext, input: string): string | null {
  const names = Object.keys(ctx.types);
  const want = norm(input).replace(/s$/, "");
  const exact = names.find((n) => norm(n) === norm(input) || norm(n) === want);
  if (exact) return exact;
  for (const alias of TYPE_ALIASES[want] ?? TYPE_ALIASES[norm(input)] ?? []) {
    const hit = names.find((n) => norm(n) === alias);
    if (hit) return hit;
  }
  return names.find((n) => norm(n).includes(want)) ?? null;
}

/** The backlog level a type belongs to (bugs follow the team's bug setting). */
export function levelOf(ctx: BoardContext, type: string): BacklogLevel | null {
  const direct = ctx.hierarchy.find((l) => l.types.includes(type));
  if (direct) return direct;
  if (ctx.bugTypes.includes(type)) {
    if (ctx.bugsBehavior === "asTasks") return ctx.hierarchy.find((l) => l.kind === "task") ?? null;
    if (ctx.bugsBehavior === "asRequirements") return ctx.hierarchy.find((l) => l.kind === "requirement") ?? null;
  }
  return null;
}

/** Types that may be the parent of `type`: the level directly above it (bugs count at their level). */
export function parentTypesFor(ctx: BoardContext, type: string): string[] {
  const level = levelOf(ctx, type);
  if (!level) return [];
  const above = ctx.hierarchy
    .filter((l) => l.rank > level.rank)
    .sort((a, b) => a.rank - b.rank)[0];
  if (!above) return [];
  const bugsHere = above.kind === "requirement" && ctx.bugsBehavior === "asRequirements" ? ctx.bugTypes : [];
  return [...new Set([...above.types, ...bugsHere])];
}

/** The default type for a child of `parentType`, e.g. Task under a User Story. */
export function defaultChildType(ctx: BoardContext, parentType: string): string | null {
  const level = levelOf(ctx, parentType);
  if (!level) return null;
  const below = ctx.hierarchy
    .filter((l) => l.rank < level.rank)
    .sort((a, b) => b.rank - a.rank)[0];
  return below?.defaultType ?? null;
}

export function hierarchyLabel(ctx: BoardContext): string {
  return ctx.hierarchy.map((l) => l.types.join(" / ")).join(" → ");
}

const CATEGORY_ALIASES: Array<[RegExp, StateCategory]> = [
  [/^(done|complete|completed|finish|finished|closed|close)$/, "Completed"],
  [/^(in progress|active|doing|started|start|working|committed|ongoing)$/, "InProgress"],
  [/^(new|to do|todo|not started|proposed|open again|reopen|reopened|backlog|approved)$/, "Proposed"],
  [/^(resolved|fixed|ready for test|ready for review|in review)$/, "Resolved"],
  [/^(removed|remove|cancelled|canceled|wont do|obsolete|dropped)$/, "Removed"],
];

export function categoryFor(input: string): StateCategory | null {
  const n = norm(input);
  return CATEGORY_ALIASES.find(([re]) => re.test(n))?.[1] ?? null;
}

const FILLER_WORDS = new Set(["in", "to", "the", "for", "a", "an", "on", "of", "it", "as"]);
const keyWords = (s: string) => norm(s).split(" ").filter((w) => w && !FILLER_WORDS.has(w));
const HOLD = /^(blocked|paused|pause|waiting|stuck|parked|hold|on hold|put on hold)$/;

/** The state name for what the user said, valid for this type. */
export function resolveState(ctx: BoardContext, type: string, input: string): string | null {
  const info: TypeInfo | undefined = ctx.types[type];
  if (!info) return null;
  const states = info.states.filter((s) => s.category !== "Removed" || categoryFor(input) === "Removed");
  const exact = info.states.find((s) => norm(s.name) === norm(input));
  if (exact) return exact.name;

  // Custom states like "In Review" or "On Hold": match on the words in their names.
  const said = keyWords(input);
  const byWords =
    states.find((s) => keyWords(s.name).length > 0 && keyWords(s.name).every((w) => said.includes(w))) ??
    states.find((s) => said.length > 0 && said.every((w) => keyWords(s.name).includes(w)));
  if (byWords) return byWords.name;
  if (HOLD.test(norm(input))) {
    const hold = states.find((s) => /hold|block|pause|wait/i.test(s.name));
    if (hold) return hold.name;
  }

  const category = categoryFor(input);
  const first = (c: StateCategory) => states.find((s) => s.category === c)?.name ?? null;
  const last = (c: StateCategory) => [...states].reverse().find((s) => s.category === c)?.name ?? null;
  // "reopen" means back to the first in-progress-or-proposed state.
  if (category === "Proposed" && /reopen|open again/.test(norm(input))) return first("InProgress") ?? first("Proposed");
  if (!category) return HOLD.test(norm(input)) ? first("InProgress") : null;
  // A process without a Resolved state but with a later in-progress stage (e.g. "In Review") uses that.
  if (category === "Resolved") {
    const inProgress = states.filter((s) => s.category === "InProgress");
    return first("Resolved") ?? (inProgress.length > 1 ? last("InProgress") : null);
  }
  return first(category);
}

export function categoryOf(ctx: BoardContext, type: string, state: string): StateCategory {
  return ctx.types[type]?.states.find((s) => s.name === state)?.category ?? "InProgress";
}

/** Every state name (across `types`, or all types) in the given categories. */
export function statesInCategories(ctx: BoardContext, categories: StateCategory[], types?: string[]): string[] {
  const infos = (types ?? Object.keys(ctx.types)).map((t) => ctx.types[t]).filter(Boolean);
  return [...new Set(infos.flatMap((i) => i.states.filter((s) => categories.includes(s.category)).map((s) => s.name)))];
}

export function validStates(ctx: BoardContext, type: string): string[] {
  return ctx.types[type]?.states.filter((s) => s.category !== "Removed").map((s) => s.name) ?? [];
}

export function currentSprint(ctx: BoardContext): Sprint | null {
  return ctx.sprints.find((s) => s.timeFrame === "current") ?? null;
}

/** "current", "next", "previous" or a sprint name/number → the sprint. */
export function resolveSprint(ctx: BoardContext, input: string): Sprint | null {
  const n = norm(input);
  const cur = currentSprint(ctx);
  const idx = cur ? ctx.sprints.indexOf(cur) : -1;
  if (/^(current|this|this sprint|current sprint|now)$/.test(n)) return cur;
  if (/^(next|next sprint|upcoming)$/.test(n)) {
    return idx >= 0 ? (ctx.sprints[idx + 1] ?? null) : (ctx.sprints.find((s) => s.timeFrame === "future") ?? null);
  }
  if (/^(previous|last|last sprint|previous sprint)$/.test(n)) {
    return idx > 0 ? ctx.sprints[idx - 1] : ([...ctx.sprints].reverse().find((s) => s.timeFrame === "past") ?? null);
  }
  return (
    ctx.sprints.find((s) => norm(s.name) === n) ??
    // "sprint 43" or just "43"
    ctx.sprints.find((s) => /\d/.test(n) && norm(s.name).endsWith(n.replace(/^sprint /, ""))) ??
    null
  );
}

export function sprintNameFor(ctx: BoardContext, iterationPath: string): string | null {
  const sprint = ctx.sprints.find((s) => s.path === iterationPath);
  if (sprint) return sprint.name;
  if (iterationPath === ctx.backlogIteration) return null;
  return iterationPath.split("\\").pop() ?? null;
}

/** Calendar days left in the sprint, counting today and its last day. */
export function daysLeft(sprint: Sprint, now = new Date()): number | null {
  if (!sprint.finishDate) return null;
  const endOfLastDay = new Date(sprint.finishDate).getTime() + 86_400_000;
  return Math.max(0, Math.ceil((endOfLastDay - now.getTime()) / 86_400_000));
}

/** A team member by (part of) their name or email, "me" for the user. */
export function resolvePerson(ctx: BoardContext, input: string): Person | null {
  const n = norm(input);
  if (/^(me|myself|i|mine)$/.test(n)) return ctx.me;
  const people = [ctx.me, ...ctx.members];
  const raw = input.trim().toLowerCase();
  return (
    people.find((p) => p.uniqueName.toLowerCase() === raw) ??
    people.find((p) => norm(p.displayName) === n) ??
    people.find((p) => norm(p.displayName).split(" ")[0] === n) ??
    people.find((p) => norm(p.displayName).includes(n)) ??
    // Unknown to the team list but clearly an email: Azure DevOps can resolve it.
    (raw.includes("@") ? { displayName: input.trim(), uniqueName: input.trim() } : null)
  );
}

const SEARCH_FILLER = new Set([
  "a", "an", "the", "in", "on", "of", "for", "to", "with", "and", "or", "my", "our", "about",
  "story", "stories", "task", "tasks", "bug", "bugs", "item", "items", "ticket", "feature", "epic", "initiative",
]);

/**
 * What the user said, reduced to the words worth matching in a title:
 * "the Entra ID sign-in story" → "entra id sign". Every remaining word must
 * appear in the title, so hyphens and filler words no longer cause misses.
 */
export function searchText(input: string): string {
  const raw = input.trim();
  if (/^#?\d+$/.test(raw)) return raw.replace("#", "");
  const words = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
  const kept = words.filter((w) => !SEARCH_FILLER.has(w));
  return (kept.length ? kept : words).join(" ");
}

/** A short description of the board for the model's instructions. */
export function summarizeBoard(ctx: BoardContext, now = new Date()): string {
  const cur = currentSprint(ctx);
  const next = cur ? ctx.sprints[ctx.sprints.indexOf(cur) + 1] : undefined;
  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "?";
  const lines = [
    `- Project ${ctx.project}, team ${ctx.team}. The user is ${ctx.me.displayName}.`,
    cur
      ? `- Current sprint: ${cur.name} (${fmt(cur.startDate)} to ${fmt(cur.finishDate)}, ${daysLeft(cur, now)} days left).${next ? ` Next sprint: ${next.name}.` : ""}`
      : "- The team has no current sprint.",
    `- Hierarchy, top to bottom: ${hierarchyLabel(ctx)}.`,
  ];
  if (ctx.bugTypes.length && ctx.bugsBehavior !== "off") {
    lines.push(`- ${ctx.bugTypes.join(", ")} items sit alongside ${ctx.bugsBehavior === "asTasks" ? "tasks" : "requirements"}.`);
  }
  const typeLines = Object.values(ctx.types).map(
    (t) => `${t.name}: ${t.states.filter((s) => s.category !== "Removed").map((s) => s.name).join(", ")}`,
  );
  lines.push(`- States by type: ${typeLines.join("; ")}.`);
  return lines.join("\n");
}
