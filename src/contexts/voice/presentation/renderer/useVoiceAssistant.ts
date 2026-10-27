import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import {
  isModifierCode,
  resolveCommandKeybinding,
  type KeyChord,
} from '@contexts/settings/domain/keybindings'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import type { VoiceEngineStatus } from '@shared/contracts/dto'
import {
  createVoiceTurnController,
  type VoiceTurnController,
} from '../../application/voiceTurnController'
import { IDLE_VOICE_TURN, type VoiceTurnState } from '../../domain/voiceTurn'
import { askBoss, listVoiceBossAgents, type VoiceBossAgent } from './bossChannel'
import { createMicRecorder } from './micRecorder'
import { createSpeechPlayer } from './speechPlayer'
import { getPlatform, getVoiceBridge } from './voiceApi'

export interface VoiceAssistantView {
  enabled: boolean
  turn: VoiceTurnState
  engine: VoiceEngineStatus
}

function findBoss(bossNodeId: string | null): VoiceBossAgent | null {
  if (!bossNodeId) {
    return null
  }
  const agents = listVoiceBossAgents(useAppStore.getState().workspaces)
  return agents.find(agent => agent.nodeId === bossNodeId) ?? null
}

function matchesChord(event: KeyboardEvent, chord: KeyChord): boolean {
  return (
    event.code === chord.code &&
    event.altKey === chord.altKey &&
    event.ctrlKey === chord.ctrlKey &&
    event.metaKey === chord.metaKey &&
    event.shiftKey === chord.shiftKey
  )
}

/** True once any key of the chord is up: its main key, or a modifier it needs. */
function releasesChord(event: KeyboardEvent, chord: KeyChord): boolean {
  if (event.code === chord.code) {
    return true
  }
  if (!isModifierCode(event.code)) {
    return false
  }
  return (
    (chord.altKey && !event.altKey) ||
    (chord.ctrlKey && !event.ctrlKey) ||
    (chord.metaKey && !event.metaKey) ||
    (chord.shiftKey && !event.shiftKey)
  )
}

/**
 * Push-to-talk. Owns its own keydown/keyup tracking because the shared shortcut dispatchers only
 * see keydown. It also runs while a terminal has focus: talking to the boss from a terminal is the
 * main use, so `disableAppShortcutsWhenTerminalFocused` does not apply.
 */
export function useVoiceAssistant(
  settings: Pick<AgentSettings, 'voice' | 'keybindings'>,
): VoiceAssistantView {
  const bridge = useMemo(() => getVoiceBridge(), [])
  const enabled = settings.voice.enabled && bridge !== null
  const voiceRef = useRef(settings.voice)
  voiceRef.current = settings.voice

  const [turn, setTurn] = useState<VoiceTurnState>(IDLE_VOICE_TURN)
  const [engine, setEngine] = useState<VoiceEngineStatus>({ state: 'idle' })
  const [controller, setController] = useState<VoiceTurnController | null>(null)

  const chord = useMemo(
    () =>
      resolveCommandKeybinding({
        commandId: 'voice.pushToTalk',
        overrides: settings.keybindings,
        platform: getPlatform(),
      }),
    [settings.keybindings],
  )

  useEffect(() => {
    if (!enabled || !bridge) {
      return
    }
    let disposed = false
    const stopStatus = bridge.onStatus(setEngine)
    void bridge.getStatus().then(status => {
      if (!disposed) {
        setEngine(status)
      }
    })
    // Load the models as soon as voice is on, so the first press does not wait for them.
    bridge.prepare().catch(() => {})
    return () => {
      disposed = true
      stopStatus()
    }
  }, [bridge, enabled])

  useEffect(() => {
    if (!enabled || !bridge) {
      return
    }
    const recorder = createMicRecorder()
    const hub = getPtyEventHub()
    const next = createVoiceTurnController({
      startRecording: () => recorder.start(),
      stopRecording: () => recorder.stop(),
      cancelRecording: () => recorder.cancel(),
      transcribe: async pcm16k => (await bridge.transcribe({ pcm16k })).text,
      askBoss: (prompt, signal, onSent) => {
        const boss = findBoss(voiceRef.current.bossNodeId)
        if (!boss) {
          return Promise.reject(new Error('The boss agent is gone.'))
        }
        return askBoss(boss, prompt, signal, onSent, {
          onSessionState: (sessionId, listener) => hub.onSessionState(sessionId, listener),
          onSessionExit: (sessionId, listener) => hub.onSessionExit(sessionId, () => listener()),
        })
      },
      speak: (text, signal) => speakReply(bridge, text, voiceRef.current.voice, signal),
      hasBoss: () => findBoss(voiceRef.current.bossNodeId) !== null,
      shouldSpeakReplies: () => voiceRef.current.speakReplies,
      createTurnId: () => crypto.randomUUID(),
      now: () => performance.now(),
    })
    const stopTurn = next.subscribe(setTurn)
    setController(next)
    return () => {
      stopTurn()
      next.dispose()
      setController(null)
      setTurn(IDLE_VOICE_TURN)
    }
  }, [bridge, enabled])

  useEffect(() => {
    if (!controller || !chord) {
      return
    }
    let held = false

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || !matchesChord(event, chord)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat && !held) {
        held = true
        controller.press()
      }
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (!held || !releasesChord(event, chord)) {
        return
      }
      held = false
      if (event.code === chord.code) {
        event.preventDefault()
        event.stopPropagation()
      }
      controller.release()
    }
    const onBlur = (): void => {
      if (held) {
        held = false
        controller.blur()
      }
    }

    document.addEventListener('keydown', onKeyDown, { capture: true })
    document.addEventListener('keyup', onKeyUp, { capture: true })
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('keydown', onKeyDown, { capture: true })
      document.removeEventListener('keyup', onKeyUp, { capture: true })
      window.removeEventListener('blur', onBlur)
    }
  }, [chord, controller])

  return { enabled, turn, engine }
}

type VoiceBridge = NonNullable<ReturnType<typeof getVoiceBridge>>

async function speakReply(
  bridge: VoiceBridge,
  text: string,
  voice: string,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return
  }
  const requestId = crypto.randomUUID()
  const player = createSpeechPlayer()
  const stopChunks = bridge.onSpeakChunk(chunk => {
    if (chunk.requestId === requestId) {
      player.enqueue(chunk)
    }
  })
  const onAbort = (): void => {
    player.stop()
    void bridge.cancelSpeak({ requestId }).catch(() => {})
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    await bridge.speak({ requestId, text, voice })
    await player.drain()
  } finally {
    signal.removeEventListener('abort', onAbort)
    stopChunks()
    player.stop()
  }
}
