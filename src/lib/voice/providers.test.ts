import { afterEach, describe, expect, it, vi } from "vitest";
import { COGNITIVE_SERVICES_SCOPE, setCredentialFactoryForTests } from "@/lib/azure/credential";
import { ProviderConfigError, resolveProvider } from "./providers";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
const azure = { VOICE_PROVIDER: "azure", AZURE_OPENAI_ENDPOINT: "https://res.openai.azure.com/", AZURE_OPENAI_REALTIME_DEPLOYMENT: "rt" };

afterEach(() => setCredentialFactoryForTests(null));

describe("resolveProvider", () => {
  it("OpenAI: bearer API key, Realtime and GPT-Live endpoints", async () => {
    const p = resolveProvider(env({ OPENAI_API_KEY: "sk-test" }));
    expect(await p.getAuthHeaders()).toEqual({ Authorization: "Bearer sk-test" });
    expect(p.liveSessionsUrl).toBe("https://api.openai.com/v1/live/sessions");
    expect(resolveProvider(env({ OPENAI_API_KEY: "sk" }), "live").model).toBe("gpt-live-1");
  });

  it("Foundry with an API key", async () => {
    const p = resolveProvider(env({ ...azure, AZURE_OPENAI_API_KEY: "k" }));
    expect(p.auth).toBe("api-key");
    expect(await p.getAuthHeaders()).toEqual({ "api-key": "k" });
    expect(p.webrtcUrl).toBe("https://res.openai.azure.com/openai/v1/realtime/calls?webrtcfilter=on");
  });

  it("Foundry with managed identity when there is no key", async () => {
    const getToken = vi.fn(async () => ({ token: "mi-token", expiresOnTimestamp: Date.now() + 3_600_000 }));
    setCredentialFactoryForTests(async () => ({ getToken }));
    const p = resolveProvider(env(azure));
    expect(p.auth).toBe("managed-identity");
    expect(await p.getAuthHeaders()).toEqual({ Authorization: "Bearer mi-token" });
    await p.getAuthHeaders();
    expect(getToken).toHaveBeenCalledOnce(); // cached until near expiry
    expect(getToken).toHaveBeenCalledWith(COGNITIVE_SERVICES_SCOPE);
  });

  it("explains a managed-identity failure without crashing", async () => {
    setCredentialFactoryForTests(async () => ({ getToken: async () => Promise.reject(new Error("ManagedIdentityCredential: no identity")) }));
    await expect(resolveProvider(env(azure)).getAuthHeaders()).rejects.toThrow(/managed-identity token.*az login/s);
  });

  it("hosts GPT-Live separately with LIVE_PROVIDER", () => {
    const p = resolveProvider(env({ OPENAI_API_KEY: "sk", LIVE_PROVIDER: "azure", AZURE_OPENAI_ENDPOINT: "https://f.openai.azure.com", AZURE_OPENAI_LIVE_DEPLOYMENT: "live-dep", AZURE_OPENAI_API_KEY: "k" }), "live");
    expect(p).toMatchObject({ name: "azure", model: "live-dep", liveSessionsUrl: "https://f.openai.azure.com/openai/v1/live/sessions" });
  });

  it("rejects unknown settings clearly", () => {
    expect(() => resolveProvider(env({ ...azure, AZURE_AUTH: "magic" }))).toThrow(ProviderConfigError);
    expect(() => resolveProvider(env({ ...azure, AZURE_AUTH: "api-key" }))).toThrow(/needs AZURE_OPENAI_API_KEY/);
  });
});
