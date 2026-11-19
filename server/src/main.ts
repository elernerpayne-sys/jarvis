/**
 * Starts Jarvis: `npm start` (node server/src/main.ts).
 * Settings come from the environment; see .env.example and README.md.
 */
import { loadConfig } from './config.ts'
import { createJarvis } from './server.ts'
import { log, logError } from './util.ts'

const config = loadConfig()
const jarvis = createJarvis(config)
const running = await jarvis.listen()

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  log(`${signal}: shutting down`)
  try {
    await running.close()
    log('stopped')
    process.exit(0)
  } catch (error) {
    logError('shutdown failed', error)
    process.exit(1)
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('unhandledRejection', (error) => logError('unhandled rejection', error))
