import { env, pipeline, type ProgressInfo } from '@huggingface/transformers'
import { KokoroTTS } from 'kokoro-js'
import type { KokoroVoiceId } from '../../domain/voiceSettings'
import type { VoiceModelLoader } from './voiceHostHandler'
import { KOKORO_DTYPE, KOKORO_MODEL_ID, WHISPER_DTYPE, WHISPER_MODEL_ID } from './voiceHostProtocol'

/** Loads Whisper and Kokoro on onnxruntime-node. Runs only inside the voice utility process. */
export const loadVoiceModels: VoiceModelLoader = async (cacheDir, onProgress) => {
  // The default cache sits inside the package folder, which is read-only in a packaged app.
  env.cacheDir = cacheDir

  const progress_callback = (info: ProgressInfo): void => {
    if (info.status === 'progress') {
      onProgress(info.file, info.progress / 100)
    } else if (info.status === 'initiate') {
      onProgress(info.file, null)
    }
  }

  const [tts, asr] = await Promise.all([
    KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
      dtype: KOKORO_DTYPE,
      device: 'cpu',
      progress_callback,
    }),
    pipeline('automatic-speech-recognition', WHISPER_MODEL_ID, {
      dtype: WHISPER_DTYPE,
      device: 'cpu',
      progress_callback,
    }),
  ])

  return {
    transcribe: async pcm16k => {
      const output = await asr(pcm16k)
      return (Array.isArray(output) ? output : [output]).map(part => part.text).join(' ')
    },
    synthesize: async (text, voice) => {
      const audio = await tts.generate(text, { voice: voice as KokoroVoiceId })
      return { samples: audio.audio, sampleRate: audio.sampling_rate }
    },
  }
}
