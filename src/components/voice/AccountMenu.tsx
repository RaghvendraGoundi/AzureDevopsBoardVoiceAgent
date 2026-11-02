"use client";

import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "./icons";

interface SessionUser {
  name?: string | null;
  email?: string | null;
  role?: "user" | "admin";
  signedIn?: boolean;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** Who's signed in (Microsoft Entra ID), with Sign out. Hidden when sign-in isn't set up. */
export function AccountMenu({ disabled }: { disabled?: boolean }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me: SessionUser | null) => setUser(me?.signedIn ? me : null))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user?.name && !user?.email) return null;
  const name = user.name || user.email || "You";

  return (
    <div ref={ref} className="relative">
      <button className="acct" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" aria-label={`Account: ${name}`}>
        <span className="acct-av" aria-hidden>
          {initials(name)}
        </span>
        <span className="acct-name hidden lg:inline">{name.split(" ")[0]}</span>
        <ChevronDownIcon size={15} className="text-muted" />
      </button>
      {open && (
        <div className="acct-menu panel animate-rise" role="dialog" aria-label="Account">
          <p className="text-[14px] font-semibold text-[#f3f7ff]">{name}</p>
          {user.email && <p className="sub2 truncate">{user.email}</p>}
          <p className="sub2 mt-2 text-xs!">
            Signed in with Microsoft Entra ID · {user.role === "admin" ? "Admin" : "User"}
          </p>
          {user.role === "admin" && (
            <a className="pill sm mt-3 w-full" href="/admin">
              People and calls
            </a>
          )}
          <a className="pill sm mt-3 w-full" href="/diagnostics">
            Connection check
          </a>
          <button
            className="pill sm mt-3 w-full"
            disabled={disabled}
            title={disabled ? "End the call first" : undefined}
            onClick={() => void signOut({ redirectTo: "/signin" })}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
