/** Shared tag hygiene for the curator agents. */

/** Dedupe a list of strings, trimming and dropping empties (order preserved). */
export function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

/**
 * Normalize model-supplied tags: lowercase, length-bound, fold in up to two
 * words from the originating query, dedupe, and cap at five.
 */
export function normalizeTags(tags: string[] | undefined, query?: string): string[] {
  const base = (tags ?? [])
    .map((t) => t.toLowerCase().trim())
    .filter((t) => t.length >= 2 && t.length <= 24);
  const queryWords = (query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 2);
  return dedupeStrings([...base, ...queryWords]).slice(0, 5);
}
