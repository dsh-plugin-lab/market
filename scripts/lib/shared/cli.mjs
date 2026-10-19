import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** The repository root, resolved from this file. Every other path is derived from it, never from cwd. */
export const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

export const info = (message) => console.log(`  [INFO] ${message}`)
export const ok = (message) => console.log(`  [OK]   ${message}`)
export const warn = (message) => console.log(`  [WARN] ${message}`)

/**
 * A fatal condition: the inputs are wrong and no degraded output is honest. Callers throw, the entry
 * point turns it into exit code 1. Anything that *can* be degraded must not use this.
 */
export class FatalError extends Error {
  constructor(message) {
    super(message)
    this.name = 'FatalError'
  }
}

export const fail = (message) => {
  throw new FatalError(message)
}

/** `--name value` from argv. */
export function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

export const hasFlag = (name) => process.argv.includes(`--${name}`)

/**
 * The one place an entry point reports a fatal failure, so every command exits with the same shape.
 * `main().catch(reportFatal)` ends all four scripts.
 */
export function reportFatal(error) {
  console.error(`  [ERR]  ${error.message}`)
  process.exitCode = 1
}
