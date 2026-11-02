import { afterEach, describe, expect, it, vi } from "vitest";
import { clearRefreshedTokens, getAzureDevOpsCredential } from "./auth";

afterEach(() => vi.unstubAllEnvs());

describe("getAzureDevOpsCredential", () => {
  it("prefers a bearer token sent with the request", async () => {
    vi.stubEnv("AZURE_DEVOPS_PAT", "pat-value");
    const cred = await getAzureDevOpsCredential(new Headers({ authorization: "Bearer abc.def" }));
    expect(cred).toMatchObject({ kind: "bearer", token: "abc.def" });
  });

  it("falls back to a PAT for local testing", async () => {
    vi.stubEnv("AZURE_DEVOPS_PAT", "pat-value");
    expect(await getAzureDevOpsCredential(new Headers())).toMatchObject({ kind: "pat", pat: "pat-value" });
  });

  it("returns nothing when there is no credential", async () => {
    vi.stubEnv("AZURE_DEVOPS_PAT", "");
    expect(await getAzureDevOpsCredential(new Headers())).toBeNull();
  });

  it("derives a stable user key without exposing the secret", async () => {
    vi.stubEnv("AZURE_DEVOPS_PAT", "");
    const a = await getAzureDevOpsCredential(new Headers({ authorization: "Bearer one" }));
    const b = await getAzureDevOpsCredential(new Headers({ authorization: "Bearer one" }));
    const c = await getAzureDevOpsCredential(new Headers({ authorization: "Bearer two" }));
    expect(a?.userKey).toBe(b?.userKey);
    expect(a?.userKey).not.toBe(c?.userKey);
    expect(a?.userKey).not.toContain("one");
  });
});

describe("getAzureDevOpsCredential with Entra ID sign-in", () => {
  const cfg = { tenantId: "tenant-1", clientId: "client-1", clientSecret: "shh" };
  const fresh = { accessToken: "user-at", refreshToken: "user-rt", expiresAt: Date.now() + 30 * 60_000 };
  const session = (token: object | null) => async () => token as never;

  afterEach(() => clearRefreshedTokens());

  it("uses the signed-in user's token, keyed by tenant and object id", async () => {
    vi.stubEnv("AZURE_DEVOPS_PAT", "pat-value");
    const cred = await getAzureDevOpsCredential(new Headers(), { cfg, session: session({ ado: fresh, oid: "oid-1", tid: "tenant-1" }) });
    expect(cred).toEqual({ kind: "bearer", token: "user-at", userKey: "entra:tenant-1:oid-1" });
  });

  it("ignores the PAT and stray bearer headers when nobody is signed in", async () => {
    vi.stubEnv("AZURE_DEVOPS_PAT", "pat-value");
    const headers = new Headers({ authorization: "Bearer forged" });
    expect(await getAzureDevOpsCredential(headers, { cfg, session: session(null) })).toBeNull();
    expect(await getAzureDevOpsCredential(headers, { cfg, session: session({ ado: fresh, oid: "o", error: "RefreshFailed" }) })).toBeNull();
  });

  it("refreshes an expiring token once and reuses the refreshed one", async () => {
    const expiring = { ...fresh, expiresAt: Date.now() + 30_000 };
    const fetchImpl = vi.fn(async () => Response.json({ access_token: "refreshed-at", refresh_token: "rt2", expires_in: 3600 }));
    const deps = { cfg, session: session({ ado: expiring, oid: "oid-1", tid: "tenant-1" }), fetchImpl: fetchImpl as unknown as typeof fetch };
    expect((await getAzureDevOpsCredential(new Headers(), deps))?.kind === "bearer").toBe(true);
    const second = await getAzureDevOpsCredential(new Headers(), deps);
    expect(second).toMatchObject({ token: "refreshed-at" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("asks the user to sign in again when the refresh is refused", async () => {
    const expiring = { ...fresh, expiresAt: Date.now() + 30_000 };
    const fetchImpl = async () => Response.json({ error: "invalid_grant" }, { status: 400 });
    const cred = await getAzureDevOpsCredential(new Headers(), {
      cfg,
      session: session({ ado: expiring, oid: "oid-1", tid: "tenant-1" }),
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(cred).toBeNull();
  });
});
