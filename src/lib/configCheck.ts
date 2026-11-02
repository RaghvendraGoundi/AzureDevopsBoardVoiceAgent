import { entraConfig } from "@/lib/auth/entra";
import { dbConfigured } from "@/lib/db/pool";
import { resolveProvider } from "@/lib/voice/providers";

/**
 * Configuration problems, found at startup so they show up in the server log
 * straight away instead of on someone's first call. Warnings only: the app
 * still starts, and /api/health reports the same.
 */
export function configWarnings(env = process.env): string[] {
  const warnings: string[] = [];
  try {
    resolveProvider(env, "realtime");
  } catch (err) {
    warnings.push(`Realtime voice: ${err instanceof Error ? err.message : err}`);
  }
  const entra = entraConfig(env);
  if (entra && !env.AUTH_SECRET?.trim()) warnings.push("Entra ID sign-in is configured but AUTH_SECRET is missing; sessions can't be encrypted.");
  if (!entra && env.NODE_ENV === "production") warnings.push("Entra ID sign-in isn't configured: anyone who can reach this server can use it.");
  if (env.BOARD_PROVIDER?.trim().toLowerCase() === "azure" && !env.AZURE_DEVOPS_ORG?.trim()) warnings.push("BOARD_PROVIDER=azure needs AZURE_DEVOPS_ORG and AZURE_DEVOPS_PROJECT.");
  if (entra && !env.ADMIN_EMAIL?.trim()) warnings.push("ADMIN_EMAIL isn't set, so nobody is an admin yet.");
  if (!dbConfigured(env) && env.NODE_ENV === "production") warnings.push("No database configured: conversations and telemetry are kept in local files and memory.");
  return warnings;
}
