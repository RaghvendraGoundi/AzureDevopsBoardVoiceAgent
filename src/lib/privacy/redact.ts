/**
 * Keeps email addresses away from the model. Tool output going to the model
 * has every email replaced with a stable alias (person-3@redacted.invalid);
 * tool arguments coming back have aliases swapped for the real address, so
 * "assign it to that person" still works. The screen gets the real values
 * (UI events aren't redacted), and the alias map goes to the browser so any
 * alias the assistant repeats is shown as the real address there.
 *
 * Aliases are per user and stable for the life of the server process.
 */

const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const ALIAS = /person-\d+@redacted\.invalid/g;
const isAlias = (s: string) => /^person-\d+@redacted\.invalid$/.test(s);

const MAX_ALIASES = 5_000;

export class AliasBook {
  private toAlias = new Map<string, string>();
  private toReal = new Map<string, string>();

  alias(email: string): string {
    if (isAlias(email)) return email;
    const key = email.toLowerCase();
    let alias = this.toAlias.get(key);
    if (!alias) {
      alias = `person-${this.toAlias.size + 1}@redacted.invalid`;
      if (this.toAlias.size < MAX_ALIASES) {
        this.toAlias.set(key, alias);
        this.toReal.set(alias, email);
      }
    }
    return alias;
  }

  real(alias: string): string | undefined {
    return this.toReal.get(alias.toLowerCase());
  }
}

const globalForAliases = globalThis as unknown as { __aliasBooks?: Map<string, AliasBook> };

export function aliasBookFor(userKey: string): AliasBook {
  const books = (globalForAliases.__aliasBooks ??= new Map());
  let book = books.get(userKey);
  if (!book) {
    book = new AliasBook();
    books.set(userKey, book);
  }
  return book;
}

function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, mapStrings(v, fn)]));
  }
  return value;
}

/** A copy of `value` with every email replaced by its alias, and the aliases used (alias → real). */
export function redactForModel<T>(value: T, book: AliasBook): { value: T; aliases: Record<string, string> } {
  const aliases: Record<string, string> = {};
  const out = mapStrings(value, (s) =>
    s.replace(EMAIL, (email) => {
      if (isAlias(email)) return email;
      const alias = book.alias(email);
      aliases[alias] = email;
      return alias;
    }),
  ) as T;
  return { value: out, aliases };
}

/** A copy of tool arguments with aliases swapped back for the real addresses. */
export function unaliasArgs<T>(value: T, book: AliasBook): T {
  return mapStrings(value, (s) => s.replace(ALIAS, (alias) => book.real(alias) ?? alias)) as T;
}

/** Browser side: shows the real address wherever the assistant repeated an alias. */
export function unaliasText(text: string, aliases: Record<string, string>): string {
  return text.replace(ALIAS, (alias) => aliases[alias] ?? "someone");
}
