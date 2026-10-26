const WHISPER_SAMPLE_RATE = 16_000

export interface MicRecorder {
  start(): Promise<void>
  /** Stops recording and returns mono PCM at 16 kHz; empty when the mic never delivered audio. */
  stop(): Promise<Float32Array>
  cancel(): void
}

/** Chromium's insertable-streams reader; lib.dom does not declare it yet. */
declare const MediaStreamTrackProcessor: new (init: { track: MediaStreamTrack }) => {
  readable: ReadableStream<AudioData>
}

interface Capture {
  stream: MediaStream
  frames: Float32Array[]
  sampleRate: number
  /** Settles once the track ends and every delivered frame is copied. */
  drained: Promise<void>
}

interface RecordingSession {
  ready: Promise<Capture>
  cancelled: boolean
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop()
  }
}

/**
 * Reads raw samples off the microphone track with MediaStreamTrackProcessor.
 *
 * Earlier versions failed in two ways: MediaRecorder had to decode a compressed clip, and a clip
 * cut short by a slow mic start would not decode; ScriptProcessorNode depends on the audio output
 * clock, which runs slow or stalls in a background window. This reader is neither. It needs no
 * worklet module, so it needs no extra script and no CSP change.
 */
async function openCapture(isCancelled: () => boolean): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  })
  const capture: Capture = {
    stream,
    frames: [],
    sampleRate: WHISPER_SAMPLE_RATE,
    drained: Promise.resolve(),
  }
  // A cancel can land while getUserMedia is still pending.
  if (isCancelled()) {
    stopTracks(stream)
    return capture
  }
  const reader = new MediaStreamTrackProcessor({
    track: stream.getAudioTracks()[0],
  }).readable.getReader()
  const pump = async (): Promise<void> => {
    const { value, done } = await reader.read()
    if (done) {
      return
    }
    const samples = new Float32Array(value.numberOfFrames)
    value.copyTo(samples, { planeIndex: 0, format: 'f32-planar' })
    capture.sampleRate = value.sampleRate
    capture.frames.push(samples)
    value.close()
    return pump()
  }
  capture.drained = pump().catch(() => {})
  return capture
}

export function createMicRecorder(): MicRecorder {
  let session: RecordingSession | null = null

  return {
    start: () => {
      const current: RecordingSession = {
        cancelled: false,
        ready: openCapture(() => current.cancelled),
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
      const capture = await current.ready
      // Ending the track ends the reader, so `drained` settles after the last frame.
      stopTracks(capture.stream)
      await capture.drained
      return resampleTo16k(joinFrames(capture.frames), capture.sampleRate)
    },
    cancel: () => {
      const current = session
      session = null
      if (!current) {
        return
      }
      current.cancelled = true
      void current.ready.then(capture => stopTracks(capture.stream)).catch(() => {})
    },
  }
}

function joinFrames(frames: readonly Float32Array[]): Float32Array {
  const joined = new Float32Array(frames.reduce((total, frame) => total + frame.length, 0))
  let offset = 0
  for (const frame of frames) {
    joined.set(frame, offset)
    offset += frame.length
  }
  return joined
}

async function resampleTo16k(samples: Float32Array, sampleRate: number): Promise<Float32Array> {
  if (samples.length === 0 || sampleRate === WHISPER_SAMPLE_RATE) {
    return samples
  }
  const length = Math.max(1, Math.round((samples.length * WHISPER_SAMPLE_RATE) / sampleRate))
  // Offline rendering runs as fast as it can, independent of any audio output clock.
  const offline = new OfflineAudioContext(1, length, WHISPER_SAMPLE_RATE)
  const buffer = offline.createBuffer(1, samples.length, sampleRate)
  buffer.getChannelData(0).set(samples)
  const source = offline.createBufferSource()
  source.buffer = buffer
  source.connect(offline.destination)
  source.start()
  return (await offline.startRendering()).getChannelData(0)
}
