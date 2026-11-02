import type { BoardContext, Person, Sprint, TypeInfo } from "./types";

/**
 * The emulated project: the Azure DevOps Agile process, a team with three
 * people, and sprints dated around today so "current sprint" always means
 * something.
 */

export const EMULATED_PROJECT = "Contoso";
export const EMULATED_TEAM = "Contoso Team";
const DAY = 86_400_000;

const STORY_STATES: TypeInfo["states"] = [
  { name: "New", category: "Proposed" },
  { name: "Active", category: "InProgress" },
  { name: "Resolved", category: "Resolved" },
  { name: "Closed", category: "Completed" },
  { name: "Removed", category: "Removed" },
];

export function emulatedPeople(currentUser: string): { me: Person; members: Person[] } {
  const person = (displayName: string): Person => ({
    displayName,
    uniqueName: `${displayName.toLowerCase().replace(/[^a-z]+/g, ".")}@contoso.com`,
  });
  return { me: person(currentUser), members: [person("Priya Shah"), person("Marcus Lee")] };
}

/** People in the organization but not on the team: only found by name search. */
export function emulatedOrgPeople(): Person[] {
  return ["Jordan Blake", "Jordan Lee", "Sam Rivera"].map((displayName) => ({
    displayName,
    uniqueName: `${displayName.toLowerCase().replace(/[^a-z]+/g, ".")}@contoso.com`,
  }));
}

/** Sprints 41–44, with 42 running now (it started five days ago). */
export function emulatedSprints(now = new Date()): Sprint[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const currentStart = today - 5 * DAY;
  return [41, 42, 43, 44].map((n, i) => {
    const start = currentStart + (i - 1) * 14 * DAY;
    const finish = start + 13 * DAY;
    return {
      id: `sprint-${n}`,
      name: `Sprint ${n}`,
      path: `${EMULATED_PROJECT}\\Sprint ${n}`,
      startDate: new Date(start).toISOString(),
      finishDate: new Date(finish).toISOString(),
      timeFrame: i === 0 ? "past" : i === 1 ? "current" : "future",
    };
  });
}

export function emulatedContext(currentUser: string, now = new Date()): BoardContext {
  const { me, members } = emulatedPeople(currentUser);
  return {
    provider: "emulated",
    me,
    organization: null,
    project: EMULATED_PROJECT,
    team: EMULATED_TEAM,
    defaultArea: `${EMULATED_PROJECT}\\Platform`,
    backlogIteration: EMULATED_PROJECT,
    hierarchy: [
      { name: "Epics", kind: "portfolio", rank: 4, types: ["Epic"], defaultType: "Epic" },
      { name: "Features", kind: "portfolio", rank: 3, types: ["Feature"], defaultType: "Feature" },
      { name: "Stories", kind: "requirement", rank: 2, types: ["User Story"], defaultType: "User Story" },
      { name: "Tasks", kind: "task", rank: 1, types: ["Task"], defaultType: "Task" },
    ],
    bugsBehavior: "asRequirements",
    bugTypes: ["Bug"],
    types: {
      Epic: { name: "Epic", states: STORY_STATES },
      Feature: { name: "Feature", states: STORY_STATES },
      "User Story": { name: "User Story", states: STORY_STATES },
      Task: {
        name: "Task",
        states: [
          { name: "New", category: "Proposed" },
          { name: "Active", category: "InProgress" },
          { name: "Closed", category: "Completed" },
          { name: "Removed", category: "Removed" },
        ],
      },
      Bug: { name: "Bug", states: STORY_STATES },
    },
    sprints: emulatedSprints(now),
    members,
  };
}

/** What the emulator stores per item; derived fields are computed on read. */
export interface StoredItem {
  id: number;
  title: string;
  type: string;
  state: string;
  priority: number | null;
  assignedTo: Person | null;
  description: string;
  areaPath: string;
  iterationPath: string;
  parentId: number | null;
  tags: string[];
  createdAt: string;
  changedAt: string;
  rev: number;
}

export function buildSeed(currentUser: string, now = new Date()): StoredItem[] {
  const { me, members } = emulatedPeople(currentUser);
  const [priya, marcus] = members;
  const sprint = (n: number) => `${EMULATED_PROJECT}\\Sprint ${n}`;
  const backlog = EMULATED_PROJECT;
  const area = `${EMULATED_PROJECT}\\Platform`;
  type Row = [number, string, string, string, number, Person | null, string, number | null, string, string?];
  const rows: Row[] = [
    [1001, "Customer portal v2", "Epic", "Active", 1, null, backlog, null, "Modernise the customer portal."],
    [1010, "Secure sign-in", "Feature", "Active", 1, me, backlog, 1001, "Single sign-on and session handling."],
    [1011, "Public API hardening", "Feature", "Active", 2, priya, backlog, 1001, "Make the public API safe under load."],
    [1012, "Dashboard refresh", "Feature", "New", 3, null, backlog, 1001, "New dashboard look and theming."],
    [1024, "Implement authentication", "User Story", "Active", 1, me, sprint(42), 1010, "OAuth sign-in with session refresh for the web portal."],
    [1033, "Audit log for admin actions", "User Story", "New", 2, null, sprint(43), 1010, "Record who changed what and when for admin screens."],
    [1034, "Rate limit the public API", "User Story", "Active", 2, me, sprint(42), 1011, "Protect the API from abusive clients."],
    [1029, "Dark mode for dashboard", "User Story", "New", 4, priya, sprint(43), 1012, "Respect system theme; add manual toggle."],
    [1025, "Fix API timeout on order lookup", "Bug", "Active", 2, me, sprint(42), 1011, "GET /orders/{id} times out after 30s under load."],
    [1030, "Payment webhook retries failing", "Bug", "Active", 1, marcus, sprint(42), 1011, "Retries stop after first 5xx from provider."],
    [1035, "Add token refresh endpoint", "Task", "Active", 2, me, sprint(42), 1024, "POST /auth/refresh with rotation."],
    [1036, "Write sign-in integration tests", "Task", "New", 3, me, sprint(42), 1024, "Cover login, refresh and logout."],
    [1026, "Add rate limiting middleware", "Task", "Active", 2, me, sprint(42), 1034, "Token bucket per API key, 100 req/min default."],
    [1037, "Document rate limits for partners", "Task", "New", 3, priya, sprint(42), 1034, "Publish limits and headers in the API docs."],
    [1028, "Migrate CI pipeline to YAML", "Task", "Active", 3, me, sprint(42), null, "Replace classic build definitions with azure-pipelines.yml."],
    [1031, "Upgrade Node runtime to LTS", "Task", "Closed", 2, me, sprint(41), 1034, "Bump base images and verify test suite."],
    [1032, "Cache product catalog responses", "Task", "Closed", 3, priya, sprint(41), 1034, "Redis cache with 5 min TTL."],
  ];
  const created = new Date(now.getTime() - 14 * DAY).toISOString();
  return rows.map(([id, title, type, state, priority, assignedTo, iterationPath, parentId, description]) => ({
    id,
    title,
    type,
    state,
    priority,
    assignedTo,
    description: description ?? "",
    areaPath: area,
    iterationPath,
    parentId,
    tags: [],
    createdAt: created,
    changedAt: created,
    rev: 1,
  }));
}
