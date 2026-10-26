import { describe, expect, it, vi } from 'vitest'
import {
  createVoiceHostHandler,
  type VoiceModels,
} from '../../../src/contexts/voice/infrastructure/localEngine/voiceHostHandler'
import type { VoiceHostReply } from '../../../src/contexts/voice/infrastructure/localEngine/voiceHostProtocol'

function createModels(): VoiceModels & { synthesized: string[] } {
  const synthesized: string[] = []
  return {
    synthesized,
    transcribe: vi.fn(async (pcm16k: Float32Array) => `heard ${pcm16k.length}`),
    synthesize: vi.fn(async (text: string) => {
      synthesized.push(text)
      return { samples: new Float32Array(text.length), sampleRate: 24_000 }
    }),
  }
}

function setup(loadModels = vi.fn(async () => createModels())) {
  const replies: VoiceHostReply[] = []
  const handle = createVoiceHostHandler({ loadModels, send: reply => replies.push(reply) })
  return { handle, replies, loadModels }
}

const PREPARE = { type: 'prepare', id: 'p1', cacheDir: 'C:/models' } as const

describe('voice host handler', () => {
  it('loads models once and reports progress to the requester', async () => {
    const loadModels = vi.fn(
      async (_cacheDir: string, onProgress: (f: string | null, p: number | null) => void) => {
        onProgress('model_fp16.onnx', 0.25)
        return createModels()
      },
    )
    const { handle, replies } = setup(loadModels)

    await handle(PREPARE)
    await handle({ ...PREPARE, id: 'p2' })

    expect(loadModels).toHaveBeenCalledTimes(1)
    expect(loadModels).toHaveBeenCalledWith('C:/models', expect.any(Function))
    expect(replies).toEqual([
      { type: 'progress', id: 'p1', file: 'model_fp16.onnx', progress: 0.25 },
      { type: 'done', id: 'p1' },
      { type: 'done', id: 'p2' },
    ])
  })

  it('retries loading after a failed load', async () => {
    const loadModels = vi
      .fn()
      .mockRejectedValueOnce(new Error('download failed'))
      .mockResolvedValueOnce(createModels())
    const { handle, replies } = setup(loadModels)

    await handle(PREPARE)
    await handle({ ...PREPARE, id: 'p2' })

    expect(replies).toEqual([
      { type: 'error', id: 'p1', message: 'download failed' },
      { type: 'done', id: 'p2' },
    ])
  })

  it('refuses work before models are loaded', async () => {
    const { handle, replies } = setup()
    await handle({ type: 'transcribe', id: 't1', pcm16k: new Float32Array(4) })
    expect(replies).toEqual([{ type: 'error', id: 't1', message: 'voice models are not loaded' }])
  })

  it('transcribes and speaks one chunk per sentence, in order', async () => {
    const models = createModels()
    const { handle, replies } = setup(vi.fn(async () => models))
    await handle(PREPARE)
    replies.length = 0

    await handle({ type: 'transcribe', id: 't1', pcm16k: new Float32Array(8) })
    await handle({
      type: 'speak',
      id: 's1',
      text: 'Good evening. Shall I deploy?',
      voice: 'bm_george',
    })

    expect(models.synthesized).toEqual(['Good evening.', 'Shall I deploy?'])
    expect(
      replies.map(reply => [reply.type, reply.id, 'index' in reply ? reply.index : null]),
    ).toEqual([
      ['done', 't1', null],
      ['chunk', 's1', 0],
      ['chunk', 's1', 1],
      ['done', 's1', null],
    ])
    expect(replies[0]).toMatchObject({ text: 'heard 8' })
  })

  it('stops a speak request at the next sentence after cancel', async () => {
    const models = createModels()
    let releaseFirst: () => void = () => {}
    vi.mocked(models.synthesize).mockImplementationOnce(async text => {
      models.synthesized.push(text)
      await new Promise<void>(resolve => {
        releaseFirst = resolve
      })
      return { samples: new Float32Array(1), sampleRate: 24_000 }
    })
    const { handle, replies } = setup(vi.fn(async () => models))
    await handle(PREPARE)

    const speaking = handle({
      type: 'speak',
      id: 's1',
      text: 'One. Two. Three.',
      voice: 'bm_george',
    })
    await vi.waitFor(() => expect(models.synthesized).toEqual(['One.']))
    void handle({ type: 'cancel', id: 's1' })
    releaseFirst()
    await speaking

    expect(models.synthesized).toEqual(['One.'])
    expect(replies.filter(reply => reply.id === 's1').map(reply => reply.type)).toEqual([
      'chunk',
      'done',
    ])
  })

  it('cancels a speak request that is still queued', async () => {
    const models = createModels()
    const { handle, replies } = setup(vi.fn(async () => models))
    void handle(PREPARE)
    const speaking = handle({ type: 'speak', id: 's1', text: 'Never said.', voice: 'bm_george' })
    void handle({ type: 'cancel', id: 's1' })
    await speaking

    expect(models.synthesized).toEqual([])
    expect(replies.at(-1)).toEqual({ type: 'done', id: 's1' })
  })

  it('fails a speak request instead of sending NaN audio', async () => {
    const models = createModels()
    vi.mocked(models.synthesize).mockResolvedValueOnce({
      samples: new Float32Array([0.1, Number.NaN]),
      sampleRate: 24_000,
    })
    const { handle, replies } = setup(vi.fn(async () => models))
    await handle(PREPARE)
    replies.length = 0

    await handle({ type: 'speak', id: 's1', text: 'Broken. Fine.', voice: 'bm_george' })

    expect(replies).toEqual([
      { type: 'error', id: 's1', message: 'speech synthesis produced invalid audio' },
    ])
  })

  it('ignores malformed messages', async () => {
    const { handle, replies } = setup()
    await handle({ type: 'speak', id: 's1', text: 42 })
    await handle('garbage')
    expect(replies).toEqual([])
  })
})
