import { afterEach, describe, expect, it, vi } from "vitest";
import { getAzureDevOpsCredential } from "./auth";

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
