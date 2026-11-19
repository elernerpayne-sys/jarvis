import { describe, expect, it } from 'vitest'

import { parseRepo } from '@/features/settings/repos'

const existing = ['acme/booking-site']

describe('parseRepo', () => {
  it('accepts owner/name in GitHub’s characters', () => {
    expect(parseRepo('acme/shop-tools', existing)).toEqual({ ok: true, repo: 'acme/shop-tools' })
    expect(parseRepo('  my-org2/Repo_name.js  ', existing)).toEqual({ ok: true, repo: 'my-org2/Repo_name.js' })
  })

  it('takes the repo out of a pasted GitHub link', () => {
    expect(parseRepo('https://github.com/acme/shop-tools', existing)).toEqual({ ok: true, repo: 'acme/shop-tools' })
    expect(parseRepo('github.com/acme/shop-tools.git', existing)).toEqual({ ok: true, repo: 'acme/shop-tools' })
    expect(parseRepo('https://github.com/acme/shop-tools/', existing)).toEqual({ ok: true, repo: 'acme/shop-tools' })
  })

  it('rejects anything that is not owner/name', () => {
    const bad = ['', 'acme', 'acme/', '/site', 'acme/site/extra', 'ac me/site', '-acme/site', 'acme-/site', 'ac--me/site', 'acme/si te', 'acme/..', 'acme/site?x=1']
    for (const input of bad) {
      expect(parseRepo(input, existing), input).toMatchObject({ ok: false })
    }
  })

  it('rejects a repo that is already listed, whatever the capitals', () => {
    const result = parseRepo('ACME/Booking-Site', existing)
    expect(result).toMatchObject({ ok: false })
    expect(result.ok ? '' : result.error).toMatch(/already on the list/)
  })
})
