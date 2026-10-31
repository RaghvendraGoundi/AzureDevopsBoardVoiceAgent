import { categoryOf, sprintNameFor } from "../process";
import { WorkItemError, type WorkItemRepository } from "../repository";
import type {
  BoardContext,
  CreateWorkItemInput,
  Person,
  WorkItem,
  WorkItemDetail,
  WorkItemPatch,
  WorkItemQuery,
  WorkItemRef,
} from "../types";
import type { AdoClient } from "./client";

/**
 * WorkItemRepository on the Azure DevOps REST API (7.1).
 *
 * Round trips are kept to a minimum: a query is one WIQL call plus one
 * batch read (and one more only for parent titles not already in the
 * result); a create or update is a single JSON Patch request.
 */

/** Fields read for lists. The description is only read for single items. */
export const LIST_FIELDS = [
  "System.Id",
  "System.Title",
  "System.WorkItemType",
  "System.State",
  "System.AssignedTo",
  "System.IterationPath",
  "System.AreaPath",
  "System.Parent",
  "System.Tags",
  "System.CreatedDate",
  "System.ChangedDate",
  "System.Rev",
  "Microsoft.VSTS.Common.Priority",
];

const PARENT_REL = "System.LinkTypes.Hierarchy-Reverse";
const CHILD_REL = "System.LinkTypes.Hierarchy-Forward";
const BATCH_LIMIT = 200;

interface WorkItemDto {
  id: number;
  rev?: number;
  fields: Record<string, unknown>;
  relations?: Array<{ rel: string; url: string }>;
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The WIQL for a query. Team-scoped, so @Me and team sprints resolve. */
export function buildWiql(q: WorkItemQuery, ctx: BoardContext): string {
  const where = ["[System.TeamProject] = @project"];
  const a = q.assignee;
  if (a?.kind === "me") where.push("[System.AssignedTo] = @Me");
  else if (a?.kind === "person") where.push(`[System.AssignedTo] = ${quote(a.person.uniqueName)}`);
  else if (a?.kind === "unassigned") where.push("[System.AssignedTo] = ''");
  if (q.iteration === "backlog") where.push(`[System.IterationPath] = ${quote(ctx.backlogIteration)}`);
  else if (q.iteration) where.push(`[System.IterationPath] UNDER ${quote(q.iteration)}`);
  if (q.types?.length) where.push(`[System.WorkItemType] IN (${q.types.map(quote).join(", ")})`);
  if (q.states?.length) where.push(`[System.State] IN (${q.states.map(quote).join(", ")})`);
  if (q.parentId !== undefined) where.push(`[System.Parent] = ${q.parentId}`);
  const text = q.text?.trim();
  if (text) {
    if (/^\d+$/.test(text)) where.push(`[System.Id] = ${text}`);
    else for (const word of text.split(/\s+/).slice(0, 6)) where.push(`[System.Title] CONTAINS ${quote(word)}`);
  }
  return `SELECT [System.Id] FROM WorkItems WHERE ${where.join(" AND ")} ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.ChangedDate] DESC`;
}

/** Description HTML → short plain text for speaking. */
export function htmlToText(html: unknown, max = 1000): string {
  if (typeof html !== "string") return "";
  const text = html
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function person(v: unknown): Person | null {
  if (!v || typeof v !== "object") return null;
  const p = v as { displayName?: string; uniqueName?: string; id?: string };
  if (!p.uniqueName && !p.displayName) return null;
  return { displayName: p.displayName ?? p.uniqueName!, uniqueName: p.uniqueName ?? p.displayName!, id: p.id };
}

const idFromUrl = (url: string) => Number(url.split("/").pop());

export class AzureDevOpsBoard implements WorkItemRepository {
  constructor(
    private readonly client: AdoClient,
    private readonly loadContext: () => Promise<BoardContext>,
  ) {}

  context() {
    return this.loadContext();
  }

  toWorkItem(dto: WorkItemDto, ctx: BoardContext, parentTitles = new Map<number, string>()): WorkItem {
    const f = dto.fields;
    const type = String(f["System.WorkItemType"] ?? "");
    const state = String(f["System.State"] ?? "");
    const iterationPath = String(f["System.IterationPath"] ?? "");
    const parentId = typeof f["System.Parent"] === "number" ? (f["System.Parent"] as number) : null;
    const priority = f["Microsoft.VSTS.Common.Priority"];
    return {
      id: dto.id,
      title: String(f["System.Title"] ?? ""),
      type,
      state,
      stateCategory: categoryOf(ctx, type, state),
      priority: typeof priority === "number" ? priority : null,
      assignedTo: person(f["System.AssignedTo"]),
      description: htmlToText(f["System.Description"]),
      areaPath: String(f["System.AreaPath"] ?? ""),
      iterationPath,
      sprintName: sprintNameFor(ctx, iterationPath),
      parentId,
      parentTitle: parentId ? (parentTitles.get(parentId) ?? null) : null,
      tags: typeof f["System.Tags"] === "string" ? (f["System.Tags"] as string).split(";").map((t) => t.trim()).filter(Boolean) : [],
      url: this.client.itemUrl(dto.id),
      createdAt: String(f["System.CreatedDate"] ?? ""),
      changedAt: String(f["System.ChangedDate"] ?? ""),
      rev: Number(f["System.Rev"] ?? dto.rev ?? 0),
    };
  }

  /** Reads items by id (in chunks of 200), keeping the requested order. */
  private async batch(ids: number[], fields: string[]): Promise<WorkItemDto[]> {
    if (ids.length === 0) return [];
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += BATCH_LIMIT) chunks.push(ids.slice(i, i + BATCH_LIMIT));
    const results = await Promise.all(
      chunks.map((chunk) =>
        this.client.request<{ value: WorkItemDto[] }>("POST", `${this.client.projectUrl}/_apis/wit/workitemsbatch`, {
          body: { ids: chunk, fields, errorPolicy: "omit" },
        }),
      ),
    );
    const byId = new Map(results.flatMap((r) => r.value.filter(Boolean)).map((d) => [d.id, d]));
    return ids.map((id) => byId.get(id)).filter((d): d is WorkItemDto => !!d);
  }

  /** Titles of parents that aren't already among `dtos`. */
  private async parentTitles(dtos: WorkItemDto[]): Promise<Map<number, string>> {
    const titles = new Map(dtos.map((d) => [d.id, String(d.fields["System.Title"] ?? "")]));
    const missing = [...new Set(dtos.map((d) => d.fields["System.Parent"]).filter((p): p is number => typeof p === "number" && !titles.has(p)))];
    for (const d of await this.batch(missing, ["System.Id", "System.Title"])) titles.set(d.id, String(d.fields["System.Title"] ?? ""));
    return titles;
  }

  async query(q: WorkItemQuery): Promise<WorkItem[]> {
    const ctx = await this.context();
    const res = await this.client.request<{ workItems: Array<{ id: number }> }>("POST", `${this.client.teamUrl}/_apis/wit/wiql`, {
      body: { query: buildWiql(q, ctx) },
      query: { $top: q.top ?? 50 },
    });
    const dtos = await this.batch(res.workItems.map((w) => w.id), LIST_FIELDS);
    const titles = await this.parentTitles(dtos);
    return dtos.map((d) => this.toWorkItem(d, ctx, titles));
  }

  async get(id: number): Promise<WorkItem | null> {
    const [ctx, [dto]] = await Promise.all([this.context(), this.batch([id], [...LIST_FIELDS, "System.Description"])]);
    if (!dto) return null;
    return this.toWorkItem(dto, ctx, await this.parentTitles([dto]));
  }

  private async getWithRelations(id: number): Promise<WorkItemDto | null> {
    try {
      return await this.client.request<WorkItemDto>("GET", `${this.client.projectUrl}/_apis/wit/workitems/${id}`, {
        query: { $expand: "relations" },
      });
    } catch (err) {
      if (err instanceof WorkItemError && err.code === "not_found") return null;
      throw err;
    }
  }

  async getDetail(id: number): Promise<WorkItemDetail | null> {
    const [ctx, dto] = await Promise.all([this.context(), this.getWithRelations(id)]);
    if (!dto) return null;
    const childIds = (dto.relations ?? []).filter((r) => r.rel === CHILD_REL).map((r) => idFromUrl(r.url));
    const [children, ancestors] = await Promise.all([this.batch(childIds, LIST_FIELDS), this.ancestors(dto)]);
    const titles = new Map<number, string>([[dto.id, String(dto.fields["System.Title"] ?? "")]]);
    for (const a of ancestors) titles.set(a.id, a.title);
    return {
      ...this.toWorkItem(dto, ctx, titles),
      ancestors,
      children: children.map((c) => this.toWorkItem(c, ctx, titles)),
    };
  }

  /** Parent, grandparent, … up to the top (at most five levels). */
  private async ancestors(dto: WorkItemDto): Promise<WorkItemRef[]> {
    const chain: WorkItemRef[] = [];
    let parentId = dto.fields["System.Parent"];
    while (typeof parentId === "number" && chain.length < 5) {
      const [p] = await this.batch([parentId], ["System.Id", "System.Title", "System.WorkItemType", "System.State", "System.Parent"]);
      if (!p) break;
      chain.push({
        id: p.id,
        title: String(p.fields["System.Title"] ?? ""),
        type: String(p.fields["System.WorkItemType"] ?? ""),
        state: String(p.fields["System.State"] ?? ""),
      });
      parentId = p.fields["System.Parent"];
    }
    return chain;
  }

  async create(input: CreateWorkItemInput): Promise<WorkItem> {
    const ops: unknown[] = [
      { op: "add", path: "/fields/System.Title", value: input.title.trim() },
      { op: "add", path: "/fields/System.IterationPath", value: input.iterationPath },
      { op: "add", path: "/fields/System.AreaPath", value: input.areaPath },
    ];
    if (input.description) ops.push({ op: "add", path: "/fields/System.Description", value: input.description });
    if (input.priority != null) ops.push({ op: "add", path: "/fields/Microsoft.VSTS.Common.Priority", value: input.priority });
    if (input.assignedTo) ops.push({ op: "add", path: "/fields/System.AssignedTo", value: input.assignedTo.uniqueName });
    if (input.tags?.length) ops.push({ op: "add", path: "/fields/System.Tags", value: input.tags.join("; ") });
    if (input.parentId) {
      ops.push({ op: "add", path: "/relations/-", value: { rel: PARENT_REL, url: this.client.itemApiUrl(input.parentId) } });
    }
    const [ctx, dto] = await Promise.all([
      this.context(),
      this.client.request<WorkItemDto>("POST", `${this.client.projectUrl}/_apis/wit/workitems/$${encodeURIComponent(input.type)}`, {
        body: ops,
        contentType: "application/json-patch+json",
      }),
    ]);
    return this.toWorkItem(dto, ctx);
  }

  async update(id: number, patch: WorkItemPatch, expectedRev?: number): Promise<WorkItem> {
    const ops: unknown[] = [];
    if (expectedRev !== undefined) ops.push({ op: "test", path: "/rev", value: expectedRev });
    const set = (field: string, value: unknown) => ops.push({ op: "add", path: `/fields/${field}`, value });
    if (patch.title !== undefined) set("System.Title", patch.title.trim());
    if (patch.state !== undefined) set("System.State", patch.state);
    if (patch.priority !== undefined) set("Microsoft.VSTS.Common.Priority", patch.priority);
    if (patch.assignedTo !== undefined) set("System.AssignedTo", patch.assignedTo?.uniqueName ?? "");
    if (patch.iterationPath !== undefined) set("System.IterationPath", patch.iterationPath);
    if (patch.comment) set("System.History", patch.comment);

    // Re-parenting and adding tags need the current links and tags.
    if (patch.parentId !== undefined || patch.addTags?.length) {
      const current = await this.getWithRelations(id);
      if (!current) throw new WorkItemError(`Work item #${id} does not exist.`, "not_found");
      if (patch.addTags?.length) {
        const existing = String(current.fields["System.Tags"] ?? "").split(";").map((t) => t.trim()).filter(Boolean);
        set("System.Tags", [...new Set([...existing, ...patch.addTags])].join("; "));
      }
      if (patch.parentId !== undefined) {
        const idx = (current.relations ?? []).findIndex((r) => r.rel === PARENT_REL);
        if (idx >= 0) ops.push({ op: "remove", path: `/relations/${idx}` });
        if (patch.parentId) {
          ops.push({ op: "add", path: "/relations/-", value: { rel: PARENT_REL, url: this.client.itemApiUrl(patch.parentId) } });
        }
      }
    }

    const [ctx, dto] = await Promise.all([
      this.context(),
      this.client.request<WorkItemDto>("PATCH", `${this.client.projectUrl}/_apis/wit/workitems/${id}`, {
        body: ops,
        contentType: "application/json-patch+json",
      }),
    ]);
    return this.toWorkItem(dto, ctx);
  }
}
