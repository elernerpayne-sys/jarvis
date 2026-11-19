/**
 * Serves the built app (dist/) from the same origin as the API.
 *
 * - /assets/* and other content-hashed files: cached for a year, immutable.
 * - sw.js, index.html, the manifest and registerSW.js: always revalidated,
 *   so a new deploy reaches the phone on its next open.
 * - Any other path without a file extension gets index.html (client-side routes).
 * - gzip or brotli for text files when the browser accepts it.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt', '.map'])
const NO_CACHE = new Set(['/sw.js', '/index.html', '/manifest.webmanifest', '/registerSW.js'])
const HASHED = /[-.][A-Za-z0-9_]{8,}\.(js|css|woff2?|png|svg)$/

function cacheControl(path: string): string {
  if (NO_CACHE.has(path)) return 'no-cache'
  if (path.startsWith('/assets/') || HASHED.test(path)) return 'public, max-age=31536000, immutable'
  return 'public, max-age=3600'
}

interface Packed {
  raw: Buffer
  gzip?: Buffer
  br?: Buffer
  mtime: number
}

export function createStatic(root: string) {
  const base = resolve(root)
  const cache = new Map<string, Packed>()

  function locate(urlPath: string): string | null {
    let decoded: string
    try {
      decoded = decodeURIComponent(urlPath)
    } catch {
      return null
    }
    if (decoded.includes('\0')) return null
    const file = normalize(join(base, decoded))
    if (file !== base && !file.startsWith(base + sep)) return null
    try {
      return statSync(file).isFile() ? file : null
    } catch {
      return null
    }
  }

  async function pack(file: string, ext: string): Promise<Packed> {
    const mtime = statSync(file).mtimeMs
    const hit = cache.get(file)
    if (hit && hit.mtime === mtime) return hit
    const raw = await readFile(file)
    const packed: Packed = { raw, mtime }
    if (COMPRESSIBLE.has(ext) && raw.length > 1024) {
      packed.gzip = gzipSync(raw, { level: 9 })
      packed.br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
    }
    cache.set(file, packed)
    return packed
  }

  async function sendFile(req: IncomingMessage, res: ServerResponse, file: string, urlPath: string, headers: Record<string, string>) {
    const ext = extname(file).toLowerCase()
    const type = TYPES[ext] ?? 'application/octet-stream'
    const common = { ...headers, 'Content-Type': type, 'Cache-Control': cacheControl(urlPath), Vary: 'Accept-Encoding' }
    const size = statSync(file).size
    if (size > 5 * 1024 * 1024) {
      res.writeHead(200, { ...common, 'Content-Length': size })
      if (req.method === 'HEAD') return void res.end()
      createReadStream(file).pipe(res)
      return
    }
    const packed = await pack(file, ext)
    const accept = String(req.headers['accept-encoding'] ?? '')
    let body = packed.raw
    let encoding: string | null = null
    if (packed.br && /\bbr\b/.test(accept)) {
      body = packed.br
      encoding = 'br'
    } else if (packed.gzip && /\bgzip\b/.test(accept)) {
      body = packed.gzip
      encoding = 'gzip'
    }
    res.writeHead(200, { ...common, 'Content-Length': body.length, ...(encoding ? { 'Content-Encoding': encoding } : {}) })
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  /** True when it answered (a file, the app shell, or a 404 for a missing file). */
  async function serve(req: IncomingMessage, res: ServerResponse, urlPath: string, headers: Record<string, string>): Promise<boolean> {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false
    const path = urlPath === '/' ? '/index.html' : urlPath
    const file = locate(path)
    if (file) {
      await sendFile(req, res, file, path, headers)
      return true
    }
    if (extname(path) !== '') {
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' })
      res.end('Not found')
      return true
    }
    const index = join(base, 'index.html')
    if (!existsSync(index)) {
      res.writeHead(503, { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' })
      res.end('The Jarvis app has not been built yet. Run: VITE_JARVIS_API_URL=same-origin npm run build')
      return true
    }
    await sendFile(req, res, index, '/index.html', headers)
    return true
  }

  return { serve }
}
