import { afterEach, describe, expect, it, vi } from "vitest";
import { CachedBoard, TtlCache } from "../cache";
import { parentTypesFor, resolveState, resolveType, summarizeBoard } from "../process";
import { WorkItemError } from "../repository";
import type { BoardContext } from "../types";
import {
  AGILE_BACKLOG,
  BASIC_BACKLOG,
  CONNECTION_DATA,
  ITERATIONS,
  MEMBERS,
  MYWORK_BACKLOG,
  SCRUM_BACKLOG,
  TEAM_FIELD_VALUES,
  TEAM_SETTINGS,
} from "./__fixtures__/processes";
import { getAzureDevOpsCredential } from "./auth";
import { AzureDevOpsBoard, buildWiql, htmlToText, LIST_FIELDS } from "./board";
import { AdoClient } from "./client";
import { loadAdoContext, toItemPath } from "./context";

/** A fake Azure DevOps: routes by method + path, records every request. */
function fakeAdo(routes: Record<string, (body: unknown, url: URL) => unknown>, backlog: unknown = AGILE_BACKLOG) {
  const calls: Array<{ method: string; url: URL; body: unknown; headers: Record<string, string> }> = [];
  const all: Record<string, (body: unknown, url: URL) => unknown> = {
    "GET /_apis/connectionData": () => CONNECTION_DATA,
    "GET /Fabrikam/Fabrikam%20Team/_apis/work/backlogconfiguration": () => backlog,
    "GET /Fabrikam/Fabrikam%20Team/_apis/work/teamsettings": () => TEAM_SETTINGS,
    "GET /Fabrikam/Fabrikam%20Team/_apis/work/teamsettings/iterations": () => ITERATIONS,
    "GET /Fabrikam/Fabrikam%20Team/_apis/work/teamsettings/teamfieldvalues": () => TEAM_FIELD_VALUES,
    "GET /_apis/projects/Fabrikam/teams/Fabrikam%20Team/members": () => MEMBERS,
    ...routes,
  };
  const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body, headers: init?.headers as Record<string, string> });
    const route = all[`${method} ${url.pathname.replace(/^\/acme/, "")}`];
    if (!route) return new Response(JSON.stringify({ message: "no route" }), { status: 404 });
    const result = route(body, url);
    return result instanceof Response ? result : new Response(JSON.stringify(result), { status: 200 });
  });
  const client = new AdoClient(
    { organization: "acme", project: "Fabrikam", team: "Fabrikam Team" },
    { kind: "bearer", token: "tok", userKey: "u" },
    { fetch: fetchImpl as unknown as typeof fetch },
  );
  return { client, calls, fetchImpl };
}

const dto = (id: number, fields: Record<string, unknown>) => ({
  id,
  rev: 3,
  fields: {
    "System.Id": id,
    "System.WorkItemType": "Task",
    "System.State": "Active",
    "System.IterationPath": "Fabrikam\\Sprint 42",
    "System.Rev": 3,
    ...fields,
  },
});

afterEach(() => vi.unstubAllEnvs());

describe("process detection", () => {
  it("reads hierarchy, states, sprints, people and paths in one parallel burst", async () => {
    const { client, calls } = fakeAdo({});
    const ctx = await loadAdoContext(client);
    expect(calls).toHaveLength(6);
    expect(ctx.me).toMatchObject({ displayName: "Dana Kim", uniqueName: "dana@fabrikam.com" });
    expect(ctx.hierarchy.map((l) => [l.kind, l.defaultType])).toEqual([
      ["portfolio", "Epic"],
      ["portfolio", "Feature"],
      ["requirement", "User Story"],
      ["task", "Task"],
    ]);
    expect(ctx.sprints.map((s) => s.name)).toEqual(["Sprint 41", "Sprint 42", "Sprint 43"]);
    expect(ctx.backlogIteration).toBe("Fabrikam");
    expect(ctx.defaultArea).toBe("Fabrikam\\Web");
    expect(ctx.members.map((m) => m.displayName)).toEqual(["Luis Ortega"]);
    expect(summarizeBoard(ctx, new Date("2026-10-31T12:00:00Z"))).toMatch(/Current sprint: Sprint 42 \(Oct 26 to Nov 6, 7 days left\)/);
  });

  it.each([
    ["Agile", AGILE_BACKLOG, "story", "User Story", "done", "Closed", "Task", "in progress", "Active"],
    ["Scrum", SCRUM_BACKLOG, "story", "Product Backlog Item", "done", "Done", "Task", "in progress", "In Progress"],
    ["Basic", BASIC_BACKLOG, "story", "Issue", "completed", "Done", "Task", "doing", "Doing"],
  ])("%s: maps the user's words to the project's names", async (_, backlog, said, type, doneWord, done, task, progressWord, inProgress) => {
    const { client } = fakeAdo({}, backlog);
    const ctx = await loadAdoContext(client);
    expect(resolveType(ctx, said)).toBe(type);
    expect(resolveState(ctx, type, doneWord)).toBe(done);
    expect(resolveState(ctx, task, progressWord)).toBe(inProgress);
    expect(parentTypesFor(ctx, "Task")).toContain(type);
  });

  it("MyWork: understands Initiatives and the five-state workflow", async () => {
    const { client } = fakeAdo({}, MYWORK_BACKLOG);
    const ctx = await loadAdoContext(client);
    expect(ctx.hierarchy.map((l) => l.defaultType)).toEqual(["Epic", "Initiative", "User Story", "Task"]);
    expect(resolveType(ctx, "initiative")).toBe("Initiative");
    expect(parentTypesFor(ctx, "User Story")).toEqual(["Initiative"]);
    expect(parentTypesFor(ctx, "Task")).toEqual(["User Story", "Bug"]);
    expect(resolveState(ctx, "Task", "done")).toBe("Completed");
    expect(resolveState(ctx, "Task", "in progress")).toBe("In Progress");
    expect(resolveState(ctx, "Task", "on hold")).toBe("On Hold");
    expect(resolveState(ctx, "User Story", "review")).toBe("In Review");
    expect(resolveState(ctx, "User Story", "ready for review")).toBe("In Review");
    expect(resolveState(ctx, "User Story", "blocked")).toBe("On Hold");
    expect(resolveState(ctx, "User Story", "resolved")).toBe("In Review");
  });

  it("uses the backlog iteration's name when Azure DevOps returns an empty path for it", async () => {
    // What MyWork's team settings actually return for a project-root backlog iteration.
    const { client } = fakeAdo({
      "GET /Fabrikam/Fabrikam%20Team/_apis/work/teamsettings": () => ({ ...TEAM_SETTINGS, backlogIteration: { name: "Fabrikam", path: "" } }),
    });
    const ctx = await loadAdoContext(client);
    expect(ctx.backlogIteration).toBe("Fabrikam");
    expect(buildWiql({ iteration: "backlog" }, ctx)).toContain("[System.IterationPath] = 'Fabrikam'");
  });

  it("still works when the member list is forbidden", async () => {
    const { client } = fakeAdo({ "GET /_apis/projects/Fabrikam/teams/Fabrikam%20Team/members": () => new Response("{}", { status: 403 }) });
    expect((await loadAdoContext(client)).members).toEqual([]);
  });

  it("normalises classification paths from team settings", () => {
    expect(toItemPath("\\Fabrikam\\Iteration\\Sprint 1")).toBe("Fabrikam\\Sprint 1");
    expect(toItemPath("Fabrikam\\Sprint 1")).toBe("Fabrikam\\Sprint 1");
  });
});

describe("AdoClient", () => {
  it("sends a bearer token and api-version 7.1", async () => {
    const { client, calls } = fakeAdo({});
    await loadAdoContext(client);
    const call = calls.find((c) => c.url.pathname.endsWith("/backlogconfiguration"))!;
    expect(call.url.searchParams.get("api-version")).toBe("7.1");
    expect(call.headers.Authorization).toBe("Bearer tok");
  });

  it("retries once on throttling, honouring Retry-After", async () => {
    let n = 0;
    const { client } = fakeAdo({
      "GET /_apis/connectionData": () => (++n === 1 ? new Response("{}", { status: 429, headers: { "Retry-After": "0.01" } }) : CONNECTION_DATA),
    });
    await expect(client.request("GET", `${client.orgUrl}/_apis/connectionData`, { apiVersion: null })).resolves.toEqual(CONNECTION_DATA);
    expect(n).toBe(2);
  });

  it.each([
    [401, "unauthorized"],
    [203, "unauthorized"],
    [403, "forbidden"],
    [412, "conflict"],
    [500, "unavailable"],
  ])("maps HTTP %s to %s", async (status, code) => {
    const { client } = fakeAdo({ "GET /_apis/connectionData": () => new Response("{}", { status }) });
    await expect(client.request("GET", `${client.orgUrl}/_apis/connectionData`)).rejects.toMatchObject({ code });
  });

  it("times out slow requests", async () => {
    const slow = vi.fn(
      (_: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("t", "TimeoutError")))),
    );
    const client = new AdoClient({ organization: "acme", project: "P", team: "T" }, { kind: "pat", pat: "x", userKey: "u" }, {
      fetch: slow as unknown as typeof fetch,
      timeoutMs: 20,
    });
    await expect(client.request("GET", `${client.orgUrl}/_apis/connectionData`)).rejects.toMatchObject({ code: "timeout" });
    expect((slow.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: `Basic ${Buffer.from(":x").toString("base64")}` });
  });
});

describe("AzureDevOpsBoard", () => {
  async function setup(routes: Record<string, (body: unknown, url: URL) => unknown>) {
    const fake = fakeAdo(routes);
    const ctx = await loadAdoContext(fake.client);
    fake.calls.length = 0;
    return { ...fake, ctx, board: new AzureDevOpsBoard(fake.client, async () => ctx) };
  }

  it("builds team-scoped WIQL from a query", async () => {
    const { ctx } = await setup({});
    const wiql = buildWiql(
      { assignee: { kind: "me" }, iteration: "Fabrikam\\Sprint 42", types: ["Task"], states: ["New", "Active"], text: "o'brien login" },
      ctx,
    );
    expect(wiql).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AssignedTo] = @Me AND [System.IterationPath] UNDER 'Fabrikam\\Sprint 42' AND [System.WorkItemType] IN ('Task') AND [System.State] IN ('New', 'Active') AND [System.Title] CONTAINS 'o''brien' AND [System.Title] CONTAINS 'login' ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.ChangedDate] DESC",
    );
    expect(buildWiql({ iteration: "backlog", text: "1024" }, ctx)).toContain("[System.IterationPath] = 'Fabrikam' AND [System.Id] = 1024");
  });

  it("queries in three round trips: WIQL, one batch, then missing parent titles", async () => {
    const { board, calls } = await setup({
      "POST /Fabrikam/Fabrikam%20Team/_apis/wit/wiql": () => ({ workItems: [{ id: 2 }, { id: 1 }] }),
      "POST /Fabrikam/_apis/wit/workitemsbatch": (body) => {
        const ids = (body as { ids: number[] }).ids;
        if (ids.includes(1)) {
          return {
            value: [
              dto(1, { "System.Title": "One", "System.Parent": 50, "System.AssignedTo": { displayName: "Dana Kim", uniqueName: "dana@fabrikam.com" } }),
              dto(2, { "System.Title": "Two", "System.State": "Closed", "System.Tags": "api; urgent" }),
            ],
          };
        }
        return { value: [{ id: 50, fields: { "System.Id": 50, "System.Title": "Parent story" } }] };
      },
    });
    const items = await board.query({ assignee: { kind: "me" } });
    expect(calls.map((c) => `${c.method} ${c.url.pathname.split("/").pop()}`)).toEqual(["POST wiql", "POST workitemsbatch", "POST workitemsbatch"]);
    expect((calls[1].body as { fields: string[] }).fields).toEqual(LIST_FIELDS);
    expect(items.map((i) => i.id)).toEqual([2, 1]); // WIQL order kept
    expect(items[1]).toMatchObject({ parentTitle: "Parent story", sprintName: "Sprint 42", stateCategory: "InProgress", assignedTo: { displayName: "Dana Kim" } });
    expect(items[0]).toMatchObject({ stateCategory: "Completed", tags: ["api", "urgent"], url: "https://dev.azure.com/acme/Fabrikam/_workitems/edit/2" });
  });

  it("creates with one JSON Patch: fields, sprint, area and the parent link", async () => {
    let sent: unknown;
    const { board, calls } = await setup({
      "POST /Fabrikam/_apis/wit/workitems/$Task": (body) => {
        sent = body;
        return dto(77, { "System.Title": "Add logging", "System.State": "New", "System.Parent": 1024 });
      },
    });
    const item = await board.create({
      type: "Task",
      title: "Add logging",
      priority: 2,
      assignedTo: { displayName: "Dana Kim", uniqueName: "dana@fabrikam.com" },
      iterationPath: "Fabrikam\\Sprint 42",
      areaPath: "Fabrikam\\Web",
      parentId: 1024,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers["Content-Type"]).toBe("application/json-patch+json");
    expect(sent).toEqual([
      { op: "add", path: "/fields/System.Title", value: "Add logging" },
      { op: "add", path: "/fields/System.IterationPath", value: "Fabrikam\\Sprint 42" },
      { op: "add", path: "/fields/System.AreaPath", value: "Fabrikam\\Web" },
      { op: "add", path: "/fields/Microsoft.VSTS.Common.Priority", value: 2 },
      { op: "add", path: "/fields/System.AssignedTo", value: "dana@fabrikam.com" },
      { op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/acme/_apis/wit/workItems/1024" } },
    ]);
    expect(item).toMatchObject({ id: 77, parentId: 1024, stateCategory: "Proposed" });
  });

  it("updates with a revision test, and re-parents by swapping the link", async () => {
    let sent: unknown;
    const { board } = await setup({
      "GET /Fabrikam/_apis/wit/workitems/9": () => ({
        ...dto(9, { "System.Tags": "api" }),
        relations: [
          { rel: "ArtifactLink", url: "x" },
          { rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/acme/_apis/wit/workItems/5" },
        ],
      }),
      "PATCH /Fabrikam/_apis/wit/workitems/9": (body) => {
        sent = body;
        return dto(9, { "System.State": "Closed", "System.Rev": 4 });
      },
    });
    await board.update(9, { state: "Closed", parentId: 6, comment: "Done in PR 12", addTags: ["shipped"] }, 3);
    expect(sent).toEqual([
      { op: "test", path: "/rev", value: 3 },
      { op: "add", path: "/fields/System.State", value: "Closed" },
      { op: "add", path: "/fields/System.History", value: "<div>Done in PR 12</div>" },
      { op: "add", path: "/fields/System.Tags", value: "api; shipped" },
      { op: "remove", path: "/relations/1" },
      { op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/acme/_apis/wit/workItems/6" } },
    ]);
  });

  it("writes a description as simple HTML, escaping what the user said", async () => {
    let sent: unknown;
    const { board } = await setup({
      "PATCH /Fabrikam/_apis/wit/workitems/9": (body) => {
        sent = body;
        return dto(9, {});
      },
    });
    await board.update(9, { description: "Speed up <search>.\n\n- p95 under 300 ms\n- no regressions" });
    expect(sent).toEqual([
      { op: "add", path: "/fields/System.Description", value: "<div>Speed up &lt;search&gt;.</div><div>- p95 under 300 ms<br>- no regressions</div>" },
    ]);
  });

  it("reads comments with the item detail and deletes one by id", async () => {
    const { board, calls } = await setup({
      "GET /Fabrikam/_apis/wit/workitems/9": () => ({ ...dto(9, {}), relations: [] }),
      "GET /Fabrikam/_apis/wit/workItems/9/comments": () => ({
        comments: [
          { id: 31, text: "<div>Shipped in <b>PR 12</b></div>", createdBy: { displayName: "Priya" }, createdDate: "2026-10-30T10:00:00Z" },
          { id: 30, text: "old", isDeleted: true },
        ],
      }),
      "DELETE /Fabrikam/_apis/wit/workItems/9/comments/31": () => new Response(null, { status: 204 }),
    });
    const detail = await board.getDetail(9);
    expect(detail?.comments).toEqual([{ id: 31, text: "Shipped in PR 12", author: "Priya", createdAt: "2026-10-30T10:00:00Z" }]);
    await board.deleteComment(9, 31);
    const del = calls.find((c) => c.method === "DELETE")!;
    expect(del.url.searchParams.get("api-version")).toBe("7.1-preview.4");
  });

  it("still shows an item when its comments can't be read", async () => {
    const { board } = await setup({ "GET /Fabrikam/_apis/wit/workitems/9": () => ({ ...dto(9, {}), relations: [] }) });
    expect((await board.getDetail(9))?.comments).toEqual([]);
  });

  it("reports a failed revision test as a conflict", async () => {
    const { board } = await setup({
      "PATCH /Fabrikam/_apis/wit/workitems/9": () =>
        new Response(JSON.stringify({ message: "TF401289: The test operation failed for rev." }), { status: 400 }),
    });
    await expect(board.update(9, { state: "Closed" }, 3)).rejects.toMatchObject({ code: "conflict" });
  });

  it("reads detail with ancestors and children", async () => {
    const { board } = await setup({
      "GET /Fabrikam/_apis/wit/workitems/10": () => ({
        ...dto(10, { "System.Title": "Story", "System.WorkItemType": "User Story", "System.Parent": 20, "System.Description": "<p>Hello&nbsp;<b>world</b></p>" }),
        relations: [{ rel: "System.LinkTypes.Hierarchy-Forward", url: "https://dev.azure.com/acme/_apis/wit/workItems/11" }],
      }),
      "POST /Fabrikam/_apis/wit/workitemsbatch": (body) => {
        const [id] = (body as { ids: number[] }).ids;
        if (id === 11) return { value: [dto(11, { "System.Title": "Child", "System.Parent": 10 })] };
        if (id === 20) return { value: [dto(20, { "System.Title": "Feature", "System.WorkItemType": "Feature", "System.Parent": 30 })] };
        return { value: [dto(30, { "System.Title": "Epic", "System.WorkItemType": "Epic" })] };
      },
    });
    const d = (await board.getDetail(10))!;
    expect(d.description).toBe("Hello world");
    expect(d.ancestors.map((a) => a.title)).toEqual(["Feature", "Epic"]);
    expect(d.children).toMatchObject([{ id: 11, parentTitle: "Story" }]);
  });
});

describe("caching", () => {
  it("serves repeat queries and item lookups from cache, and drops them after a write", async () => {
    const inner = {
      context: vi.fn(async () => ({}) as BoardContext),
      query: vi.fn(async () => [{ id: 1, title: "A" }]),
      get: vi.fn(async () => ({ id: 1, title: "fresh" })),
      getDetail: vi.fn(async () => null),
      create: vi.fn(),
      update: vi.fn(async () => ({ id: 1, title: "B", parentId: null })),
    };
    const board = new CachedBoard(inner as never, new TtlCache(), "u|");
    await board.query({});
    await board.query({});
    expect(inner.query).toHaveBeenCalledTimes(1);
    expect(await board.get(1)).toMatchObject({ title: "A" }); // filled from the list
    expect(inner.get).not.toHaveBeenCalled();

    await board.update(1, { title: "B" });
    await board.query({});
    expect(inner.query).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight request and never caches failures", async () => {
    const cache = new TtlCache();
    let n = 0;
    const load = () => (++n === 1 ? Promise.reject(new WorkItemError("x", "timeout")) : Promise.resolve(n));
    await expect(cache.get("k", 1000, load)).rejects.toBeTruthy();
    await new Promise((r) => setTimeout(r, 0));
    const [a, b] = await Promise.all([cache.get("k", 1000, load), cache.get("k", 1000, load)]);
    expect([a, b]).toEqual([2, 2]);
  });
});

describe("auth hook", () => {
  it("forwards a bearer token, falls back to a PAT, and keys users by secret", async () => {
    const a = await getAzureDevOpsCredential(new Headers({ Authorization: "Bearer abc" }));
    expect(a).toMatchObject({ kind: "bearer", token: "abc" });
    vi.stubEnv("AZURE_DEVOPS_PAT", "pat-1");
    const b = await getAzureDevOpsCredential(new Headers());
    expect(b).toMatchObject({ kind: "pat", pat: "pat-1" });
    expect(a!.userKey).not.toBe(b!.userKey);
    vi.stubEnv("AZURE_DEVOPS_PAT", "");
    expect(await getAzureDevOpsCredential(new Headers())).toBeNull();
  });
});

describe("htmlToText", () => {
  it("turns description HTML into speakable text", () => {
    expect(htmlToText("<div>Line one</div><div>Line &amp; two</div>")).toBe("Line one\nLine & two");
  });
});

describe("Azure mode without a credential", () => {
  it("answers tools with a sign-in message instead of failing", async () => {
    const { runToolFor } = await import("../toolRoute");
    vi.stubEnv("BOARD_PROVIDER", "azure");
    vi.stubEnv("AZURE_DEVOPS_ORG", "acme");
    vi.stubEnv("AZURE_DEVOPS_PROJECT", "Fabrikam");
    vi.stubEnv("AZURE_DEVOPS_PAT", "");
    const r = await runToolFor(new Headers(), "list_work_items", {});
    expect(r.output).toEqual({ ok: false, error: "You need to sign in to Azure DevOps." });
    expect(r.uiEvents).toEqual([{ type: "error", message: "You need to sign in to Azure DevOps." }]);

    vi.stubEnv("AZURE_DEVOPS_PROJECT", "");
    expect(String((await runToolFor(new Headers(), "list_work_items", {})).output.error)).toMatch(/AZURE_DEVOPS_PROJECT/);
  });
});
