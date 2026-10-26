import type { PtyHostProcess } from '../../../../platform/process/ptyHost/processTypes'
import type {
  VoiceAudioChunk,
  VoiceEngine,
  VoiceModelProgress,
} from '../../application/VoiceEngine'
import type { KokoroVoiceId } from '../../domain/voiceSettings'
import { isVoiceHostReply, type VoiceHostReply, type VoiceHostRequest } from './voiceHostProtocol'

interface PendingRequest {
  onReply: (reply: VoiceHostReply) => void
  fail: (error: Error) => void
}

export interface LocalVoiceEngineOptions {
  /** Where models are downloaded and cached (userData `models/`). */
  cacheDir: string
  /** Forks the voice utility process. Called lazily, and again after the process exits. */
  createProcess: () => PtyHostProcess
  reportIssue: (message: string) => void
  createId?: () => string
}

/**
 * Main-process side of the local engine. Whisper and Kokoro run in a utility process so inference
 * never blocks the main or renderer threads.
 *
 * Invariants:
 * - Every request settles: by its own done/error reply, or by failure when the process exits.
 * - After the process exits, the next request forks a new one; models must be prepared again.
 */
export class LocalVoiceEngine implements VoiceEngine {
  public readonly id = 'local' as const
  private host: PtyHostProcess | null = null
  private prepared = false
  private disposed = false
  private readonly pending = new Map<string, PendingRequest>()
  private readonly unavailableListeners = new Set<(reason: string) => void>()
  private readonly createId: () => string

  public constructor(private readonly options: LocalVoiceEngineOptions) {
    this.createId = options.createId ?? (() => crypto.randomUUID())
  }

  public prepare(onProgress: (progress: VoiceModelProgress) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      this.request(
        { type: 'prepare', id: this.createId(), cacheDir: this.options.cacheDir },
        {
          onReply: reply => {
            if (reply.type === 'progress') {
              onProgress({ progress: reply.progress })
            } else if (reply.type === 'done') {
              this.prepared = true
              resolve()
            } else if (reply.type === 'error') {
              reject(new Error(reply.message))
            }
          },
          fail: reject,
        },
      )
    })
  }

  public transcribe(pcm16k: Float32Array): Promise<string> {
    return new Promise((resolve, reject) => {
      this.request(
        { type: 'transcribe', id: this.createId(), pcm16k },
        {
          onReply: reply => {
            if (reply.type === 'done') {
              resolve(reply.text ?? '')
            } else if (reply.type === 'error') {
              reject(new Error(reply.message))
            }
          },
          fail: reject,
        },
      )
    })
  }

  public async *speak(
    text: string,
    voice: KokoroVoiceId,
    signal: AbortSignal,
  ): AsyncGenerator<VoiceAudioChunk> {
    const id = this.createId()
    const chunks: VoiceAudioChunk[] = []
    let finished = false
    let failure: Error | null = null
    let wake: (() => void) | null = null
    const notify = (): void => {
      wake?.()
      wake = null
    }

    this.request(
      { type: 'speak', id, text, voice },
      {
        onReply: reply => {
          if (reply.type === 'chunk') {
            chunks.push({
              index: reply.index,
              sampleRate: reply.sampleRate,
              samples: reply.samples,
            })
          } else if (reply.type === 'done') {
            finished = true
          } else if (reply.type === 'error') {
            failure = new Error(reply.message)
          }
          notify()
        },
        fail: error => {
          failure = error
          notify()
        },
      },
    )

    const cancel = (): void => {
      this.post({ type: 'cancel', id })
      notify()
    }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      while (true) {
        const next = chunks.shift()
        if (next) {
          yield next
          continue
        }
        if (failure) {
          throw failure
        }
        if (finished || signal.aborted) {
          return
        }
        // eslint-disable-next-line no-await-in-loop -- Waits for the host's next reply.
        await new Promise<void>(resolve => {
          wake = resolve
        })
      }
    } finally {
      signal.removeEventListener('abort', cancel)
      // The consumer stopped early: tell the host to stop synthesizing for nobody.
      if (!finished && !failure && !signal.aborted) {
        this.post({ type: 'cancel', id })
      }
    }
  }

  public onUnavailable(listener: (reason: string) => void): () => void {
    this.unavailableListeners.add(listener)
    return () => this.unavailableListeners.delete(listener)
  }

  public async dispose(): Promise<void> {
    this.disposed = true
    const host = this.host
    this.host = null
    this.prepared = false
    this.failAll(new Error('voice engine disposed'))
    host?.kill()
  }

  private request(
    message: Exclude<VoiceHostRequest, { type: 'cancel' }>,
    pending: PendingRequest,
  ): void {
    if (this.disposed) {
      pending.fail(new Error('voice engine disposed'))
      return
    }
    this.pending.set(message.id, pending)
    this.post(message)
  }

  private post(message: VoiceHostRequest): void {
    // A cancel must not fork a fresh process; the one it targeted is already gone.
    if (this.disposed || (message.type === 'cancel' && !this.host)) {
      return
    }
    this.ensureHost().postMessage(message, error => {
      if (error) {
        const pending = this.pending.get(message.id)
        this.pending.delete(message.id)
        pending?.fail(error)
      }
    })
  }

  private ensureHost(): PtyHostProcess {
    if (this.host) {
      return this.host
    }

    const host = this.options.createProcess()
    host.on('message', message => {
      if (!isVoiceHostReply(message)) {
        return
      }
      const pending = this.pending.get(message.id)
      if (message.type === 'done' || message.type === 'error') {
        this.pending.delete(message.id)
      }
      pending?.onReply(message)
    })
    host.on('exit', code => {
      if (this.host !== host) {
        return
      }
      this.host = null
      const wasPrepared = this.prepared
      this.prepared = false
      const reason = `voice engine process exited with code ${code}`
      this.failAll(new Error(reason))
      if (wasPrepared) {
        this.options.reportIssue(`[opencove] ${reason}`)
        for (const listener of this.unavailableListeners) {
          listener(reason)
        }
      }
    })
    host.on('error', error => {
      this.options.reportIssue(`[opencove] voice engine process error: ${JSON.stringify(error)}`)
    })
    host.stderr?.on('data', chunk => {
      this.options.reportIssue(`[voice-host] ${String(chunk).trimEnd()}`)
    })
    this.host = host
    return host
  }

  private failAll(error: Error): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const request of pending) {
      request.fail(error)
    }
  }
}
