/**
 * A loudness meter on the owner's real microphone, so the demo's Talk ring
 * responds to them while Jarvis "listens". Nothing is recorded or sent
 * anywhere: the audio goes into an analyser and stops there.
 */

export interface MicMeter {
  /** 0 to 1, on the same scale the ElevenLabs SDK reports. */
  level(): number
  /** Releases the microphone. */
  stop(): void
}

/** The band where speech carries its energy. */
const VOICE_BAND_HZ = { from: 100, to: 4000 }

/**
 * Asks for the microphone. Resolves with null when the browser has none,
 * the page is not secure, or the owner says no: the demo carries on with a
 * made-up level instead.
 */
export async function openMicMeter(): Promise<MicMeter | null> {
  const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
  if (!devices?.getUserMedia || typeof AudioContext === 'undefined') return null

  let stream: MediaStream
  try {
    stream = await devices.getUserMedia({ audio: true })
  } catch {
    return null
  }
  const release = () => stream.getTracks().forEach((track) => track.stop())

  try {
    const context = new AudioContext()
    // Created after an await, so some browsers start it suspended.
    void context.resume().catch(() => {})
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.5
    context.createMediaStreamSource(stream).connect(analyser)

    const bins = new Uint8Array(analyser.frequencyBinCount)
    const hzPerBin = context.sampleRate / analyser.fftSize
    const from = Math.max(1, Math.floor(VOICE_BAND_HZ.from / hzPerBin))
    const to = Math.min(bins.length, Math.ceil(VOICE_BAND_HZ.to / hzPerBin))

    return {
      level() {
        analyser.getByteFrequencyData(bins)
        let sum = 0
        for (let index = from; index < to; index += 1) sum += bins[index] ?? 0
        return to > from ? sum / ((to - from) * 255) : 0
      },
      stop() {
        release()
        void context.close().catch(() => {})
      },
    }
  } catch {
    release()
    return null
  }
}
