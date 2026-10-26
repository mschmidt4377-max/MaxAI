import type { KokoroVoiceId, VoiceEngineId } from '../domain/voiceSettings'

export interface VoiceModelProgress {
  file: string | null
  /** 0..1 while a file downloads, null while a cached file loads. */
  progress: number | null
}

export interface VoiceAudioChunk {
  index: number
  sampleRate: number
  samples: Float32Array
}

/** Speech in and speech out. The local engine and a later OpenAI Realtime engine both fit it. */
export interface VoiceEngine {
  readonly id: VoiceEngineId
  /** Loads the models. Safe to call again after the engine reported it became unavailable. */
  prepare(onProgress: (progress: VoiceModelProgress) => void): Promise<void>
  transcribe(pcm16k: Float32Array): Promise<string>
  /** Yields one chunk per sentence. Aborting stops generation after the current sentence. */
  speak(text: string, voice: KokoroVoiceId, signal: AbortSignal): AsyncIterable<VoiceAudioChunk>
  /** Fires when loaded models are lost, for example when the engine process exits. */
  onUnavailable(listener: (reason: string) => void): () => void
  dispose(): Promise<void>
}
