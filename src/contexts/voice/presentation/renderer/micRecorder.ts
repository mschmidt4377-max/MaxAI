const WHISPER_SAMPLE_RATE = 16_000

export interface MicRecorder {
  start(): Promise<void>
  /** Stops recording and returns mono PCM at 16 kHz. */
  stop(): Promise<Float32Array>
  cancel(): void
}

/**
 * Records with MediaRecorder and resamples on stop with decodeAudioData. An AudioWorklet would
 * need a separate module URL; this path needs no extra script and no CSP change.
 *
 * The microphone opens on start and closes on stop or cancel, so the OS mic indicator is only on
 * while the key is held.
 */
interface RecordingSession {
  ready: Promise<{ stream: MediaStream; recorder: MediaRecorder; chunks: Blob[] }>
  cancelled: boolean
}

function releaseStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop()
  }
}

async function openRecording(isCancelled: () => boolean): Promise<{
  stream: MediaStream
  recorder: MediaRecorder
  chunks: Blob[]
}> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.addEventListener('dataavailable', event => {
    if (event.data.size > 0) {
      chunks.push(event.data)
    }
  })
  // A cancel can land while getUserMedia is still pending.
  if (isCancelled()) {
    releaseStream(stream)
  } else {
    recorder.start()
  }
  return { stream, recorder, chunks }
}

export function createMicRecorder(): MicRecorder {
  let session: RecordingSession | null = null

  return {
    start: () => {
      const current: RecordingSession = {
        cancelled: false,
        ready: openRecording(() => current.cancelled),
      }
      session = current
      return current.ready.then(() => undefined)
    },
    stop: async () => {
      const current = session
      session = null
      if (!current) {
        throw new Error('The microphone is not recording.')
      }
      const { stream, recorder, chunks } = await current.ready
      const stopped = new Promise<void>(resolve =>
        recorder.addEventListener('stop', () => resolve(), { once: true }),
      )
      recorder.stop()
      await stopped
      releaseStream(stream)
      return decodeToPcm16k(new Blob(chunks, { type: recorder.mimeType }))
    },
    cancel: () => {
      const current = session
      session = null
      if (!current) {
        return
      }
      current.cancelled = true
      void current.ready
        .then(({ stream, recorder }) => {
          if (recorder.state !== 'inactive') {
            recorder.stop()
          }
          releaseStream(stream)
        })
        .catch(() => {})
    },
  }
}

async function decodeToPcm16k(blob: Blob): Promise<Float32Array> {
  // decodeAudioData resamples to the context rate, so a 16 kHz context gives Whisper's input rate.
  const context = new OfflineAudioContext(1, 1, WHISPER_SAMPLE_RATE)
  const audio = await context.decodeAudioData(await blob.arrayBuffer())
  if (audio.numberOfChannels === 1) {
    return audio.getChannelData(0)
  }
  const mono = new Float32Array(audio.length)
  for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
    const samples = audio.getChannelData(channel)
    for (let index = 0; index < mono.length; index += 1) {
      mono[index] += samples[index] / audio.numberOfChannels
    }
  }
  return mono
}
