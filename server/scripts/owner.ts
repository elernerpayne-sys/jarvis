/**
 * Creates the one owner, or changes the owner's email and password.
 *
 *   npm run owner -- --email you@example.com               (asks for the password)
 *   npm run owner -- --email you@example.com --password …  (for scripts)
 *
 * Changing the password signs out every device. Uses DATA_DIR like the server.
 */
import { stdin, stdout } from 'node:process'
import { parseArgs } from 'node:util'

import { createAuth } from '../src/auth.ts'
import { createBus } from '../src/bus.ts'
import { loadConfig } from '../src/config.ts'
import { openDb } from '../src/db.ts'
import { createStore } from '../src/store.ts'

const { values } = parseArgs({
  options: { email: { type: 'string' }, password: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
})

const USAGE = 'Usage: npm run owner -- --email you@example.com [--password "…"]'
if (values.help) {
  console.log(USAGE)
  process.exit(0)
}
const email = values.email?.trim() ?? ''
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(USAGE)
  console.error(email ? 'That doesn’t look like an email address.' : 'Missing --email.')
  process.exit(2)
}

/** Reads a line without echoing it. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      // Piped in: read the first line.
      let data = ''
      stdin.setEncoding('utf8')
      stdin.on('data', (chunk) => (data += chunk))
      stdin.on('end', () => resolve(data.split(/\r?\n/)[0] ?? ''))
      stdin.on('error', reject)
      return
    }
    stdout.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let input = ''
    const onData = (char: string) => {
      for (const c of char) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          stdout.write('\n')
          resolve(input)
          return
        }
        if (c === '\u0003') {
          stdout.write('\n')
          process.exit(130)
        }
        if (c === '\u007f' || c === '\b') input = input.slice(0, -1)
        else input += c
      }
    }
    stdin.on('data', onData)
  })
}

let password = values.password ?? ''
if (!password) {
  password = await askHidden('Password (at least 10 characters): ')
  if (stdin.isTTY) {
    const again = await askHidden('Same password again: ')
    if (again !== password) {
      console.error('The two passwords don’t match. Nothing was changed.')
      process.exit(1)
    }
  }
}
if (password.length < 10) {
  console.error('Use a password of at least 10 characters. Nothing was changed.')
  process.exit(1)
}

const config = loadConfig()
const db = openDb(config.dataDir)
const auth = createAuth(db)
const { owner, created } = await auth.setOwner(email, password)
createStore(db, createBus()).ensureSettings(owner.id)
auth.stop()
db.close()
console.log(created ? `Owner created: ${owner.email}. You can sign in now.` : `Owner updated: ${owner.email}. Every device was signed out.`)
