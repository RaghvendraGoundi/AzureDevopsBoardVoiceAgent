import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPrincipal } from "@/lib/auth/principal";
import { getTelemetry } from "@/lib/telemetry";
import { forgetRole, getUserRepo, isBootstrapAdmin, type Role } from "@/lib/users/store";
import { LogoMark } from "@/components/voice/icons";
import { relativeTime } from "@/components/voice/time";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const me = await getPrincipal(new Headers(await headers()));
  if (!me || me.role !== "admin") notFound();
  return me;
}

/** Promote or demote someone. ADMIN_EMAIL accounts always stay admin. */
async function setRole(formData: FormData) {
  "use server";
  await requireAdmin();
  const userKey = String(formData.get("userKey") ?? "");
  const role = formData.get("role") === "admin" ? "admin" : "user";
  const repo = getUserRepo();
  const target = await repo.get(userKey);
  if (!target || (role === "user" && isBootstrapAdmin(target.email))) return;
  await repo.setRole(userKey, role as Role);
  forgetRole(userKey);
  revalidatePath("/admin");
}

const fmtMs = (ms: number | null) => (ms == null ? "–" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

/** People and their roles, and recent calls with their tool timings and errors. */
export default async function AdminPage() {
  const me = await requireAdmin();
  const [users, sessions] = await Promise.all([getUserRepo().list(), getTelemetry().recentSessions(40)]);

  return (
    <main className="admin">
      <header className="admin-head">
        <Link href="/voice" className="brand" aria-label="Back to DevOps Voice">
          <LogoMark size={36} />
          <span className="word">
            <b>DevOps</b>
            <i>Voice</i>
          </span>
        </Link>
        <span className="sub2">Admin · signed in as {me.name ?? me.email ?? "local admin"}</span>
      </header>

      <section className="admin-card panel" aria-labelledby="people">
        <div className="admin-card-h">
          <h1 id="people">People</h1>
          <span className="sub2">{users.length} signed in so far. Admins can see and change everyone&apos;s work items.</span>
        </div>
        {users.length === 0 ? (
          <p className="sub2">Nobody has signed in yet. People appear here after their first sign-in.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Last seen</th>
                <th>Role</th>
                <th aria-label="Change role" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const pinned = isBootstrapAdmin(u.email);
                const role: Role = pinned ? "admin" : u.role;
                return (
                  <tr key={u.userKey}>
                    <td className="font-semibold text-[#f3f7ff]">{u.name}</td>
                    <td className="text-muted">{u.email ?? "–"}</td>
                    <td className="text-muted">{relativeTime(u.lastSeenAt)}</td>
                    <td>
                      <span className={`role-pill ${role}`}>{role === "admin" ? "Admin" : "User"}</span>
                      {pinned && <span className="sub2 ml-2 text-xs!">set by ADMIN_EMAIL</span>}
                    </td>
                    <td className="text-right">
                      {!pinned && u.userKey !== me.userKey && (
                        <form action={setRole}>
                          <input type="hidden" name="userKey" value={u.userKey} />
                          <input type="hidden" name="role" value={role === "admin" ? "user" : "admin"} />
                          <button className="pill sm">{role === "admin" ? "Make user" : "Make admin"}</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="admin-card panel" aria-labelledby="calls">
        <div className="admin-card-h">
          <h2 id="calls">Recent calls</h2>
          <span className="sub2">Connection time, tool calls and errors, newest first.</span>
        </div>
        {sessions.length === 0 ? (
          <p className="sub2">No calls recorded yet.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Engine</th>
                <th>Connect</th>
                <th>Tools</th>
                <th>Slowest tool</th>
                <th>Ended</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td className="text-muted">{relativeTime(s.startedAt)}</td>
                  <td>{s.userName ?? s.userKey.slice(0, 18)}</td>
                  <td>{s.engine ?? "–"}</td>
                  <td>{fmtMs(s.connectedMs)}</td>
                  <td>
                    {s.toolCalls}
                    {s.toolErrors > 0 && <span className="text-[#ff9aa5]"> · {s.toolErrors} failed</span>}
                  </td>
                  <td className={s.slowestToolMs && s.slowestToolMs > 8000 ? "text-[#ffb083]" : ""}>{fmtMs(s.slowestToolMs)}</td>
                  <td className={s.error ? "text-[#ff9aa5]" : "text-muted"} title={s.error ?? undefined}>
                    {s.error ? `Failed: ${s.error.slice(0, 60)}` : (s.endedBy ?? (s.endedAt ? "ended" : "in progress"))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
