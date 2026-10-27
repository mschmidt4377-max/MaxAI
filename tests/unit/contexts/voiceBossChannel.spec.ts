import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalSessionStateEvent } from '../../../src/shared/contracts/dto'

const api = vi.hoisted(() => ({
  writeBossInput: vi.fn(async () => {}),
  readFinalMessage: vi.fn(async (): Promise<string | null> => null),
}))
vi.mock('../../../src/contexts/voice/presentation/renderer/voiceApi', () => api)

const { askBoss } = await import('../../../src/contexts/voice/presentation/renderer/bossChannel')

const boss = { nodeId: 'node-1', sessionId: 'session-1', title: 'Boss', workspaceName: 'W' }

function createHub(cached: TerminalSessionStateEvent['state'] | null) {
  let listener: ((event: TerminalSessionStateEvent) => void) | null = null
  let exit: (() => void) | null = null
  return {
    deps: {
      onSessionState: (sessionId: string, next: (event: TerminalSessionStateEvent) => void) => {
        listener = next
        if (cached) {
          next({ sessionId, state: cached })
        }
        return () => {
          listener = null
        }
      },
      onSessionExit: (_sessionId: string, next: () => void) => {
        exit = next
        return () => {
          exit = null
        }
      },
    },
    emit: (state: TerminalSessionStateEvent['state']) =>
      listener?.({ sessionId: 'session-1', state }),
    exit: () => exit?.(),
    isSubscribed: () => listener !== null,
  }
}

describe('askBoss', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    api.writeBossInput.mockClear()
    api.readFinalMessage.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('types the prompt, waits, then presses Enter', async () => {
    const hub = createHub(null)
    const onSent = vi.fn()
    void askBoss(boss, 'hello', new AbortController().signal, onSent, hub.deps)
    await vi.advanceTimersByTimeAsync(0)
    expect(api.writeBossInput).toHaveBeenCalledWith('node-1', 'session-1', 'hello')
    expect(onSent).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)
    expect(api.writeBossInput).toHaveBeenLastCalledWith('node-1', 'session-1', '\r')
    expect(onSent).toHaveBeenCalledTimes(1)
  })

  it('ignores the cached standby and answers only after working then standby', async () => {
    api.readFinalMessage.mockResolvedValueOnce('old reply').mockResolvedValue('new reply')
    const hub = createHub('standby')
    let reply: string | null | undefined
    void askBoss(boss, 'hello', new AbortController().signal, () => {}, hub.deps).then(value => {
      reply = value
    })
    await vi.advanceTimersByTimeAsync(300)
    hub.emit('standby')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reply).toBeUndefined()

    hub.emit('working')
    hub.emit('standby')
    await vi.advanceTimersByTimeAsync(0)
    expect(reply).toBe('new reply')
    expect(hub.isSubscribed()).toBe(false)
  })

  it('returns null rather than the reply from before the prompt', async () => {
    api.readFinalMessage.mockResolvedValue('old reply')
    const hub = createHub(null)
    let reply: string | null | undefined
    void askBoss(boss, 'hello', new AbortController().signal, () => {}, hub.deps).then(value => {
      reply = value
    })
    await vi.advanceTimersByTimeAsync(300)
    hub.emit('working')
    hub.emit('standby')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(reply).toBeNull()
    expect(api.readFinalMessage).toHaveBeenCalledTimes(6)
  })

  it('rejects and unsubscribes when the turn is abandoned', async () => {
    const hub = createHub(null)
    const abort = new AbortController()
    const result = askBoss(boss, 'hello', abort.signal, () => {}, hub.deps)
    const settled = result.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(300)
    abort.abort(new Error('new turn'))
    expect(await settled).toEqual(new Error('new turn'))
    expect(hub.isSubscribed()).toBe(false)
  })

  it('rejects when the boss session exits', async () => {
    const hub = createHub(null)
    const settled = askBoss(boss, 'hello', new AbortController().signal, () => {}, hub.deps).catch(
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(300)
    hub.exit()
    expect(await settled).toBeInstanceOf(Error)
  })
})
