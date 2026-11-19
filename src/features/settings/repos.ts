/**
 * Checking a repo before it goes on the allowed list. Jarvis only ever
 * receives "owner/name", so that is the one shape accepted here.
 */

export type RepoResult = { ok: true; repo: string } | { ok: false; error: string }

// GitHub's own rules: an owner is letters, digits and single hyphens (39 at
// most, no hyphen at either end); a repo name also allows dots and underscores.
const OWNER = /^[A-Za-z\d](?:[A-Za-z\d-]{0,37}[A-Za-z\d])?$/
const NAME = /^[\w.-]{1,100}$/

/** A pasted GitHub link is fine: keep just the "owner/name" part of it. */
function stripGithubUrl(text: string): string {
  return text
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
}

/** Validates what was typed against the list it would join. */
export function parseRepo(input: string, existing: readonly string[]): RepoResult {
  const text = stripGithubUrl(input.trim())
  if (text === '') return { ok: false, error: 'Type the repo as owner/name.' }

  const [owner, name, ...rest] = text.split('/')
  const valid =
    rest.length === 0 &&
    owner !== undefined &&
    name !== undefined &&
    OWNER.test(owner) &&
    !owner.includes('--') &&
    NAME.test(name) &&
    name !== '.' &&
    name !== '..'
  if (!valid) {
    return { ok: false, error: 'That doesn’t look like a repo. Use owner/name, like acme/website.' }
  }

  const repo = `${owner}/${name}`
  if (existing.some((item) => item.toLowerCase() === repo.toLowerCase())) {
    return { ok: false, error: `${repo} is already on the list.` }
  }
  return { ok: true, repo }
}
