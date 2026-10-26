export interface SpeechChunk {
  sampleRate: number
  samples: Float32Array
}

export interface SpeechPlayer {
  /** Schedules the chunk right after the previous one, so sentences play without gaps. */
  enqueue(chunk: SpeechChunk): void
  /** Resolves when every queued chunk has played or the player was stopped. */
  drain(): Promise<void>
  stop(): void
}

export function createSpeechPlayer(): SpeechPlayer {
  const context = new AudioContext()
  const sources = new Set<AudioBufferSourceNode>()
  let nextStartTime = 0
  let stopped = false
  let onIdle: (() => void) | null = null

  const settleIfIdle = (): void => {
    if (sources.size === 0 && onIdle) {
      onIdle()
      onIdle = null
    }
  }

  return {
    enqueue: chunk => {
      if (stopped || chunk.samples.length === 0) {
        return
      }
      const buffer = context.createBuffer(1, chunk.samples.length, chunk.sampleRate)
      buffer.getChannelData(0).set(chunk.samples)
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      source.addEventListener('ended', () => {
        sources.delete(source)
        settleIfIdle()
      })
      const startAt = Math.max(context.currentTime, nextStartTime)
      source.start(startAt)
      nextStartTime = startAt + buffer.duration
      sources.add(source)
    },
    drain: () =>
      new Promise<void>(resolve => {
        if (stopped || sources.size === 0) {
          resolve()
          return
        }
        onIdle = resolve
      }),
    stop: () => {
      if (stopped) {
        return
      }
      stopped = true
      for (const source of sources) {
        source.stop()
      }
      sources.clear()
      settleIfIdle()
      void context.close()
    },
  }
}
