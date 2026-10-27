/** Messages between the main process and the voice utility process. */

export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
/**
 * q4 (40 MB) synthesizes 4x faster than real time on the target CPU, as fast as fp32 (326 MB).
 * q8 is 1.3x slower than real time. fp16 must not be used: it returns all-NaN audio for some
 * sentences on CPU.
 */
export const KOKORO_DTYPE = 'q4'
export const WHISPER_MODEL_ID = 'onnx-community/whisper-base.en'
export const WHISPER_DTYPE = 'q8'

export type VoiceHostRequest =
  | { type: 'prepare'; id: string; cacheDir: string }
  | { type: 'transcribe'; id: string; pcm16k: Float32Array }
  | { type: 'speak'; id: string; text: string; voice: string }
  | { type: 'cancel'; id: string }

export type VoiceHostReply =
  | { type: 'progress'; id: string; progress: number }
  | { type: 'chunk'; id: string; index: number; sampleRate: number; samples: Float32Array }
  | { type: 'done'; id: string; text?: string }
  | { type: 'error'; id: string; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

export function isVoiceHostRequest(value: unknown): value is VoiceHostRequest {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return false
  }
  switch (value.type) {
    case 'prepare':
      return typeof value.cacheDir === 'string'
    case 'transcribe':
      return value.pcm16k instanceof Float32Array
    case 'speak':
      return typeof value.text === 'string' && typeof value.voice === 'string'
    case 'cancel':
      return true
    default:
      return false
  }
}

export function isVoiceHostReply(value: unknown): value is VoiceHostReply {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return false
  }
  switch (value.type) {
    case 'progress':
      return true
    case 'chunk':
      return value.samples instanceof Float32Array && typeof value.sampleRate === 'number'
    case 'done':
      return value.text === undefined || typeof value.text === 'string'
    case 'error':
      return typeof value.message === 'string'
    default:
      return false
  }
}
