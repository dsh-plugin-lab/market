/**
 * The index document itself, as a value.
 *
 * Format 1 has exactly four top-level members that this build emits: `format`, `title`, an optional
 * `description`, `metadata`, and `plugins`. Keeping that shape in one function means the contract walk
 * (`findUndefinedMembers`) has one thing to check, and the entry point has nothing left to remember.
 */

/** The document, without validating it — validation is the contract module's job. */
export function marketIndex({ market, metadata, plugins }) {
  return {
    format: 1,
    title: market.title,
    ...(market.description === undefined ? {} : { description: market.description }),
    metadata,
    plugins,
  }
}
