import { describe, expect, it, vi } from 'vitest'
import type { VoiceEngine } from '../../../src/contexts/voice/application/VoiceEngine'
import { VoiceService } from '../../../src/contexts/voice/application/VoiceService'

function createEngine(prepare: VoiceEngine['prepare']) {
  let emitUnavailable: (reason: string) => void = () => {}
  const engine: VoiceEngine = {
    id: 'local',
    prepare: vi.fn(prepare),
    transcribe: vi.fn(async () => ' text '),
    speak: async function* () {},
    onUnavailable: listener => {
      emitUnavailable = listener
      return () => {}
    },
    dispose: vi.fn(async () => {}),
  }
  return { engine, emitUnavailable: (reason: string) => emitUnavailable(reason) }
}

describe('VoiceService', () => {
  it('shows a failed load as error, then retries on the next request', async () => {
    const { engine } = createEngine(async () => {})
    vi.mocked(engine.prepare).mockRejectedValueOnce(new Error('no network'))
    const service = new VoiceService(engine)

    await expect(service.prepare()).rejects.toThrow('no network')
    expect(service.getStatus()).toEqual({ state: 'error', message: 'no network' })

    await expect(service.transcribe(new Float32Array(1))).resolves.toBe('text')
    expect(service.getStatus()).toEqual({ state: 'ready' })
    expect(engine.prepare).toHaveBeenCalledTimes(2)
  })

  it('goes back to idle when the engine loses its models, and reloads on demand', async () => {
    const { engine, emitUnavailable } = createEngine(async () => {})
    const service = new VoiceService(engine)
    await service.prepare()

    emitUnavailable('process exited')
    expect(service.getStatus()).toEqual({ state: 'idle' })

    await service.transcribe(new Float32Array(1))
    expect(engine.prepare).toHaveBeenCalledTimes(2)
  })

  it('ignores progress and results from a load the engine abandoned', async () => {
    let finishStale: () => void = () => {}
    let staleProgress: (p: { file: string | null; progress: number | null }) => void = () => {}
    const { engine, emitUnavailable } = createEngine(
      onProgress =>
        new Promise<void>(resolve => {
          staleProgress = onProgress
          finishStale = resolve
        }),
    )
    const service = new VoiceService(engine)
    const statuses: string[] = []
    service.onStatus(status => statuses.push(status.state))

    const stale = service.prepare()
    emitUnavailable('process exited')
    staleProgress({ file: 'x', progress: 0.9 })
    finishStale()
    await stale

    expect(service.getStatus()).toEqual({ state: 'idle' })
    expect(statuses).toEqual(['loading', 'idle'])
  })
})
