"use client";

import { unaliasText } from "./redact";

/** Aliases seen in this browser tab (alias → real address), from tool responses. */
const seen: Record<string, string> = {};

export function rememberAliases(aliases: Record<string, string> | undefined) {
  if (aliases) Object.assign(seen, aliases);
}

/** What the assistant said, with any email alias shown as the real address. */
export const showAliases = (text: string) => (text.includes("@redacted.invalid") ? unaliasText(text, seen) : text);
