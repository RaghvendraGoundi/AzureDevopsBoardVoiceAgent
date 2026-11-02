import type { Role } from "@/lib/users/store";
import type { BoardContext, WorkItem } from "./types";

/**
 * Who may see and change what, in one place. Admins: everything. Users: only
 * items assigned to them, plus the titles of related items (parents and
 * children) so the hierarchy still makes sense. Every write is checked when
 * it's proposed and again when it's confirmed.
 *
 * This is on top of Azure DevOps' own permissions, which still apply because
 * calls are made with the user's own token.
 */

export interface Policy {
  role: Role;
  /** May list and open anyone's items. */
  readonly seesEveryone: boolean;
  /** The item is assigned to the current user. */
  owns(item: Pick<WorkItem, "assignedTo">, ctx: BoardContext): boolean;
  /** May open the item in full (description, comments) and change it. */
  canAccess(item: Pick<WorkItem, "assignedTo">, ctx: BoardContext): boolean;
}

export function policyFor(role: Role): Policy {
  const owns = (item: Pick<WorkItem, "assignedTo">, ctx: BoardContext) =>
    !!item.assignedTo && item.assignedTo.uniqueName.toLowerCase() === ctx.me.uniqueName.toLowerCase();
  return {
    role,
    seesEveryone: role === "admin",
    owns,
    canAccess: (item, ctx) => role === "admin" || owns(item, ctx),
  };
}

export const ADMIN_POLICY = policyFor("admin");

export const NOT_YOURS = "That item is assigned to someone else. You can only open and change your own items; an admin can help with others.";
export const ONLY_YOURS = "You can only see your own items. An admin can look at other people's work.";

/** For the model's instructions, so it doesn't offer what the user can't do. */
export function accessNote(role: Role): string {
  return role === "admin"
    ? "- The user is an admin: they can look at and change anyone's work items."
    : "- The user is a regular user: they can only see and change work items assigned to them. Other items show only their title, for context. If they ask about someone else's work, say that only an admin can see it.";
}
