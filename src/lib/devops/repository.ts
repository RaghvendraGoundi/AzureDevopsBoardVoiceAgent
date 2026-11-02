import type {
  BoardContext,
  Person,
  CreateWorkItemInput,
  WorkItem,
  WorkItemDetail,
  WorkItemPatch,
  WorkItemQuery,
  WorkItemRef,
} from "./types";

/**
 * Storage-agnostic access to a board. Implemented by the emulated board and
 * by the Azure DevOps REST adapter, so the voice tools never know which one
 * they are talking to.
 */
export interface WorkItemRepository {
  /** Who the user is, the process (types, states, hierarchy), sprints and team. */
  context(): Promise<BoardContext>;
  query(q: WorkItemQuery): Promise<WorkItem[]>;
  get(id: number): Promise<WorkItem | null>;
  /** The item with its parent chain and children. */
  getDetail(id: number): Promise<WorkItemDetail | null>;
  create(input: CreateWorkItemInput): Promise<WorkItem>;
  /** Fails with "conflict" if the item is no longer at `expectedRev`. */
  update(id: number, patch: WorkItemPatch, expectedRev?: number): Promise<WorkItem>;
  /** Removes one comment from an item's discussion. */
  deleteComment(itemId: number, commentId: number): Promise<void>;
  /** The parent chains of `items` (everything above them, once each), for the hierarchy tree. */
  ancestorsOf?(items: WorkItem[]): Promise<WorkItemRef[]>;
  /** People in the organization matching a name, beyond the project's teams. */
  searchPeople?(text: string): Promise<Person[]>;
}

export type WorkItemErrorCode =
  | "not_found"
  | "invalid"
  | "invalid_transition"
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "rate_limited"
  | "timeout"
  | "unavailable";

export class WorkItemError extends Error {
  constructor(
    message: string,
    readonly code: WorkItemErrorCode,
  ) {
    super(message);
  }
}
