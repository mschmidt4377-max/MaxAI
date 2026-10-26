import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import type { VoiceEngine } from '../../../src/contexts/voice/application/VoiceEngine'
import { invokeHandledIpc } from './ipcTestUtils'

function createIpcHarness() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    }),
  }
  const windowSend = vi.fn()
  const BrowserWindow = {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: windowSend } }],
  }
  return { handlers, ipcMain, BrowserWindow, windowSend }
}

function createSender() {
  let destroyed = false
  let onDestroyed: (() => void) | null = null
  return {
    send: vi.fn(),
    isDestroyed: () => destroyed,
    once: vi.fn((_event: string, listener: () => void) => {
      onDestroyed = listener
    }),
    removeListener: vi.fn(),
    destroy: () => {
      destroyed = true
      onDestroyed?.()
    },
  }
}

/** Speaks three chunks; between chunks it waits for `release` when a gate is installed. */
function createFakeEngine() {
  let gate: Promise<void> | null = null
  let release: () => void = () => {}
  const engine: VoiceEngine = {
    id: 'local',
    prepare: vi.fn(async onProgress => {
      onProgress({ progress: 0.5 })
    }),
    transcribe: vi.fn(async (pcm16k: Float32Array) => ` heard ${pcm16k.length} samples `),
    speak: async function* (_text, _voice, signal) {
      for (let index = 0; index < 3; index += 1) {
        if (signal.aborted) {
          return
        }
        yield { index, sampleRate: 24_000, samples: new Float32Array([index]) }
        // eslint-disable-next-line no-await-in-loop -- The test releases one chunk at a time.
        await gate
      }
    },
    onUnavailable: () => () => {},
    dispose: vi.fn(async () => {}),
  }
  return {
    engine,
    holdBetweenChunks: () => {
      gate = new Promise(resolve => {
        release = resolve
      })
    },
    release: () => release(),
  }
}

async function setup() {
  const harness = createIpcHarness()
  vi.doMock('electron', () => ({ ipcMain: harness.ipcMain, BrowserWindow: harness.BrowserWindow }))
  const fake = createFakeEngine()
  const { VoiceService } = await import('../../../src/contexts/voice/application/VoiceService')
  const { registerVoiceIpcHandlers } =
    await import('../../../src/contexts/voice/presentation/main-ipc/register')
  const disposable = registerVoiceIpcHandlers(new VoiceService(fake.engine))
  const invoke = <T>(channel: string, payload?: unknown, sender = createSender()) =>
    invokeHandledIpc<T>(harness.handlers.get(channel), { sender }, payload)
  return { ...harness, ...fake, disposable, invoke }
}

const SPEAK = {
  requestId: 'speak-1',
  text: 'Good evening. All agents are online.',
  voice: 'bm_george',
}

describe('voice IPC handlers', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('loads models once and broadcasts loading progress, then ready', async () => {
    const { invoke, engine, windowSend } = await setup()

    const [first, second] = await Promise.all([
      invoke(IPC_CHANNELS.voicePrepare),
      invoke(IPC_CHANNELS.voicePrepare),
    ])

    expect(first).toEqual({ state: 'ready' })
    expect(second).toEqual({ state: 'ready' })
    expect(engine.prepare).toHaveBeenCalledTimes(1)
    expect(windowSend.mock.calls).toEqual([
      [IPC_CHANNELS.voiceStatus, { state: 'loading', progress: null }],
      [IPC_CHANNELS.voiceStatus, { state: 'loading', progress: 0.5 }],
      [IPC_CHANNELS.voiceStatus, { state: 'ready' }],
    ])
    await expect(invoke(IPC_CHANNELS.voiceGetStatus)).resolves.toEqual({ state: 'ready' })
  })

  it('transcribes 16 kHz PCM and trims the text', async () => {
    const { invoke } = await setup()
    await expect(
      invoke(IPC_CHANNELS.voiceTranscribe, { pcm16k: new Float32Array(16_000) }),
    ).resolves.toEqual({ text: 'heard 16000 samples' })
  })

  it.each([
    ['a missing payload', undefined],
    ['a plain array', { pcm16k: [0, 0.1] }],
    ['an empty recording', { pcm16k: new Float32Array(0) }],
    ['more than two minutes', { pcm16k: new Float32Array(16_000 * 120 + 1) }],
  ])('rejects %s for transcribe', async (_label, payload) => {
    const { invoke, engine } = await setup()
    await expect(invoke(IPC_CHANNELS.voiceTranscribe, payload)).rejects.toMatchObject({
      code: 'common.invalid_input',
    })
    expect(engine.transcribe).not.toHaveBeenCalled()
  })

  it('streams one chunk event per sentence to the requesting window', async () => {
    const { invoke } = await setup()
    const sender = createSender()

    await expect(invoke(IPC_CHANNELS.voiceSpeak, SPEAK, sender)).resolves.toEqual({
      chunkCount: 3,
      cancelled: false,
    })
    expect(
      sender.send.mock.calls.map(([channel, event]) => [channel, event.requestId, event.index]),
    ).toEqual([
      [IPC_CHANNELS.voiceSpeakChunk, 'speak-1', 0],
      [IPC_CHANNELS.voiceSpeakChunk, 'speak-1', 1],
      [IPC_CHANNELS.voiceSpeakChunk, 'speak-1', 2],
    ])
    expect(sender.send.mock.calls[0][1].samples).toBeInstanceOf(Float32Array)
  })

  it.each([
    ['an unknown voice', { ...SPEAK, voice: 'jf_alpha' }],
    ['blank text', { ...SPEAK, text: '   ' }],
    ['text over 4000 characters', { ...SPEAK, text: 'a'.repeat(4_001) }],
    ['a missing requestId', { text: SPEAK.text, voice: SPEAK.voice }],
  ])('rejects %s for speak', async (_label, payload) => {
    const { invoke } = await setup()
    await expect(invoke(IPC_CHANNELS.voiceSpeak, payload)).rejects.toMatchObject({
      code: 'common.invalid_input',
    })
  })

  it('stops speaking on cancel and reports the request as cancelled', async () => {
    const { invoke, holdBetweenChunks, release } = await setup()
    holdBetweenChunks()
    const sender = createSender()

    const speaking = invoke(IPC_CHANNELS.voiceSpeak, SPEAK, sender)
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledTimes(1))
    await invoke(IPC_CHANNELS.voiceCancelSpeak, { requestId: 'speak-1' })
    release()

    await expect(speaking).resolves.toEqual({ chunkCount: 1, cancelled: true })
    expect(sender.send).toHaveBeenCalledTimes(1)
  })

  it('rejects a second speak with a requestId that is still speaking', async () => {
    const { invoke, holdBetweenChunks, release } = await setup()
    holdBetweenChunks()

    const first = invoke(IPC_CHANNELS.voiceSpeak, SPEAK)
    await expect(invoke(IPC_CHANNELS.voiceSpeak, SPEAK)).rejects.toMatchObject({
      code: 'common.invalid_input',
    })
    release()
    await first
  })

  it('stops speaking when the requesting window closes', async () => {
    const { invoke, holdBetweenChunks, release } = await setup()
    holdBetweenChunks()
    const sender = createSender()

    const speaking = invoke(IPC_CHANNELS.voiceSpeak, SPEAK, sender)
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledTimes(1))
    sender.destroy()
    release()

    await expect(speaking).resolves.toEqual({ chunkCount: 1, cancelled: true })
  })

  it('ignores a cancel for an unknown request', async () => {
    const { invoke } = await setup()
    await expect(
      invoke(IPC_CHANNELS.voiceCancelSpeak, { requestId: 'nope' }),
    ).resolves.toBeUndefined()
  })

  it('removes every handler and disposes the engine', async () => {
    const { disposable, ipcMain, handlers, engine } = await setup()
    disposable.dispose()

    expect(handlers.size).toBe(0)
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(5)
    await vi.waitFor(() => expect(engine.dispose).toHaveBeenCalledTimes(1))
  })
})
