import { describe, expect, it, vi } from 'vitest'
import { LocalVoiceEngine } from '../../../src/contexts/voice/infrastructure/localEngine/LocalVoiceEngine'
import type {
  VoiceHostReply,
  VoiceHostRequest,
} from '../../../src/contexts/voice/infrastructure/localEngine/voiceHostProtocol'
import type { PtyHostProcess } from '../../../src/platform/process/ptyHost/processTypes'

function createFakeProcess() {
  const listeners: { message?: (m: unknown) => void; exit?: (code: number) => void } = {}
  const posted: VoiceHostRequest[] = []
  const process: PtyHostProcess = {
    on: ((event: 'message' | 'exit' | 'error', listener: (value: never) => void) => {
      if (event === 'message') {
        listeners.message = listener as (m: unknown) => void
      }
      if (event === 'exit') {
        listeners.exit = listener as (code: number) => void
      }
    }) as PtyHostProcess['on'],
    postMessage: (message, callback) => {
      posted.push(message as VoiceHostRequest)
      callback?.(null)
    },
    kill: vi.fn(() => true),
    stdout: null,
    stderr: null,
    pid: 1,
  }
  return {
    process,
    posted,
    reply: (reply: VoiceHostReply) => listeners.message?.(reply),
    exit: (code: number) => listeners.exit?.(code),
  }
}

function setup() {
  const processes: ReturnType<typeof createFakeProcess>[] = []
  let nextId = 0
  const reportIssue = vi.fn()
  const engine = new LocalVoiceEngine({
    cacheDir: 'C:/userData/models',
    createProcess: () => {
      const fake = createFakeProcess()
      processes.push(fake)
      return fake.process
    },
    reportIssue,
    createId: () => `r${++nextId}`,
  })
  return { engine, processes, reportIssue }
}

async function prepare(setupResult: ReturnType<typeof setup>): Promise<void> {
  const preparing = setupResult.engine.prepare(() => {})
  setupResult.processes
    .at(-1)
    ?.reply({ type: 'done', id: setupResult.processes.at(-1)!.posted.at(-1)!.id })
  await preparing
}

describe('LocalVoiceEngine', () => {
  it('forks the host lazily and sends the model cache directory', async () => {
    const ctx = setup()
    expect(ctx.processes).toHaveLength(0)

    const progress = vi.fn()
    const preparing = ctx.engine.prepare(progress)
    const [host] = ctx.processes
    expect(host.posted).toEqual([{ type: 'prepare', id: 'r1', cacheDir: 'C:/userData/models' }])

    host.reply({ type: 'progress', id: 'r1', file: 'model.onnx', progress: 0.5 })
    host.reply({ type: 'done', id: 'r1' })
    await preparing
    expect(progress).toHaveBeenCalledWith({ file: 'model.onnx', progress: 0.5 })
  })

  it('resolves transcribe with the host text and rejects on host error', async () => {
    const ctx = setup()
    await prepare(ctx)
    const host = ctx.processes[0]

    const ok = ctx.engine.transcribe(new Float32Array(2))
    host.reply({ type: 'done', id: 'r2', text: 'hello' })
    await expect(ok).resolves.toBe('hello')

    const failed = ctx.engine.transcribe(new Float32Array(2))
    host.reply({ type: 'error', id: 'r3', message: 'boom' })
    await expect(failed).rejects.toThrow('boom')
  })

  it('streams speak chunks until done', async () => {
    const ctx = setup()
    await prepare(ctx)
    const host = ctx.processes[0]
    const controller = new AbortController()

    const received: number[] = []
    const consuming = (async () => {
      for await (const chunk of ctx.engine.speak('One. Two.', 'bm_george', controller.signal)) {
        received.push(chunk.index)
      }
    })()
    host.reply({
      type: 'chunk',
      id: 'r2',
      index: 0,
      sampleRate: 24_000,
      samples: new Float32Array(1),
    })
    host.reply({
      type: 'chunk',
      id: 'r2',
      index: 1,
      sampleRate: 24_000,
      samples: new Float32Array(1),
    })
    host.reply({ type: 'done', id: 'r2' })
    await consuming

    expect(received).toEqual([0, 1])
    expect(host.posted.at(-1)).toEqual({
      type: 'speak',
      id: 'r2',
      text: 'One. Two.',
      voice: 'bm_george',
    })
  })

  it('sends cancel to the host when the signal aborts', async () => {
    const ctx = setup()
    await prepare(ctx)
    const host = ctx.processes[0]
    const controller = new AbortController()

    const consuming = (async () => {
      const received: number[] = []
      for await (const chunk of ctx.engine.speak('One. Two.', 'bm_george', controller.signal)) {
        received.push(chunk.index)
        controller.abort()
      }
      return received
    })()
    host.reply({
      type: 'chunk',
      id: 'r2',
      index: 0,
      sampleRate: 24_000,
      samples: new Float32Array(1),
    })

    await expect(consuming).resolves.toEqual([0])
    expect(host.posted.at(-1)).toEqual({ type: 'cancel', id: 'r2' })
  })

  it('fails pending requests when the host exits, then forks a new host', async () => {
    const ctx = setup()
    await prepare(ctx)
    const unavailable = vi.fn()
    ctx.engine.onUnavailable(unavailable)

    const pending = ctx.engine.transcribe(new Float32Array(2))
    ctx.processes[0].exit(3)

    await expect(pending).rejects.toThrow('voice engine process exited with code 3')
    expect(unavailable).toHaveBeenCalledWith('voice engine process exited with code 3')

    void ctx.engine.prepare(() => {})
    expect(ctx.processes).toHaveLength(2)
    expect(ctx.processes[1].posted[0]).toMatchObject({ type: 'prepare' })
  })

  it('does not report loss when the host dies before models loaded', async () => {
    const ctx = setup()
    const unavailable = vi.fn()
    ctx.engine.onUnavailable(unavailable)

    const preparing = ctx.engine.prepare(() => {})
    ctx.processes[0].exit(1)

    await expect(preparing).rejects.toThrow('exited with code 1')
    expect(unavailable).not.toHaveBeenCalled()
  })

  it('does not fork a new host just to cancel speech on a host that exited', async () => {
    const ctx = setup()
    const controller = new AbortController()
    const speech = ctx.engine.speak('Hi.', 'bm_george', controller.signal)
    const next = speech[Symbol.asyncIterator]().next()

    ctx.processes[0].exit(0)
    controller.abort()

    await expect(next).rejects.toThrow('exited')
    expect(ctx.processes).toHaveLength(1)
  })

  it('rejects everything after dispose and kills the host', async () => {
    const ctx = setup()
    await prepare(ctx)
    const pending = ctx.engine.transcribe(new Float32Array(1))

    await ctx.engine.dispose()

    await expect(pending).rejects.toThrow('disposed')
    await expect(ctx.engine.transcribe(new Float32Array(1))).rejects.toThrow('disposed')
    expect(ctx.processes[0].process.kill).toHaveBeenCalled()
  })
})
