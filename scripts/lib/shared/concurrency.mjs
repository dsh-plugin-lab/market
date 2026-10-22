/**
 * Concurrency, without a dependency and without reordering.
 *
 * The build fetches several plugins at once, and the index must list them in roster order rather than
 * in the order responses arrived — a document, not a transcript of the network. `Promise.all` alone
 * loses that guarantee the moment a limit is involved, so it is kept here, once, instead of being
 * reimplemented by whoever needs it next.
 */

/**
 * Run `worker` over `items`, `limit` at a time, keeping result order aligned with input order.
 *
 * `limit` workers are started and each pulls the next index when it finishes, so a slow item does not
 * block the others; `results[i]` is always the result for `items[i]`.
 */
export async function mapLimit(items, limit, worker) {
  const results = []
  let next = 0
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (next < items.length) {
        const index = next
        next += 1
        results[index] = await worker(items[index], index)
      }
    }),
  )
  return results
}
