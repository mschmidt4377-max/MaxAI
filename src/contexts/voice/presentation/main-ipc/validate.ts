import type {
  VoiceCancelSpeakInput,
  VoiceSpeakInput,
  VoiceTranscribeInput,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import { KOKORO_VOICE_IDS, type KokoroVoiceId } from '../../domain/voiceSettings'

/** Two minutes of 16 kHz audio; push-to-talk requests are far shorter. */
export const MAX_TRANSCRIBE_SAMPLES = 16_000 * 120
export const MAX_SPEAK_TEXT_CHARS = 4_000
const MAX_REQUEST_ID_CHARS = 128

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function invalid(debugMessage: string): never {
  throw createAppError('common.invalid_input', { debugMessage })
}

function normalizeRequestId(value: unknown, channel: string): string {
  const requestId = typeof value === 'string' ? value.trim() : ''
  if (requestId.length === 0 || requestId.length > MAX_REQUEST_ID_CHARS) {
    invalid(`${channel} requires a requestId of 1-${MAX_REQUEST_ID_CHARS} characters`)
  }
  return requestId
}

export function normalizeVoiceTranscribePayload(payload: unknown): VoiceTranscribeInput {
  if (!isRecord(payload) || !(payload.pcm16k instanceof Float32Array)) {
    invalid('voice:transcribe requires pcm16k as a Float32Array')
  }
  const { pcm16k } = payload
  if (pcm16k.length === 0 || pcm16k.length > MAX_TRANSCRIBE_SAMPLES) {
    invalid(`voice:transcribe pcm16k must hold 1-${MAX_TRANSCRIBE_SAMPLES} samples`)
  }
  return { pcm16k }
}

export function normalizeVoiceSpeakPayload(
  payload: unknown,
): VoiceSpeakInput & { voice: KokoroVoiceId } {
  if (!isRecord(payload)) {
    invalid('voice:speak payload must be an object')
  }
  const requestId = normalizeRequestId(payload.requestId, 'voice:speak')
  const text = typeof payload.text === 'string' ? payload.text.trim() : ''
  if (text.length === 0 || text.length > MAX_SPEAK_TEXT_CHARS) {
    invalid(`voice:speak text must be 1-${MAX_SPEAK_TEXT_CHARS} characters`)
  }
  const voice = KOKORO_VOICE_IDS.find(id => id === payload.voice)
  if (!voice) {
    invalid('voice:speak voice must be a known Kokoro voice id')
  }
  return { requestId, text, voice }
}

export function normalizeVoiceCancelSpeakPayload(payload: unknown): VoiceCancelSpeakInput {
  if (!isRecord(payload)) {
    invalid('voice:cancel-speak payload must be an object')
  }
  return { requestId: normalizeRequestId(payload.requestId, 'voice:cancel-speak') }
}
