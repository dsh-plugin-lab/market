/**
 * Content identity.
 *
 * One function, used by the build (to publish `status.json.content.hash`) and by the deployment
 * verifier (to judge what a reader actually received). Two implementations would be two chances to
 * disagree about the same bytes, and the disagreement would look exactly like a failed deployment.
 */

import { createHash } from 'node:crypto'

/**
 * The digest of a document, in the shape `status.json` publishes.
 *
 * Takes `Buffer | string` and hashes the **exact bytes** — including the trailing newline the build
 * writes. That is the whole point: a reader hashes what it received, so any transformation between
 * "serialise" and "hash" (pretty-printing differences, re-encoding) would make the identity meaningless.
 */
export function digestOf(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}
