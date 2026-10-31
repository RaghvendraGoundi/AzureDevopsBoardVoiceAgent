/**
 * Process-agnostic board model. Work item types and state names differ
 * between Azure DevOps processes (Agile, Scrum, Basic, CMMI, custom), so they
 * are plain strings here, validated against the BoardContext detected for
 * the project. State categories are the same in every process and drive
 * "open", "in progress" and "done".
 */

export const STATE_CATEGORIES = ["Proposed", "InProgress", "Resolved", "Completed", "Removed"] as const;
export type StateCategory = (typeof STATE_CATEGORIES)[number];

/** Categories of work that still needs doing. */
export const OPEN_CATEGORIES: StateCategory[] = ["Proposed", "InProgress", "Resolved"];

export interface Person {
  displayName: string;
  /** Sign-in name (usually the email); what Azure DevOps accepts for System.AssignedTo. */
  uniqueName: string;
  id?: string;
}

export interface WorkItem {
  id: number;
  title: string;
  type: string;
  state: string;
  stateCategory: StateCategory;
  /** 1 (highest) – 4 (lowest); null for types without a priority field. */
  priority: number | null;
  assignedTo: Person | null;
  /** Plain text (HTML stripped). Only filled when a single item is fetched. */
  description: string;
  areaPath: string;
  iterationPath: string;
  /** Last segment of the iteration path when it's a sprint; null when on the backlog. */
  sprintName: string | null;
  parentId: number | null;
  parentTitle: string | null;
  tags: string[];
  /** Link to the item in Azure DevOps (null on the emulator). */
  url: string | null;
  createdAt: string;
  changedAt: string;
  /** Revision number, incremented on every update. */
  rev: number;
}

export interface WorkItemRef {
  id: number;
  title: string;
  type: string;
  state: string;
}

export interface WorkItemDetail extends WorkItem {
  /** Parent first, then grandparent, up to the top of the hierarchy. */
  ancestors: WorkItemRef[];
  children: WorkItem[];
}

export interface Sprint {
  id: string;
  name: string;
  path: string;
  startDate: string | null;
  finishDate: string | null;
  timeFrame: "past" | "current" | "future";
}

/** One level of the backlog hierarchy, e.g. Epics, Features, Stories, Tasks. */
export interface BacklogLevel {
  name: string;
  kind: "portfolio" | "requirement" | "task";
  /** Higher ranks sit higher in the hierarchy. */
  rank: number;
  types: string[];
  defaultType: string;
}

export interface TypeInfo {
  name: string;
  /** States in workflow order, with their category. */
  states: Array<{ name: string; category: StateCategory }>;
}

export interface BoardContext {
  provider: "emulated" | "azure";
  me: Person;
  organization: string | null;
  project: string;
  team: string;
  defaultArea: string;
  /** Iteration that holds items not planned into a sprint. */
  backlogIteration: string;
  /** Top of the hierarchy first. */
  hierarchy: BacklogLevel[];
  /** Where bugs sit: alongside requirements, alongside tasks, or not on backlogs. */
  bugsBehavior: "asRequirements" | "asTasks" | "off";
  bugTypes: string[];
  types: Record<string, TypeInfo>;
  /** Team sprints in date order. */
  sprints: Sprint[];
  members: Person[];
}

export type AssigneeFilter = { kind: "me" } | { kind: "anyone" } | { kind: "person"; person: Person } | { kind: "unassigned" };

export interface WorkItemQuery {
  assignee?: AssigneeFilter;
  /** Iteration path (items under it), or "backlog" for unplanned items. Omit for any. */
  iteration?: string | "backlog";
  types?: string[];
  states?: string[];
  parentId?: number;
  /** Title words, or an id. */
  text?: string;
  top?: number;
}

export interface CreateWorkItemInput {
  type: string;
  title: string;
  description?: string;
  priority?: number | null;
  assignedTo: Person | null;
  iterationPath: string;
  areaPath: string;
  parentId?: number | null;
  tags?: string[];
}

export interface WorkItemPatch {
  title?: string;
  state?: string;
  priority?: number;
  assignedTo?: Person | null;
  iterationPath?: string;
  parentId?: number | null;
  /** Added to the item's discussion. */
  comment?: string;
  addTags?: string[];
}
