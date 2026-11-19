import { useId, useState } from 'react'
import { Keyboard, Mic, MicOff } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Dot } from '@/components/ui/StatusDot'
import { Composer } from '@/features/voice/Composer'
import { useVoice } from '@/features/voice/context'
import { useOnline } from '@/features/voice/hooks'
import { VOICE_MESSAGE } from '@/features/voice/messages'
import { presenceOf } from '@/features/voice/presence'
import type { Presence } from '@/features/voice/presence'
import { TalkButton } from '@/features/voice/TalkButton'
import type { TalkLook } from '@/features/voice/TalkButton'
import { Transcript } from '@/features/voice/Transcript'
import { isAwaitingReply } from '@/features/voice/transcript'

const STATUS_LINE: Record<Presence, string> = {
  idle: 'Talk to Jarvis',
  connecting: 'Connecting…',
  listening: 'Listening',
  muted: 'You’re muted',
  speaking: 'Jarvis is speaking',
  chatting: 'Chatting with Jarvis',
}

/**
 * The hero of Home: the Talk button, what Jarvis is doing, the conversation
 * as it happens, and a way to type instead of speaking.
 */
export function TalkPanel() {
  const { controller, engine, reloadEngine, needsNetwork } = useVoice()
  const { status, mode, channel, transcript, muted, error } = controller
  const online = useOnline()
  const statusId = useId()
  const [wantsToType, setWantsToType] = useState(false)

  const presence = presenceOf(controller)
  const busy = status === 'connecting' || status === 'live'
  const inVoice = busy && channel === 'voice'
  const offline = needsNetwork && !online
  // Nothing new can start while the engine is missing or the network is gone;
  // a conversation that is already running is left alone.
  const blocked = !busy && (engine !== 'ready' || offline)

  let look: TalkLook = 'idle'
  if (blocked) look = 'off'
  else if (inVoice) look = status === 'connecting' ? 'connecting' : mode

  let statusLine = STATUS_LINE[presence]
  if (!busy && engine === 'loading') statusLine = 'Getting ready…'
  else if (!busy && offline) statusLine = VOICE_MESSAGE.offline

  const problem = engine === 'failed' ? VOICE_MESSAGE.engineFailed : status === 'error' ? error : null
  const hasTranscript = transcript.length > 0
  const showComposer = wantsToType || busy || hasTranscript
  const thinking = busy && mode === 'listening' && isAwaitingReply(transcript)

  return (
    <section aria-label="Talk to Jarvis" className="flex flex-col items-center text-center">
      <TalkButton
        look={look}
        pressed={inVoice}
        disabled={blocked}
        describedBy={statusId}
        getVolume={controller.getVolume}
        // A typed conversation is not what this button toggles: pressing it
        // then moves the conversation to voice.
        onPress={inVoice ? controller.stop : controller.startVoice}
      />

      <p id={statusId} aria-live="polite" className="mt-9 max-w-xs font-voice text-xl text-bone">
        {statusLine}
      </p>

      {/* One row of controls. Its height is kept so the page below stays put. */}
      <div className="mt-3 flex min-h-12 items-center justify-center gap-3">
        {status === 'live' && channel === 'voice' ? (
          <Button
            aria-pressed={muted}
            icon={muted ? <MicOff aria-hidden className="size-4" /> : <Mic aria-hidden className="size-4" />}
            onClick={() => controller.setMuted(!muted)}
            className="min-w-28"
          >
            {muted ? 'Unmute' : 'Mute'}
          </Button>
        ) : null}
        {status === 'live' ? (
          <Button onClick={controller.stop} className="min-w-28">
            End
          </Button>
        ) : null}
        {!busy && !showComposer ? (
          <Button
            variant="ghost"
            icon={<Keyboard aria-hidden className="size-4" />}
            onClick={() => setWantsToType(true)}
          >
            Type instead
          </Button>
        ) : null}
        {!busy && hasTranscript ? (
          <Button variant="ghost" onClick={controller.clear}>
            Clear
          </Button>
        ) : null}
      </div>

      {problem ? (
        <div className="mt-3 flex max-w-sm flex-col items-center gap-3">
          <p role="alert" className="flex items-baseline gap-2.5 text-left text-base text-ash">
            <Dot tone="bad" className="translate-y-[-0.125rem]" />
            <span>{problem}</span>
          </p>
          <Button onClick={engine === 'failed' ? reloadEngine : controller.retry}>Try again</Button>
        </div>
      ) : null}

      {hasTranscript ? (
        <Transcript lines={transcript} thinking={thinking} className="mt-6 w-full max-w-md" />
      ) : null}

      {showComposer ? (
        <Composer
          // Asked for by pressing "Type instead": put the cursor straight in.
          autoFocus={wantsToType}
          canSend={engine === 'ready' && !offline && status !== 'connecting'}
          onSend={controller.sendText}
          onTyping={controller.typing}
          className="mt-5 w-full max-w-md"
        />
      ) : null}
    </section>
  )
}
