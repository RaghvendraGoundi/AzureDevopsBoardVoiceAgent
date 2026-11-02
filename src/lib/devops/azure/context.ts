import { STATE_CATEGORIES, type BacklogLevel, type BoardContext, type Person, type Sprint, type StateCategory, type TypeInfo } from "../types";
import type { AdoClient } from "./client";

/**
 * Reads everything the voice tools need to understand a project, in one
 * parallel burst: who the user is, the backlog hierarchy and states (which
 * also tells us the process), team settings, sprints, default area and team
 * members. Cached per user, so this runs about once per session.
 */

interface BacklogDto {
  name: string;
  rank: number;
  workItemTypes: Array<{ name: string }>;
  defaultWorkItemType?: { name: string };
}

interface BacklogConfigDto {
  portfolioBacklogs: BacklogDto[];
  requirementBacklog: BacklogDto;
  taskBacklog: BacklogDto;
  bugWorkItems?: { workItemTypes: Array<{ name: string }> };
  workItemTypeMappedStates: Array<{ workItemTypeName: string; states: Record<string, string> }>;
}

interface TeamSettingsDto {
  bugsBehavior?: "off" | "asRequirements" | "asTasks";
  backlogIteration?: { name: string; path?: string };
}

interface IterationDto {
  id: string;
  name: string;
  path: string;
  attributes?: { startDate?: string | null; finishDate?: string | null; timeFrame?: string };
}

interface ConnectionDataDto {
  authenticatedUser: { id: string; providerDisplayName: string; properties?: { Account?: { $value?: string } } };
}

/**
 * Team settings sometimes return classification paths as "\Project\Iteration\Sprint 1";
 * work items use "Project\Sprint 1".
 */
export function toItemPath(path: string): string {
  const parts = path.replace(/^\\+/, "").split("\\");
  if (parts[1] === "Iteration" || parts[1] === "Area") parts.splice(1, 1);
  return parts.join("\\");
}

function level(dto: BacklogDto, kind: BacklogLevel["kind"], rank: number): BacklogLevel {
  const all = dto.workItemTypes.map((t) => t.name);
  const defaultType = dto.defaultWorkItemType?.name ?? all[0];
  // The level's default type first: it's the one the team actually uses ("Initiative", not "Feature").
  const types = [defaultType, ...all.filter((t) => t !== defaultType)];
  return { name: dto.name, kind, rank, types, defaultType };
}

export function buildHierarchy(cfg: BacklogConfigDto): BacklogLevel[] {
  // Portfolio backlogs come with their own ranks; renumber so tasks < requirements < portfolios.
  const portfolios = [...cfg.portfolioBacklogs].sort((a, b) => a.rank - b.rank).map((p, i) => level(p, "portfolio", 3 + i));
  return [...portfolios.reverse(), level(cfg.requirementBacklog, "requirement", 2), level(cfg.taskBacklog, "task", 1)];
}

export function buildTypes(cfg: BacklogConfigDto): Record<string, TypeInfo> {
  const types: Record<string, TypeInfo> = {};
  for (const m of cfg.workItemTypeMappedStates) {
    types[m.workItemTypeName] = {
      name: m.workItemTypeName,
      states: Object.entries(m.states).map(([name, category]) => ({
        name,
        category: (STATE_CATEGORIES as readonly string[]).includes(category) ? (category as StateCategory) : "InProgress",
      })),
    };
  }
  return types;
}

export function buildSprints(iterations: IterationDto[]): Sprint[] {
  return iterations
    .map((it) => ({
      id: it.id,
      name: it.name,
      path: toItemPath(it.path),
      startDate: it.attributes?.startDate ?? null,
      finishDate: it.attributes?.finishDate ?? null,
      timeFrame: (["past", "current", "future"].includes(it.attributes?.timeFrame ?? "") ? it.attributes!.timeFrame : "future") as Sprint["timeFrame"],
    }))
    .sort((a, b) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999"));
}

export async function loadAdoContext(client: AdoClient): Promise<BoardContext> {
  const { organization, project, team } = client.config;
  const [conn, backlog, settings, iterations, fields, members] = await Promise.all([
    client.request<ConnectionDataDto>("GET", `${client.orgUrl}/_apis/connectionData`, { apiVersion: null }),
    client.request<BacklogConfigDto>("GET", `${client.teamUrl}/_apis/work/backlogconfiguration`),
    client.request<TeamSettingsDto>("GET", `${client.teamUrl}/_apis/work/teamsettings`),
    client.request<{ value: IterationDto[] }>("GET", `${client.teamUrl}/_apis/work/teamsettings/iterations`),
    client.request<{ defaultValue?: string }>("GET", `${client.teamUrl}/_apis/work/teamsettings/teamfieldvalues`),
    // Assigning by name needs people, but the tools still work without them.
    projectPeople(client, project, team).catch(() => ({ value: [] })),
  ]);

  const me: Person = {
    id: conn.authenticatedUser.id,
    displayName: conn.authenticatedUser.providerDisplayName,
    uniqueName: conn.authenticatedUser.properties?.Account?.$value ?? conn.authenticatedUser.providerDisplayName,
  };
  return {
    provider: "azure",
    me,
    organization,
    project,
    team,
    defaultArea: fields.defaultValue ?? project,
    // For a project-root backlog iteration Azure DevOps returns path "" and the real name in `name`.
    backlogIteration: toItemPath(settings.backlogIteration?.path || settings.backlogIteration?.name || project),
    hierarchy: buildHierarchy(backlog),
    bugsBehavior: settings.bugsBehavior ?? "asRequirements",
    bugTypes: backlog.bugWorkItems?.workItemTypes.map((t) => t.name) ?? [],
    types: buildTypes(backlog),
    sprints: buildSprints(iterations.value),
    members: members.value
      .map((m) => ({ id: m.identity.id, displayName: m.identity.displayName, uniqueName: m.identity.uniqueName }))
      .filter((p) => p.uniqueName !== me.uniqueName),
  };
}

/** Teams read for the people list, at most; big projects add more people on demand (searchPeople). */
const MAX_TEAMS = 25;

/**
 * Members of every team in the project, not just the configured one, so
 * "what's Priya working on?" works when Priya is on another team. The
 * configured team is read first and always included.
 */
async function projectPeople(client: AdoClient, project: string, team: string): Promise<{ value: Array<{ identity: Person }> }> {
  const base = `${client.orgUrl}/_apis/projects/${encodeURIComponent(project)}/teams`;
  const membersOf = (t: string) =>
    client
      .request<{ value: Array<{ identity: Person }> }>("GET", `${base}/${encodeURIComponent(t)}/members`, { query: { $top: 300 } })
      .then((r) => r.value)
      .catch(() => [] as Array<{ identity: Person }>);
  const [own, teams] = await Promise.all([
    membersOf(team),
    client.request<{ value: Array<{ name: string }> }>("GET", base, { query: { $top: 200 } }).then((r) => r.value).catch(() => []),
  ]);
  const others = teams.map((t) => t.name).filter((n) => n !== team).slice(0, MAX_TEAMS - 1);
  const rest = (await Promise.all(others.map(membersOf))).flat();
  const seen = new Set<string>();
  const value = [...own, ...rest].filter((m) => {
    const key = m.identity?.uniqueName?.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { value };
}
