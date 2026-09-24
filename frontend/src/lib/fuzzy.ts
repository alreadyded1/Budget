/** Typeahead matching for payees, categories and accounts, done in memory (SPEC §7).
 *
 * Small on purpose: an exact name beats a prefix, a prefix beats a word start, a word
 * start beats a substring, and a scattered subsequence ("krgr" → "Kroger") comes last.
 */

export function fuzzyScore(query: string, label: string): number | null {
  const needle = query.trim().toLowerCase()
  const haystack = label.toLowerCase()
  if (needle === '') return 0
  if (haystack === needle) return 1000
  if (haystack.startsWith(needle)) return 800 - (haystack.length - needle.length)

  const words = haystack.split(/[\s\-_/:&.]+/)
  if (words.some((word) => word.startsWith(needle))) return 600 - haystack.length

  const at = haystack.indexOf(needle)
  if (at >= 0) return 400 - at

  // Subsequence: every character in order, fewer gaps scoring higher.
  let position = -1
  let gaps = 0
  for (const char of needle) {
    if (char === ' ') continue
    const next = haystack.indexOf(char, position + 1)
    if (next < 0) return null
    if (position >= 0) gaps += next - position - 1
    position = next
  }
  return 200 - gaps
}

/** Filters and orders items by how well `query` matches, keeping the input order on ties. */
export function fuzzyFilter<T>(items: T[], query: string, labelOf: (item: T) => string): T[] {
  if (query.trim() === '') return items
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, labelOf(item)) }))
    .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item)
}
