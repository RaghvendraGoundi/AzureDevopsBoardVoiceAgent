import { entraConfig } from "@/lib/auth/entra";
import { getAzureDevOpsCredential } from "./azure/auth";
import { AzureDevOpsBoard } from "./azure/board";
import { AdoClient, type AdoConfig } from "./azure/client";
import { loadAdoContext } from "./azure/context";
import { CachedBoard, CONTEXT_TTL_MS, TtlCache } from "./cache";
import { getEmulatedBoard } from "./emulatedBoard";
import { WorkItemError, type WorkItemRepository } from "./repository";

/**
 * Picks the board for a request: the local emulator, or Azure DevOps as the
 * signed-in user (BOARD_PROVIDER=azure).
 */

export interface BoardSession {
  board: WorkItemRepository;
  /** Scopes pending confirmations to this user. */
  userKey: string;
}

export function boardProvider(env = process.env): "emulated" | "azure" {
  return env.BOARD_PROVIDER?.trim().toLowerCase() === "azure" ? "azure" : "emulated";
}

export function azureConfig(env = process.env): AdoConfig {
  const organization = env.AZURE_DEVOPS_ORG?.trim()
    .replace(/^https:\/\/dev\.azure\.com\//, "")
    .replace(/\/.*$/, "");
  const project = env.AZURE_DEVOPS_PROJECT?.trim();
  if (!organization || !project) {
    throw new WorkItemError("Azure DevOps isn't configured: set AZURE_DEVOPS_ORG and AZURE_DEVOPS_PROJECT.", "unavailable");
  }
  return { organization, project, team: env.AZURE_DEVOPS_TEAM?.trim() || `${project} Team` };
}

const globalForCache = globalThis as unknown as { __boardCache?: TtlCache; __boardSweep?: ReturnType<typeof setInterval> };

function sharedCache() {
  if (!globalForCache.__boardCache) {
    const cache = new TtlCache();
    globalForCache.__boardCache = cache;
    globalForCache.__boardSweep = setInterval(() => cache.sweep(), 5 * 60_000);
    globalForCache.__boardSweep.unref?.();
  }
  return globalForCache.__boardCache;
}

function logTiming(label: string, ms: number, status: number) {
  console.info(`[ado] ${label} ${status} ${Math.round(ms)}ms`);
}

/** Who is asking: scopes conversations and confirmations. Null when Azure mode has no credential. */
export async function getUserKey(headers: Headers): Promise<string | null> {
  // With Entra sign-in, saved conversations belong to the signed-in user even on the emulated board.
  if (boardProvider() === "emulated") return entraConfig() ? ((await getAzureDevOpsCredential(headers))?.userKey ?? null) : "local";
  return (await getAzureDevOpsCredential(headers))?.userKey ?? null;
}

export async function getBoardFor(headers: Headers): Promise<BoardSession> {
  if (boardProvider() === "emulated") return { board: getEmulatedBoard(), userKey: "local" };

  const config = azureConfig();
  const credential = await getAzureDevOpsCredential(headers);
  if (!credential) throw new WorkItemError("You need to sign in to Azure DevOps.", "unauthorized");

  const client = new AdoClient(config, credential, { onTiming: logTiming });
  const cache = sharedCache();
  const prefix = `${credential.userKey}|${config.organization}/${config.project}/${config.team}|`;
  // The project context is shared by every request from this user for 15 minutes.
  const inner = new AzureDevOpsBoard(client, () => cache.get(`${prefix}ctx`, CONTEXT_TTL_MS, () => loadAdoContext(client)));
  return { board: new CachedBoard(inner, cache, prefix), userKey: credential.userKey };
}
