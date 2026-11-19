/**
 * A minimal Server-Sent Events reader. Feed it text as it arrives, in chunks
 * of any size; it calls `onData` once per complete event with the event's
 * `data` lines joined. Comments (heartbeats) and other fields are skipped.
 */
export interface SseParser {
  push(chunk: string): void
}

export function createSseParser(onData: (data: string) => void): SseParser {
  let buffer = ''
  let data: string[] = []
  /** The last chunk ended on "\r"; a "\n" at the start of the next one belongs to it. */
  let pendingLf = false

  function line(text: string) {
    if (text === '') {
      if (data.length > 0) {
        const joined = data.join('\n')
        data = []
        onData(joined)
      }
      return
    }
    if (text.startsWith(':')) return
    const colon = text.indexOf(':')
    const field = colon === -1 ? text : text.slice(0, colon)
    let value = colon === -1 ? '' : text.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data.push(value)
  }

  return {
    push(chunk) {
      const text = buffer + chunk
      let start = pendingLf && text.startsWith('\n') ? 1 : 0
      pendingLf = false
      for (let i = start; i < text.length; i += 1) {
        const char = text[i]
        if (char !== '\n' && char !== '\r') continue
        line(text.slice(start, i))
        if (char === '\r') {
          if (i + 1 === text.length) pendingLf = true
          else if (text[i + 1] === '\n') i += 1
        }
        start = i + 1
      }
      buffer = text.slice(start)
    },
  }
}
