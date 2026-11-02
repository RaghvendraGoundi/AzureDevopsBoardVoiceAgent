import { describe, expect, it, vi } from "vitest";
import { bootstrapAdmins, FileUserRepo, forgetRole, isBootstrapAdmin, roleFor } from "./store";

describe("roles", () => {
  it("treats ADMIN_EMAIL (comma separated, any case) as admins", () => {
    const env = { ADMIN_EMAIL: " Boss@Contoso.com, ops@contoso.com " } as unknown as NodeJS.ProcessEnv;
    expect(bootstrapAdmins(env)).toEqual(["boss@contoso.com", "ops@contoso.com"]);
    expect(isBootstrapAdmin("BOSS@contoso.com", env)).toBe(true);
    expect(isBootstrapAdmin("someone@contoso.com", env)).toBe(false);
  });

  it("uses the stored role, cached for a minute", async () => {
    vi.stubEnv("ADMIN_EMAIL", "");
    const repo = new FileUserRepo(null);
    await repo.seen({ userKey: "u1", name: "Alex", email: "alex@contoso.com" });
    expect(await roleFor("u1", "alex@contoso.com", repo, 1_000)).toBe("user");
    await repo.setRole("u1", "admin");
    expect(await roleFor("u1", "alex@contoso.com", repo, 2_000)).toBe("user"); // cached
    forgetRole("u1");
    expect(await roleFor("u1", "alex@contoso.com", repo, 3_000)).toBe("admin");
    vi.unstubAllEnvs();
  });

  it("makes the bootstrap admin an admin even before they're stored", async () => {
    vi.stubEnv("ADMIN_EMAIL", "boss@contoso.com");
    expect(await roleFor("new", "boss@contoso.com", new FileUserRepo(null))).toBe("admin");
    vi.unstubAllEnvs();
  });
});
