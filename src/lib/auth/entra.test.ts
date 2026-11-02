import { describe, expect, it, vi } from "vitest";
import { AZURE_DEVOPS_SCOPE, entraConfig, gate, needsRefresh, refreshAdoTokens, SIGN_IN_SCOPES, TokenRefreshError, userKeyFor } from "./entra";

const cfg = { tenantId: "tenant-1", clientId: "client-1", clientSecret: "shh" };

describe("entraConfig", () => {
  it("needs the tenant, client id and secret", () => {
    expect(entraConfig({ AUTH_MICROSOFT_ENTRA_ID_TENANT_ID: "t", AUTH_MICROSOFT_ENTRA_ID_ID: "c", AUTH_MICROSOFT_ENTRA_ID_SECRET: "s" } as unknown as NodeJS.ProcessEnv)).toEqual({
      tenantId: "t",
      clientId: "c",
      clientSecret: "s",
    });
    expect(entraConfig({ AUTH_MICROSOFT_ENTRA_ID_TENANT_ID: "t", AUTH_MICROSOFT_ENTRA_ID_ID: "c" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it("asks for Azure DevOps access and a refresh token at sign-in", () => {
    expect(SIGN_IN_SCOPES).toContain("offline_access");
    expect(SIGN_IN_SCOPES).toContain("499b84ac-1321-427f-aa17-267ca6abc798/user_impersonation");
  });
});

describe("refreshAdoTokens", () => {
  it("swaps the refresh token for a new Azure DevOps token at the tenant's endpoint", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ access_token: "new-at", refresh_token: "new-rt", expires_in: 3600 }));
    const t = await refreshAdoTokens(cfg, "old-rt", fetchImpl as unknown as typeof fetch, 1_000);
    expect(t).toEqual({ accessToken: "new-at", refreshToken: "new-rt", expiresAt: 1_000 + 3_600_000 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token");
    const form = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(form)).toMatchObject({
      grant_type: "refresh_token",
      client_id: "client-1",
      refresh_token: "old-rt",
      scope: `${AZURE_DEVOPS_SCOPE} offline_access`,
    });
  });

  it("keeps the old refresh token when Entra doesn't send a new one", async () => {
    const fetchImpl = async () => Response.json({ access_token: "at", expires_in: 60 });
    expect((await refreshAdoTokens(cfg, "old-rt", fetchImpl as typeof fetch)).refreshToken).toBe("old-rt");
  });

  it("reports Entra's error without leaking tokens", async () => {
    const fetchImpl = async () =>
      Response.json({ error: "invalid_grant", error_description: "AADSTS700082: The refresh token has expired.\nTrace ID: x" }, { status: 400 });
    const err = await refreshAdoTokens(cfg, "secret-rt", fetchImpl as typeof fetch).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TokenRefreshError);
    expect(err).toMatchObject({ code: "invalid_grant", message: "AADSTS700082: The refresh token has expired." });
    expect(String((err as Error).message)).not.toContain("secret-rt");
  });
});

describe("helpers", () => {
  it("refreshes a couple of minutes before expiry", () => {
    expect(needsRefresh({ accessToken: "", refreshToken: "", expiresAt: 10 * 60_000 }, 0)).toBe(false);
    expect(needsRefresh({ accessToken: "", refreshToken: "", expiresAt: 60_000 }, 0)).toBe(true);
  });

  it("keys users by tenant and object id", () => {
    expect(userKeyFor("t", "o")).toBe("entra:t:o");
  });

  it("sends pages to sign-in, answers 401 for APIs, and leaves sign-in itself alone", () => {
    expect(gate("/voice", false)).toBe("signin");
    expect(gate("/api/voice/session", false)).toBe("unauthorized");
    expect(gate("/api/auth/callback/microsoft-entra-id", false)).toBe("pass");
    expect(gate("/signin", false)).toBe("pass");
    expect(gate("/voice", true)).toBe("pass");
  });
});
