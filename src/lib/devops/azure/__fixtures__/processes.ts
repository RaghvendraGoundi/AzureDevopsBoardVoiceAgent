/**
 * Response shapes from Azure DevOps 7.1 for the three common processes:
 * GET {team}/_apis/work/backlogconfiguration (trimmed to the fields we read).
 */

const backlog = (name: string, rank: number, types: string[]) => ({
  name,
  rank,
  workItemTypes: types.map((t) => ({ name: t })),
  defaultWorkItemType: { name: types[0] },
});

export const AGILE_BACKLOG = {
  portfolioBacklogs: [backlog("Epics", 4, ["Epic"]), backlog("Features", 3, ["Feature"])],
  requirementBacklog: backlog("Stories", 2, ["User Story", "Bug"]),
  taskBacklog: backlog("Tasks", 1, ["Task"]),
  bugWorkItems: { name: "Bugs", workItemTypes: [{ name: "Bug" }] },
  workItemTypeMappedStates: [
    { workItemTypeName: "Epic", states: { New: "Proposed", Active: "InProgress", Resolved: "Resolved", Closed: "Completed", Removed: "Removed" } },
    { workItemTypeName: "Feature", states: { New: "Proposed", Active: "InProgress", Resolved: "Resolved", Closed: "Completed", Removed: "Removed" } },
    { workItemTypeName: "User Story", states: { New: "Proposed", Active: "InProgress", Resolved: "Resolved", Closed: "Completed", Removed: "Removed" } },
    { workItemTypeName: "Bug", states: { New: "Proposed", Active: "InProgress", Resolved: "Resolved", Closed: "Completed" } },
    { workItemTypeName: "Task", states: { New: "Proposed", Active: "InProgress", Closed: "Completed", Removed: "Removed" } },
  ],
};

export const SCRUM_BACKLOG = {
  portfolioBacklogs: [backlog("Epics", 4, ["Epic"]), backlog("Features", 3, ["Feature"])],
  requirementBacklog: backlog("Backlog items", 2, ["Product Backlog Item", "Bug"]),
  taskBacklog: backlog("Tasks", 1, ["Task"]),
  bugWorkItems: { name: "Bugs", workItemTypes: [{ name: "Bug" }] },
  workItemTypeMappedStates: [
    { workItemTypeName: "Epic", states: { New: "Proposed", "In Progress": "InProgress", Done: "Completed", Removed: "Removed" } },
    { workItemTypeName: "Feature", states: { New: "Proposed", "In Progress": "InProgress", Done: "Completed", Removed: "Removed" } },
    { workItemTypeName: "Product Backlog Item", states: { New: "Proposed", Approved: "Proposed", Committed: "InProgress", Done: "Completed", Removed: "Removed" } },
    { workItemTypeName: "Bug", states: { New: "Proposed", Approved: "Proposed", Committed: "InProgress", Done: "Completed", Removed: "Removed" } },
    { workItemTypeName: "Task", states: { "To Do": "Proposed", "In Progress": "InProgress", Done: "Completed", Removed: "Removed" } },
  ],
};

export const BASIC_BACKLOG = {
  portfolioBacklogs: [backlog("Epics", 3, ["Epic"])],
  requirementBacklog: backlog("Issues", 2, ["Issue"]),
  taskBacklog: backlog("Tasks", 1, ["Task"]),
  workItemTypeMappedStates: [
    { workItemTypeName: "Epic", states: { "To Do": "Proposed", Doing: "InProgress", Done: "Completed" } },
    { workItemTypeName: "Issue", states: { "To Do": "Proposed", Doing: "InProgress", Done: "Completed" } },
    { workItemTypeName: "Task", states: { "To Do": "Proposed", Doing: "InProgress", Done: "Completed" } },
  ],
};

export const ITERATIONS = {
  value: [
    { id: "i43", name: "Sprint 43", path: "Fabrikam\\Sprint 43", attributes: { startDate: "2026-11-09T00:00:00Z", finishDate: "2026-11-20T00:00:00Z", timeFrame: "future" } },
    { id: "i41", name: "Sprint 41", path: "Fabrikam\\Sprint 41", attributes: { startDate: "2026-10-12T00:00:00Z", finishDate: "2026-10-23T00:00:00Z", timeFrame: "past" } },
    { id: "i42", name: "Sprint 42", path: "Fabrikam\\Sprint 42", attributes: { startDate: "2026-10-26T00:00:00Z", finishDate: "2026-11-06T00:00:00Z", timeFrame: "current" } },
  ],
};

export const CONNECTION_DATA = {
  authenticatedUser: { id: "u-1", providerDisplayName: "Dana Kim", properties: { Account: { $value: "dana@fabrikam.com" } } },
};

export const TEAM_SETTINGS = { bugsBehavior: "asRequirements", backlogIteration: { name: "Fabrikam", path: "\\Fabrikam\\Iteration" } };

export const TEAM_FIELD_VALUES = { defaultValue: "Fabrikam\\Web" };

export const MEMBERS = {
  value: [
    { identity: { id: "u-1", displayName: "Dana Kim", uniqueName: "dana@fabrikam.com" } },
    { identity: { id: "u-2", displayName: "Luis Ortega", uniqueName: "luis@fabrikam.com" } },
  ],
};

/** MyWork: inherited Agile with Initiative on the Features level and a five-state workflow (scripts/azure_boards_setup.py). */
const MYWORK_STATES = { New: "Proposed", "In Progress": "InProgress", "On Hold": "InProgress", "In Review": "InProgress", Completed: "Completed", Removed: "Removed" };
export const MYWORK_BACKLOG = {
  portfolioBacklogs: [backlog("Epics", 4, ["Epic"]), backlog("Initiatives", 3, ["Initiative"])],
  requirementBacklog: backlog("Stories", 2, ["User Story", "Bug"]),
  taskBacklog: backlog("Tasks", 1, ["Task"]),
  bugWorkItems: { name: "Bugs", workItemTypes: [{ name: "Bug" }] },
  workItemTypeMappedStates: ["Epic", "Initiative", "User Story", "Bug", "Task"].map((t) => ({ workItemTypeName: t, states: MYWORK_STATES })),
};
