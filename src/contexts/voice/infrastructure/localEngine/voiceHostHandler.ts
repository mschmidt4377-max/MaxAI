import { chunkForSpeech } from '../../domain/voiceText'
import { isVoiceHostRequest, type VoiceHostReply, type VoiceHostRequest } from './voiceHostProtocol'

export interface VoiceModels {
  transcribe(pcm16k: Float32Array): Promise<string>
  synthesize(text: string, voice: string): Promise<{ samples: Float32Array; sampleRate: number }>
}

export type VoiceModelLoader = (
  cacheDir: string,
  onProgress: (file: string | null, progress: number | null) => void,
) => Promise<VoiceModels>

/**
 * Runs requests one at a time so speech and transcription never compete for the CPU.
 * `cancel` bypasses the queue: it marks a queued or running speak request, which then stops
 * before its next sentence.
 */
export function createVoiceHostHandler(options: {
  loadModels: VoiceModelLoader
  send: (reply: VoiceHostReply) => void
}): (message: unknown) => Promise<void> {
  let models: Promise<VoiceModels> | null = null
  let queue: Promise<void> = Promise.resolve()
  const pendingSpeakIds = new Set<string>()
  const cancelledSpeakIds = new Set<string>()

  const handle = async (request: Exclude<VoiceHostRequest, { type: 'cancel' }>): Promise<void> => {
    const { id } = request
    try {
      if (request.type === 'prepare') {
        if (!models) {
          models = options.loadModels(request.cacheDir, (file, progress) =>
            options.send({ type: 'progress', id, file, progress }),
          )
          models.catch(() => {
            models = null
          })
        }
        await models
        options.send({ type: 'done', id })
        return
      }

      if (!models) {
        throw new Error('voice models are not loaded')
      }
      const loaded = await models

      if (request.type === 'transcribe') {
        options.send({ type: 'done', id, text: await loaded.transcribe(request.pcm16k) })
        return
      }

      let index = 0
      for (const chunk of chunkForSpeech(request.text)) {
        if (cancelledSpeakIds.has(id)) {
          break
        }
        // eslint-disable-next-line no-await-in-loop -- Sentences play in order and cancel between them.
        const audio = await loaded.synthesize(chunk, request.voice)
        // A broken model can emit NaN samples, which play as silence and poison Whisper input.
        if (!audio.samples.every(Number.isFinite)) {
          throw new Error('speech synthesis produced invalid audio')
        }
        options.send({ type: 'chunk', id, index, ...audio })
        index += 1
      }
      options.send({ type: 'done', id })
    } catch (error) {
      options.send({
        type: 'error',
        id,
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      pendingSpeakIds.delete(id)
      cancelledSpeakIds.delete(id)
    }
  }

  return message => {
    if (!isVoiceHostRequest(message)) {
      return queue
    }
    if (message.type === 'cancel') {
      if (pendingSpeakIds.has(message.id)) {
        cancelledSpeakIds.add(message.id)
      }
      return queue
    }
    if (message.type === 'speak') {
      pendingSpeakIds.add(message.id)
    }
    queue = queue.then(() => handle(message))
    return queue
  }
}
