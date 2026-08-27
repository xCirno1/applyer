import { sql, type AnyColumn, type SQL } from 'drizzle-orm'

/**
 * Backslash is the escape character the `ESCAPE` clause below declares.
 * SQLite has no default one: without an explicit `ESCAPE`, a backslash in a
 * `LIKE` pattern is just an ordinary character, so `%` and `_` in a user's
 * search term stay wildcards no matter how they were pre-escaped.
 */
const LIKE_ESCAPE_CHAR = '\\'

/**
 * Escapes the characters `LIKE` treats specially so a search term matches
 * itself literally. The escape character has to be escaped first, otherwise
 * the backslashes this adds for `%`/`_` would themselves be escaped.
 */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `${LIKE_ESCAPE_CHAR}${char}`)
}

/**
 * `column LIKE '%term%' ESCAPE '\'` — a case-insensitive substring match on
 * a user-supplied term, with `%`/`_`/`\` in that term matched literally.
 *
 * Built through `sql` rather than drizzle's `like()` because `like()` emits
 * no `ESCAPE` clause and offers no way to add one.
 */
export function likeContains(column: AnyColumn, term: string): SQL {
  return sql`${column} LIKE ${`%${escapeLikeTerm(term)}%`} ESCAPE ${LIKE_ESCAPE_CHAR}`
}
