import { describe, expect, it, vi } from 'vitest'

const locate = vi.hoisted(() => vi.fn(async () => null))
vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentSessionLocator', () => ({
  locateAgentResumeSessionId: locate,
}))

const { registerSessionFinalMessageHandler } =
  await import('../../../src/app/main/controlSurface/handlers/sessionFinalMessageHandler')

type Handler = { validate: (p: unknown) => unknown; handle: (ctx: unknown, p: unknown) => unknown }

function setup(readHookFinalMessage: (sessionId: string) => string | null) {
  const handlers = new Map<string, Handler>()
  const controlSurface = { register: (id: string, handler: Handler) => handlers.set(id, handler) }
  const sessions = new Map([
    [
      's1',
      {
        sessionId: 's1',
        provider: 'claude-code',
        startedAt: '2026-10-25T00:00:00.000Z',
        startedAtMs: 0,
        cwd: 'C:/repo',
        resumeSessionId: 'claude-1',
        route: { kind: 'local' },
      },
    ],
  ])
  registerSessionFinalMessageHandler(controlSurface as never, {
    sessions: sessions as never,
    topology: {} as never,
    readHookFinalMessage,
  })
  const handler = handlers.get('session.finalMessage') as Handler
  return (sessionId: string) => handler.handle({}, handler.validate({ sessionId }))
}

describe('session.finalMessage with a turn-end hook reply', () => {
  it('returns the hook reply without reading any session file', async () => {
    const query = setup(() => 'SAY: Done.')
    await expect(query('s1')).resolves.toMatchObject({
      message: 'SAY: Done.',
      resumeSessionId: 'claude-1',
    })
    expect(locate).not.toHaveBeenCalled()
  })
})
