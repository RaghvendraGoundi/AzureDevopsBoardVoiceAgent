import { WorkItemError } from "../repository";
import type { AdoCredential } from "./auth";

export const API_VERSION = "7.1";

export interface AdoConfig {
  organization: string;
  project: string;
  team: string;
}

export interface AdoClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Called after every request; used for latency logging. */
  onTiming?: (label: string, ms: number, status: number) => void;
}

interface RequestOptions {
  body?: unknown;
  contentType?: string;
  query?: Record<string, string | number | undefined>;
  /** Defaults to API_VERSION; null sends none. */
  apiVersion?: string | null;
}

const MAX_RETRY_WAIT_MS = 2000;

/**
 * Thin Azure DevOps REST client: auth header, api-version, timeout, one
 * retry on throttling or a transient server error, and errors mapped to
 * WorkItemError so the voice tools can explain them.
 */
export class AdoClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    readonly config: AdoConfig,
    private readonly credential: AdoCredential,
    private readonly opts: AdoClientOptions = {},
  ) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  get orgUrl() {
    return `https://dev.azure.com/${encodeURIComponent(this.config.organization)}`;
  }

  get projectUrl() {
    return `${this.orgUrl}/${encodeURIComponent(this.config.project)}`;
  }

  get teamUrl() {
    return `${this.projectUrl}/${encodeURIComponent(this.config.team)}`;
  }

  /** Browser link to a work item. */
  itemUrl(id: number) {
    return `${this.projectUrl}/_workitems/edit/${id}`;
  }

  /** API link used in relations (parent/child links). */
  itemApiUrl(id: number) {
    return `${this.orgUrl}/_apis/wit/workItems/${id}`;
  }

  private authHeader() {
    return this.credential.kind === "bearer"
      ? `Bearer ${this.credential.token}`
      : `Basic ${Buffer.from(`:${this.credential.pat}`).toString("base64")}`;
  }

  async request<T>(method: string, url: string, opts: RequestOptions = {}): Promise<T> {
    const u = new URL(url);
    const apiVersion = opts.apiVersion === undefined ? API_VERSION : opts.apiVersion;
    if (apiVersion) u.searchParams.set("api-version", apiVersion);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    const label = `${method} ${u.pathname.replace(/^\/[^/]+/, "")}`;

    for (let attempt = 0; ; attempt++) {
      const started = performance.now();
      let res: Response;
      try {
        res = await this.fetchImpl(u, {
          method,
          headers: {
            Authorization: this.authHeader(),
            Accept: "application/json",
            ...(opts.body !== undefined && { "Content-Type": opts.contentType ?? "application/json" }),
          },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(this.timeoutMs),
          cache: "no-store",
          // A PAT or token problem makes Azure DevOps redirect to a sign-in page; treat it as an error.
          redirect: "manual",
        });
      } catch (err) {
        const ms = performance.now() - started;
        this.opts.onTiming?.(label, ms, 0);
        if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
          throw new WorkItemError("Azure DevOps took too long to respond.", "timeout");
        }
        throw new WorkItemError("Couldn't reach Azure DevOps.", "unavailable");
      }
      this.opts.onTiming?.(label, performance.now() - started, res.status);

      if ((res.status === 429 || res.status === 503 || res.status === 502) && attempt === 0) {
        const retryAfter = Number(res.headers.get("Retry-After"));
        await new Promise((r) => setTimeout(r, Math.min(MAX_RETRY_WAIT_MS, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500)));
        continue;
      }
      if (res.ok && res.status !== 203) {
        return (res.status === 204 ? undefined : await res.json()) as T;
      }
      throw await this.toError(res);
    }
  }

  private async toError(res: Response): Promise<WorkItemError> {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    const detail = body?.message?.replace(/^TF\d+:\s*/, "") ?? "";
    switch (res.status) {
      case 203:
      case 302:
      case 401:
        return new WorkItemError("You need to sign in to Azure DevOps again.", "unauthorized");
      case 403:
        return new WorkItemError("You don't have permission to do that in Azure DevOps.", "forbidden");
      case 404:
        return new WorkItemError(detail || "That wasn't found in Azure DevOps.", "not_found");
      case 409:
      case 412:
        return new WorkItemError("The work item was changed by someone else since it was read.", "conflict");
      case 429:
        return new WorkItemError("Azure DevOps is busy right now. Try again in a moment.", "rate_limited");
      case 400:
        // A failed rev test comes back as a 400 mentioning the revision.
        if (/\brev(ision)?\b/i.test(detail) && /test/i.test(detail)) {
          return new WorkItemError("The work item was changed by someone else since it was read.", "conflict");
        }
        return new WorkItemError(detail || "Azure DevOps rejected the request.", "invalid");
      default:
        return new WorkItemError("Azure DevOps had a problem handling that.", "unavailable");
    }
  }
}
