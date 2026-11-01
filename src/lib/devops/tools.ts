import { z } from "zod";
import type { PendingAction, ToolResponse, WorkspaceEvent } from "@/types/voice";
import type { PendingActionStore } from "./pendingActions";
import {
  categoryFor,
  categoryOf,
  currentSprint,
  daysLeft,
  defaultChildType,
  levelOf,
  parentTypesFor,
  resolvePerson,
  resolveSprint,
  resolveState,
  resolveType,
  searchText,
  sprintNameFor,
  statesInCategories,
  validStates,
} from "./process";
import { WorkItemError, type WorkItemRepository } from "./repository";
import {
  OPEN_CATEGORIES,
  STATE_CATEGORIES,
  type AssigneeFilter,
  type BoardContext,
  type Person,
  type StateCategory,
  type WorkItem,
  type WorkItemPatch,
} from "./types";

/**
 * The voice tools. Arguments are what the user said ("story", "done", "next
 * sprint", "Priya"); everything is resolved here against the project's
 * process, so the model never needs to know Azure DevOps field names or the
 * project's exact state names. Writes are two-step: propose_* returns a
 * single-use action id, and only confirm_action changes the board.
 */

// ---------- argument schemas (validated on every call) ----------

const idSchema = z.coerce.number().int().positive();
const prioritySchema = z.coerce.number().int().min(1).max(4);
const word = z.string().trim().min(1).max(100);

const schemas = {
  list_work_items: z.object({
    assignee: word.optional(),
    sprint: word.optional(),
    state: word.optional(),
    type: word.optional(),
    parent_id: idSchema.optional(),
    search: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),
  get_work_item: z.object({ id: idSchema }),
  get_sprint: z.object({ which: word.optional() }),
  propose_create_work_item: z.object({
    title: z.string().trim().min(3).max(255),
    type: word.optional(),
    parent_id: idSchema.optional(),
    parent: z.string().trim().min(1).max(200).optional(),
    no_parent: z.boolean().optional(),
    sprint: word.optional(),
    assignee: word.optional(),
    priority: prioritySchema.optional(),
    description: z.string().max(4000).optional(),
    tags: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  }),
  propose_update_work_item: z.object({
    id: idSchema,
    state: word.optional(),
    title: z.string().trim().min(3).max(255).optional(),
    priority: prioritySchema.optional(),
    assignee: word.optional(),
    sprint: word.optional(),
    parent_id: idSchema.optional(),
    remove_parent: z.boolean().optional(),
    comment: z.string().trim().min(1).max(2000).optional(),
    add_tags: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  }),
  confirm_action: z.object({ action_id: z.string().min(1).max(64) }),
  cancel_action: z.object({ action_id: z.string().min(1).max(64) }),
  wait_for_user: z.object({}),
  end_session: z.object({}),
} as const;

export type ToolName = keyof typeof schemas;
export const TOOL_NAMES = Object.keys(schemas) as ToolName[];
type Args<N extends ToolName> = z.infer<(typeof schemas)[N]>;

// ---------- JSON schemas advertised to the model ----------

const str = (description: string) => ({ type: "string", description });

export const toolDefinitions = [
  {
    type: "function",
    name: "list_work_items",
    description:
      "Find work items. With no arguments: the user's open items in the current sprint. With search or parent_id, it looks across the whole board and every state unless you narrow it. Results are numbered by position so the user can say 'the second one'.",
    parameters: {
      type: "object",
      properties: {
        assignee: str("'me' (default), 'anyone', 'unassigned', or a teammate's name."),
        sprint: str("'current' (default), 'next', 'previous', 'backlog' (not in a sprint), 'any', or a sprint name."),
        state: str("'open' (default: not done), 'in progress', 'done', 'all', or an exact state name."),
        type: str("Work item type in the user's words, e.g. 'bug', 'story', 'task', 'feature', 'epic'."),
        parent_id: { type: "integer", description: "Only children of this item." },
        search: str("Words from the title, or an id."),
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Default 20." },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_work_item",
    description: "One work item in detail: description, its parents up the hierarchy, and its children (numbered by position).",
    parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false },
  },
  {
    type: "function",
    name: "get_sprint",
    description: "A sprint's dates, days left, and how the user's items in it are going.",
    parameters: {
      type: "object",
      properties: { which: str("'current' (default), 'next', 'previous', or a sprint name.") },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "propose_create_work_item",
    description:
      "Prepare (but do NOT create) a new work item and show a preview. Defaults: assigned to the user, current sprint, priority 2, the parent's area. Items below the top of the hierarchy belong under a parent: pass parent_id, or the parent's title words as parent. Without either this returns needs_parent with candidates instead. Returns an action_id; nothing is created until confirm_action.",
    parameters: {
      type: "object",
      properties: {
        title: str("Concise title, e.g. 'Add logging to payment service'."),
        type: str("In the user's words, e.g. 'task', 'bug', 'story'. Defaults to the usual child of the parent, or a task."),
        parent_id: { type: "integer", description: "The item this belongs under." },
        parent: str("When you don't know the parent's id: words from its title, as the user said them (e.g. 'observability and alerting'). Matched against every type allowed as a parent."),
        no_parent: { type: "boolean", description: "Only when the user explicitly wants no parent." },
        sprint: str("'current' (default), 'next', 'backlog', or a sprint name."),
        assignee: str("'me' (default), 'unassigned', or a teammate's name."),
        priority: { type: "integer", minimum: 1, maximum: 4, description: "1 highest, 4 lowest. Default 2." },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "propose_update_work_item",
    description:
      "Prepare (but do NOT apply) changes to a work item and show a before/after preview. Returns an action_id; nothing changes until confirm_action.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "integer" },
        state: str("In the user's words: 'done', 'in progress', 'new', 'resolved', 'removed', or an exact state."),
        title: { type: "string" },
        priority: { type: "integer", minimum: 1, maximum: 4 },
        assignee: str("'me', 'unassigned', or a teammate's name."),
        sprint: str("'current', 'next', 'previous', 'backlog', or a sprint name."),
        parent_id: { type: "integer", description: "Move under this item." },
        remove_parent: { type: "boolean", description: "Only when the user wants the item to have no parent." },
        comment: str("Added to the item's discussion."),
        add_tags: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "confirm_action",
    description:
      "Execute a previously proposed action. Only call this after the user has explicitly said yes to that specific proposal in this conversation.",
    parameters: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "cancel_action",
    description: "Discard a previously proposed action when the user says no or changes their mind.",
    parameters: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "wait_for_user",
    description:
      "Stay silent and keep listening. Call this when the latest audio is a cough, sneeze, breath, background noise, " +
      "speech not addressed to you, or an unfinished sentence the user is still in the middle of.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "end_session",
    description:
      "Hang up the voice session. Call this after a brief goodbye when the user says they are done or asks to close the session.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

// ---------- execution ----------

export interface ToolDeps {
  board: WorkItemRepository;
  actions: PendingActionStore;
  /** The signed-in user; pending confirmations belong to them. */
  userKey: string;
}

/**
 * Some models fill every optional argument with an empty value ("", 0, null,
 * []) meaning "not set". Treat those as absent so they don't become filters
 * like "children of item 0".
 */
export function dropEmptyArgs(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      ([key, v]) =>
        v !== null &&
        v !== "" &&
        !(Array.isArray(v) && v.length === 0) &&
        !(typeof v === "string" && v.trim() === "") &&
        !(v === 0 && /(^|_)id$/.test(key)),
    ),
  );
}

export async function executeTool(name: string, rawArgs: unknown, deps: ToolDeps): Promise<ToolResponse> {
  if (!(name in schemas)) return fail(`Unknown tool "${name}".`);
  const parsed = schemas[name as ToolName].safeParse(dropEmptyArgs(rawArgs ?? {}));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ");
    return { output: { ok: false, error: `Invalid arguments: ${issues}` }, uiEvents: [] };
  }

  const started = performance.now();
  try {
    switch (name as ToolName) {
      case "list_work_items":
        return await listWorkItems(parsed.data as Args<"list_work_items">, deps);
      case "get_work_item":
        return await getWorkItem(parsed.data as Args<"get_work_item">, deps);
      case "get_sprint":
        return await getSprint(parsed.data as Args<"get_sprint">, deps);
      case "propose_create_work_item":
        return await proposeCreate(parsed.data as Args<"propose_create_work_item">, deps);
      case "propose_update_work_item":
        return await proposeUpdate(parsed.data as Args<"propose_update_work_item">, deps);
      case "confirm_action":
        return await confirmAction((parsed.data as Args<"confirm_action">).action_id, deps);
      case "cancel_action":
        return cancelAction((parsed.data as Args<"cancel_action">).action_id, deps);
      case "wait_for_user":
      case "end_session":
        // Handled in the browser; nothing to do on the board.
        return { output: { ok: true }, uiEvents: [] };
    }
  } catch (err) {
    if (err instanceof WorkItemError) return fail(err.message, { code: err.code });
    console.error(`[tool:${name}]`, err);
    return fail("Something went wrong talking to the board.");
  } finally {
    console.info(`[tool] ${name} ${Math.round(performance.now() - started)}ms`);
  }
}

// ---------- helpers ----------

/** Compact shape for the model: keeps tokens (and latency) down. */
function brief(item: WorkItem, position?: number) {
  return {
    ...(position !== undefined && { position }),
    id: item.id,
    title: item.title,
    type: item.type,
    state: item.state,
    assigned_to: item.assignedTo?.displayName ?? null,
    sprint: item.sprintName ?? "backlog",
    parent: item.parentId ? `#${item.parentId} ${item.parentTitle ?? ""}`.trim() : null,
    priority: item.priority,
  };
}

function fail(message: string, extra: Record<string, unknown> = {}): ToolResponse {
  return { output: { ok: false, error: message, ...extra }, uiEvents: [{ type: "error", message }] };
}

/** Thrown inside handlers for a user-facing problem with what was asked. */
class Unresolved extends Error {
  constructor(
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function typeFor(ctx: BoardContext, input: string): string {
  const type = resolveType(ctx, input);
  if (!type) throw new Unresolved(`"${input}" isn't a work item type here.`, { types: Object.keys(ctx.types) });
  return type;
}

function sprintPath(ctx: BoardContext, input: string): string {
  if (/^backlog$/i.test(input.trim())) return ctx.backlogIteration;
  const sprint = resolveSprint(ctx, input);
  if (!sprint) throw new Unresolved(`I couldn't find the sprint "${input}".`, { sprints: ctx.sprints.map((s) => s.name) });
  return sprint.path;
}

function personFor(ctx: BoardContext, input: string): Person | null {
  if (/^(nobody|no one|none|unassigned|unassign)$/i.test(input.trim())) return null;
  const person = resolvePerson(ctx, input);
  if (!person) {
    throw new Unresolved(`I couldn't find "${input}" on the team.`, { team: [ctx.me, ...ctx.members].map((p) => p.displayName) });
  }
  return person;
}

function assigneeFilter(ctx: BoardContext, input: string): AssigneeFilter {
  const n = input.trim().toLowerCase();
  if (/^(me|mine|my|myself)$/.test(n)) return { kind: "me" };
  if (/^(anyone|anybody|everyone|all|team|any)$/.test(n)) return { kind: "anyone" };
  const person = personFor(ctx, input);
  return person ? { kind: "person", person } : { kind: "unassigned" };
}

/** "open", "done", "all" or an exact state name → the state names to match. */
function statesFor(ctx: BoardContext, input: string, types?: string[]): string[] {
  const n = input.trim().toLowerCase();
  if (/^(open|not done|remaining|todo|outstanding|pending)$/.test(n)) return statesInCategories(ctx, OPEN_CATEGORIES, types);
  if (/^(all|any)$/.test(n)) return statesInCategories(ctx, STATE_CATEGORIES.filter((c) => c !== "Removed"), types);
  const exact = Object.values(ctx.types).flatMap((t) => t.states).find((s) => s.name.toLowerCase() === n);
  if (exact) return [exact.name];
  const category = categoryFor(input);
  if (category) return statesInCategories(ctx, [category], types);
  throw new Unresolved(`"${input}" isn't a state here.`, {
    states: [...new Set(Object.values(ctx.types).flatMap((t) => t.states.map((s) => s.name)))],
  });
}

function withUnresolved<T>(fn: () => Promise<T>): Promise<T | ToolResponse> {
  return fn().catch((err: unknown) => {
    if (err instanceof Unresolved) return fail(err.message, err.extra);
    throw err;
  });
}

// ---------- reads ----------

async function listWorkItems(args: Args<"list_work_items">, { board }: ToolDeps): Promise<ToolResponse> {
  return withUnresolved(async () => {
    const ctx = await board.context();
    const types = args.type ? [typeFor(ctx, args.type)] : undefined;
    // A search, a parent or a portfolio type (epics, initiatives…, which sit on the backlog
    // and often belong to nobody) means "find this", so don't silently limit it to my sprint.
    const portfolio = !!types && levelOf(ctx, types[0])?.kind === "portfolio";
    const scoped = !!args.search || args.parent_id !== undefined || portfolio;
    const assignee = assigneeFilter(ctx, args.assignee ?? (scoped ? "anyone" : "me"));
    const sprintArg = args.sprint ?? (scoped ? "any" : "current");
    let iteration: string | undefined;
    let sprintLabel: string | null = null;
    if (!/^(any|all)$/i.test(sprintArg)) {
      if (/^(current|this)( sprint)?$/i.test(sprintArg) && !currentSprint(ctx)) {
        sprintLabel = null; // the team has no current sprint: show everything instead of nothing
      } else {
        iteration = sprintPath(ctx, sprintArg);
        sprintLabel = iteration === ctx.backlogIteration ? "backlog" : sprintNameFor(ctx, iteration);
      }
    }
    const states = statesFor(ctx, args.state ?? (scoped ? "all" : "open"), types);

    let items = await board.query({
      assignee,
      iteration: iteration === ctx.backlogIteration ? "backlog" : iteration,
      types,
      states,
      parentId: args.parent_id,
      text: args.search ? searchText(args.search) : undefined,
      top: args.limit ?? 20,
    });
    // The model often guesses the type ("feature" for an initiative): the title is what counts.
    let otherTypes = false;
    if (items.length === 0 && types && args.search) {
      items = await board.query({
        assignee,
        iteration: iteration === ctx.backlogIteration ? "backlog" : iteration,
        states: statesFor(ctx, args.state ?? "all"),
        parentId: args.parent_id,
        text: searchText(args.search),
        top: args.limit ?? 20,
      });
      otherTypes = items.length > 0;
    }

    const who =
      assignee.kind === "me" ? "Your" : assignee.kind === "person" ? `${assignee.person.displayName}'s` : assignee.kind === "unassigned" ? "Unassigned" : "All";
    const what = types && !otherTypes ? `${types[0].toLowerCase()} items` : "items";
    const title = [
      `${who} ${args.state ?? (scoped ? "" : "open")} ${what}`.replace(/\s+/g, " "),
      sprintLabel ? `· ${sprintLabel === "backlog" ? "backlog" : sprintLabel}` : "",
      args.parent_id ? `· under #${args.parent_id}` : "",
      args.search ? `· matching “${args.search}”` : "",
    ]
      .filter(Boolean)
      .join(" ");

    return {
      output: {
        ok: true,
        count: items.length,
        ...(sprintLabel && { sprint: sprintLabel }),
        items: items.map((item, i) => brief(item, i + 1)),
        ...(otherTypes && { note: `No ${types![0]} matched; these are other types with that title.` }),
        ...(items.length === 0 && !scoped && { hint: "Nothing matched. Try sprint 'any' or assignee 'anyone'." }),
      },
      uiEvents: [{ type: "work_items_loaded", title, items }],
    };
  });
}

async function getWorkItem({ id }: Args<"get_work_item">, { board }: ToolDeps): Promise<ToolResponse> {
  const detail = await board.getDetail(id);
  if (!detail) return fail(`Work item #${id} does not exist.`);
  const { ancestors, children, ...item } = detail;
  const uiEvents: WorkspaceEvent[] = children.length
    ? [{ type: "work_items_loaded", title: `Under ${item.type} #${item.id} · ${item.title}`, items: children }]
    : [{ type: "work_item_focused", item }];
  return {
    output: {
      ok: true,
      item: {
        ...brief(item),
        description: item.description.slice(0, 600),
        area: item.areaPath,
        tags: item.tags,
        parents: ancestors.map((a) => `${a.type} #${a.id} ${a.title} (${a.state})`),
      },
      children: children.map((c, i) => brief(c, i + 1)),
    },
    uiEvents,
  };
}

const CATEGORY_LABEL: Record<StateCategory, string> = {
  Proposed: "not_started",
  InProgress: "in_progress",
  Resolved: "resolved",
  Completed: "done",
  Removed: "removed",
};

async function getSprint(args: Args<"get_sprint">, { board }: ToolDeps): Promise<ToolResponse> {
  return withUnresolved(async () => {
    const ctx = await board.context();
    const sprint = resolveSprint(ctx, args.which ?? "current");
    if (!sprint) {
      return fail(args.which ? `I couldn't find the sprint "${args.which}".` : "The team has no current sprint.", {
        sprints: ctx.sprints.map((s) => s.name),
      });
    }
    const items = await board.query({
      assignee: { kind: "me" },
      iteration: sprint.path,
      states: statesInCategories(ctx, STATE_CATEGORIES.filter((c) => c !== "Removed")),
      top: 100,
    });
    const counts: Record<string, number> = { not_started: 0, in_progress: 0, resolved: 0, done: 0 };
    for (const i of items) counts[CATEGORY_LABEL[i.stateCategory]] = (counts[CATEGORY_LABEL[i.stateCategory]] ?? 0) + 1;
    return {
      output: {
        ok: true,
        sprint: sprint.name,
        start: sprint.startDate?.slice(0, 10) ?? null,
        finish: sprint.finishDate?.slice(0, 10) ?? null,
        days_left: sprint.timeFrame === "past" ? 0 : daysLeft(sprint),
        my_items: { total: items.length, ...counts },
      },
      uiEvents: [{ type: "work_items_loaded", title: `Your work in ${sprint.name}`, items }],
    };
  });
}

// ---------- proposals ----------

async function proposeCreate(args: Args<"propose_create_work_item">, { board, actions, userKey }: ToolDeps): Promise<ToolResponse> {
  return withUnresolved(async () => {
    const ctx = await board.context();
    let parent = args.parent_id ? await board.get(args.parent_id) : null;
    if (args.parent_id && !parent) return fail(`Work item #${args.parent_id} does not exist.`);

    const typeArg = args.type
      ? typeFor(ctx, args.type)
      : ((parent && defaultChildType(ctx, parent.type)) ?? null);
    if (!parent && args.parent && !args.parent_id) {
      const found = await findParent(ctx, board, args.parent, typeArg);
      if ("response" in found) return found.response;
      parent = found.parent;
    }
    const type =
      typeArg ??
      (parent && defaultChildType(ctx, parent.type)) ??
      ctx.hierarchy.find((l) => l.kind === "task")?.defaultType ??
      Object.keys(ctx.types)[0];
    const level = levelOf(ctx, type);
    const parentTypes = parentTypesFor(ctx, type);

    if (parent && parentTypes.length && !parentTypes.includes(parent.type)) {
      return fail(`A ${type} can't go under ${parent.type} #${parent.id}; it belongs under a ${parentTypes.join(" or ")}.`, {
        parent_types: parentTypes,
      });
    }
    if (!parent && parentTypes.length && !args.no_parent) {
      return needsParent(ctx, board, type, parentTypes);
    }

    // Tasks follow their parent's sprint; requirements and bugs go in the current sprint; portfolio items stay on the backlog.
    // ...but never into a sprint that has already finished.
    const parentSprint =
      parent && ctx.sprints.some((s) => s.path === parent.iterationPath && s.timeFrame !== "past") ? parent.iterationPath : null;
    const iterationPath = args.sprint
      ? sprintPath(ctx, args.sprint)
      : level?.kind === "portfolio"
        ? ctx.backlogIteration
        : (level?.kind === "task" && parentSprint) || (currentSprint(ctx)?.path ?? ctx.backlogIteration);
    const assignedTo = args.assignee ? personFor(ctx, args.assignee) : level?.kind === "portfolio" ? null : ctx.me;
    const input = {
      type,
      title: args.title,
      description: args.description,
      priority: args.priority ?? 2,
      assignedTo,
      iterationPath,
      areaPath: parent?.areaPath ?? ctx.defaultArea,
      parentId: parent?.id ?? null,
      tags: args.tags,
    };
    const { actionId, expiresAt } = actions.add({ kind: "create", input, parentTitle: parent?.title ?? null }, userKey);

    const now = new Date().toISOString();
    const firstState = ctx.types[type]?.states[0]?.name ?? "New";
    const draft: WorkItem = {
      id: 0,
      title: input.title,
      type,
      state: firstState,
      stateCategory: categoryOf(ctx, type, firstState),
      priority: input.priority,
      assignedTo,
      description: input.description ?? "",
      areaPath: input.areaPath,
      iterationPath,
      sprintName: sprintNameFor(ctx, iterationPath),
      parentId: input.parentId,
      parentTitle: parent?.title ?? null,
      tags: input.tags ?? [],
      url: null,
      createdAt: now,
      changedAt: now,
      rev: 0,
    };
    const where = [
      parent ? `under ${parent.type} #${parent.id} “${parent.title}”` : null,
      `in ${draft.sprintName ?? "the backlog"}`,
      `assigned to ${assignedTo?.displayName ?? "nobody"}`,
      `priority ${input.priority}`,
    ]
      .filter(Boolean)
      .join(", ");
    const message = `Create ${type} “${input.title}” ${where}?`;
    const pending: PendingAction = { actionId, kind: "create", message, after: draft, expiresAt: new Date(expiresAt).toISOString() };
    return {
      output: {
        ok: true,
        action_id: actionId,
        status: "awaiting_user_confirmation",
        summary: message,
        defaults_applied: {
          ...(!args.type && { type }),
          ...(!args.sprint && { sprint: draft.sprintName ?? "backlog" }),
          ...(!args.assignee && { assignee: assignedTo?.displayName ?? "nobody" }),
          ...(args.priority === undefined && { priority: input.priority }),
        },
        instruction: "Read the summary back briefly, mentioning the defaults, and ask the user to confirm. Do not call confirm_action until they say yes.",
      },
      uiEvents: [{ type: "work_item_preview", action: pending }],
    };
  });
}

/** Offers likely parents (the user's open ones in this sprint first) instead of creating an orphan. */
async function needsParent(ctx: BoardContext, board: WorkItemRepository, type: string, parentTypes: string[]): Promise<ToolResponse> {
  const open = statesInCategories(ctx, OPEN_CATEGORIES, parentTypes);
  // Requirement-level parents live in sprints; portfolio parents (features, initiatives…) on the backlog.
  const parentLevel = levelOf(ctx, parentTypes[0]);
  const sprint = parentLevel?.kind === "portfolio" ? undefined : currentSprint(ctx)?.path;
  const mine = await board.query({ assignee: { kind: "me" }, iteration: sprint, types: parentTypes, states: open, top: 10 });
  const others = mine.length >= 10 ? [] : await board.query({ iteration: sprint, types: parentTypes, states: open, top: 10 });
  const candidates = [...mine, ...others.filter((o) => !mine.some((m) => m.id === o.id))].slice(0, 10);
  return {
    output: {
      ok: false,
      needs_parent: true,
      type,
      parent_types: parentTypes,
      candidates: candidates.map((c, i) => brief(c, i + 1)),
      instruction: `Ask which ${parentTypes.join(" or ")} this ${type} belongs under, naming two or three of the candidates. Then propose again with parent_id, or with parent set to the title words the user says. Only if the user says it has no parent, propose again with no_parent: true.`,
    },
    uiEvents: candidates.length ? [{ type: "work_items_loaded", title: `Which ${parentTypes[0].toLowerCase()} does it go under?`, items: candidates }] : [],
  };
}

/**
 * The parent the user named in words. Searches every type allowed above the
 * new item (an "initiative" the model calls a "feature" still matches), and
 * says plainly when the title only matches an item at the wrong level.
 */
const an = (word: string) => `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;

async function findParent(
  ctx: BoardContext,
  board: WorkItemRepository,
  words: string,
  childType: string | null,
): Promise<{ parent: WorkItem } | { response: ToolResponse }> {
  const allowed = childType ? parentTypesFor(ctx, childType) : [];
  const text = searchText(words);
  const all = statesInCategories(ctx, STATE_CATEGORIES.filter((c) => c !== "Removed"));
  const matches = await board.query({ text, types: allowed.length ? allowed : undefined, states: all, top: 10 });
  const exact = matches.filter((m) => searchText(m.title) === text);
  if (matches.length === 1 || exact.length === 1) return { parent: exact[0] ?? matches[0] };
  if (matches.length > 1) {
    return {
      response: {
        output: {
          ok: false,
          needs_parent: true,
          parent_types: allowed,
          candidates: matches.map((c, i) => brief(c, i + 1)),
          instruction: "Several items match. Ask which one, naming them briefly, then propose again with its parent_id.",
        },
        uiEvents: [{ type: "work_items_loaded", title: `Matching “${words}”`, items: matches }],
      },
    };
  }
  const elsewhere = allowed.length ? await board.query({ text, states: all, top: 5 }) : [];
  if (elsewhere.length) {
    return {
      response: fail(
        `Nothing that a ${childType} can go under matches “${words}”. ${elsewhere
          .map((e) => `#${e.id} “${e.title}” is ${an(e.type)}`)
          .join("; ")}, and ${an(childType!)} belongs under ${an(allowed.join(" or "))}.`,
        { parent_types: allowed, other_matches: elsewhere.map((e, i) => brief(e, i + 1)) },
      ),
    };
  }
  return { response: fail(`Nothing on the board matches “${words}”.`, { parent_types: allowed }) };
}

async function proposeUpdate(args: Args<"propose_update_work_item">, { board, actions, userKey }: ToolDeps): Promise<ToolResponse> {
  return withUnresolved(async () => {
    const ctx = await board.context();
    const before = await board.get(args.id);
    if (!before) return fail(`Work item #${args.id} does not exist.`);

    const changes: WorkItemPatch = {};
    if (args.state !== undefined) {
      const state = resolveState(ctx, before.type, args.state);
      if (!state) return fail(`A ${before.type} can't be "${args.state}".`, { valid_states: validStates(ctx, before.type) });
      if (state === before.state) return fail(`#${before.id} is already ${before.state}.`, { code: "invalid_transition" });
      changes.state = state;
    }
    if (args.title !== undefined && args.title !== before.title) changes.title = args.title;
    if (args.priority !== undefined && args.priority !== before.priority) changes.priority = args.priority;
    if (args.assignee !== undefined) {
      const person = personFor(ctx, args.assignee);
      if (person?.uniqueName !== before.assignedTo?.uniqueName) changes.assignedTo = person;
    }
    if (args.sprint !== undefined) {
      const path = sprintPath(ctx, args.sprint);
      if (path !== before.iterationPath) changes.iterationPath = path;
    }
    let parentTitle = before.parentTitle;
    if (args.remove_parent && before.parentId !== null) {
      changes.parentId = null;
      parentTitle = null;
    } else if (args.parent_id !== undefined && args.parent_id !== before.parentId) {
      const parent = await board.get(args.parent_id);
      if (!parent) return fail(`Work item #${args.parent_id} does not exist.`);
      const allowed = parentTypesFor(ctx, before.type);
      if (allowed.length && !allowed.includes(parent.type)) {
        return fail(`A ${before.type} can't go under ${parent.type} #${parent.id}; it belongs under a ${allowed.join(" or ")}.`);
      }
      parentTitle = parent.title;
      changes.parentId = args.parent_id;
    }
    if (args.comment) changes.comment = args.comment;
    if (args.add_tags?.length) changes.addTags = args.add_tags;
    if (Object.keys(changes).length === 0) return fail(`Nothing would change on #${before.id}.`);

    const { actionId, expiresAt } = actions.add({ kind: "update", id: before.id, rev: before.rev, changes, parentTitle }, userKey);
    const after: WorkItem = {
      ...before,
      ...(changes.title !== undefined && { title: changes.title }),
      ...(changes.state !== undefined && { state: changes.state, stateCategory: categoryOf(ctx, before.type, changes.state) }),
      ...(changes.priority !== undefined && { priority: changes.priority }),
      ...(changes.assignedTo !== undefined && { assignedTo: changes.assignedTo }),
      ...(changes.iterationPath !== undefined && { iterationPath: changes.iterationPath, sprintName: sprintNameFor(ctx, changes.iterationPath) }),
      ...(changes.parentId !== undefined && { parentId: changes.parentId, parentTitle }),
      ...(changes.addTags && { tags: [...new Set([...before.tags, ...changes.addTags])] }),
    };
    const message = `Update #${before.id} “${before.title}”: ${describeChanges(before, after, changes)}?`;
    const pending: PendingAction = { actionId, kind: "update", message, before, after, changes, expiresAt: new Date(expiresAt).toISOString() };
    return {
      output: {
        ok: true,
        action_id: actionId,
        status: "awaiting_user_confirmation",
        summary: message,
        instruction: "Ask the user to confirm this change. Do not call confirm_action until they say yes.",
      },
      uiEvents: [{ type: "work_item_preview", action: pending }],
    };
  });
}

function describeChanges(before: WorkItem, after: WorkItem, changes: WorkItemPatch) {
  const parts: string[] = [];
  if (changes.state) parts.push(`${before.state} → ${after.state}`);
  if (changes.iterationPath !== undefined) parts.push(`${before.sprintName ?? "backlog"} → ${after.sprintName ?? "backlog"}`);
  if (changes.assignedTo !== undefined) parts.push(`assign to ${after.assignedTo?.displayName ?? "nobody"}`);
  if (changes.priority !== undefined) parts.push(`priority ${before.priority ?? "none"} → ${after.priority}`);
  if (changes.title) parts.push(`rename to “${after.title}”`);
  if (changes.parentId !== undefined) parts.push(after.parentId ? `move under #${after.parentId} ${after.parentTitle ?? ""}`.trim() : "remove its parent");
  if (changes.addTags) parts.push(`tag ${changes.addTags.join(", ")}`);
  if (changes.comment) parts.push(`add a comment`);
  return parts.join(", ");
}

// ---------- confirmation ----------

async function confirmAction(actionId: string, { board, actions, userKey }: ToolDeps): Promise<ToolResponse> {
  const taken = actions.take(actionId, userKey);
  if (!taken.ok) {
    const message =
      taken.reason === "expired"
        ? "That confirmation expired. Propose the change again."
        : "There's no pending action with that id. It may already be done or cancelled.";
    return {
      output: { ok: false, error: message },
      uiEvents: [
        ...(taken.reason === "expired" ? [{ type: "confirmation_resolved", actionId, outcome: "expired" } as const] : []),
        { type: "error", message },
      ],
    };
  }

  const { op } = taken;
  const events: WorkspaceEvent[] = [{ type: "confirmation_resolved", actionId, outcome: "confirmed" }];

  if (op.kind === "create") {
    const item = await board.create(op.input);
    const created = { ...item, parentTitle: item.parentTitle ?? op.parentTitle };
    events.push({ type: "work_item_created", item: created });
    return { output: { ok: true, created: brief(created) }, uiEvents: events };
  }

  const before = await board.get(op.id);
  if (!before) return fail(`Work item #${op.id} no longer exists.`);
  try {
    const item = await board.update(op.id, op.changes, op.rev);
    const updated = {
      ...item,
      parentTitle: op.changes.parentId !== undefined ? (op.parentTitle ?? null) : (item.parentTitle ?? before.parentTitle),
    };
    events.push({ type: "work_item_updated", item: updated, before });
    return { output: { ok: true, updated: brief(updated) }, uiEvents: events };
  } catch (err) {
    if (err instanceof WorkItemError && err.code === "conflict") {
      return fail(`#${op.id} was changed by someone else since the preview. Look it up again and re-propose.`, { code: "conflict" });
    }
    throw err;
  }
}

function cancelAction(actionId: string, { actions, userKey }: ToolDeps): ToolResponse {
  const taken = actions.take(actionId, userKey);
  return {
    output: { ok: true, cancelled: taken.ok },
    uiEvents: [{ type: "confirmation_resolved", actionId, outcome: "cancelled" }],
  };
}
