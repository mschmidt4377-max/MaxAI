/** Model loading state of the voice engine, owned by the main process. */
export type VoiceEngineStatus =
  | { state: 'idle' }
  /** progress is 0..1 for the file being downloaded, or null while loading from cache. */
  | { state: 'loading'; file: string | null; progress: number | null }
  | { state: 'ready' }
  | { state: 'error'; message: string }

export interface VoiceTranscribeInput {
  /** Mono PCM at 16 kHz, samples in -1..1. */
  pcm16k: Float32Array
}

export interface VoiceTranscribeResult {
  text: string
}

export interface VoiceSpeakInput {
  /** Chosen by the renderer so it can match chunk events and cancel. */
  requestId: string
  text: string
  voice: string
}

export interface VoiceSpeakResult {
  chunkCount: number
  cancelled: boolean
}

export interface VoiceCancelSpeakInput {
  requestId: string
}

/** One sentence of speech, pushed to the renderer that asked for it, in order. */
export interface VoiceSpeakChunkEvent {
  requestId: string
  index: number
  sampleRate: number
  samples: Float32Array
}
