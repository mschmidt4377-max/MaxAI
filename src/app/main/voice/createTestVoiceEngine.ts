import type { VoiceAudioChunk, VoiceEngine } from '../../../contexts/voice/application/VoiceEngine'
import { chunkForSpeech } from '../../../contexts/voice/domain/voiceText'

const STUB_SAMPLE_RATE = 24_000

declare global {
  // eslint-disable-next-line no-var -- read by E2E tests through electronApp.evaluate
  var __opencoveTestVoiceSpoken: string[] | undefined
}

/** E2E only: hears a fixed transcript and "speaks" a short silent chunk per sentence. */
export function isTestVoiceEngineRequested(): boolean {
  return process.env.NODE_ENV === 'test' && process.env['OPENCOVE_TEST_VOICE_ENGINE'] === 'stub'
}

export function createTestVoiceEngine(): VoiceEngine {
  const spoken: string[] = []
  globalThis.__opencoveTestVoiceSpoken = spoken
  const transcript = process.env['OPENCOVE_TEST_VOICE_TRANSCRIPT'] ?? 'list the agents'

  return {
    id: 'local',
    prepare: async onProgress => {
      onProgress({ progress: 0.5 })
    },
    transcribe: async () => transcript,
    speak: async function* (text, _voice, signal): AsyncIterable<VoiceAudioChunk> {
      spoken.push(text)
      const sentenceCount = chunkForSpeech(text).length
      for (let index = 0; index < sentenceCount && !signal.aborted; index += 1) {
        yield {
          index,
          sampleRate: STUB_SAMPLE_RATE,
          samples: new Float32Array(STUB_SAMPLE_RATE / 20),
        }
      }
    },
    onUnavailable: () => () => {},
    dispose: async () => {},
  }
}
