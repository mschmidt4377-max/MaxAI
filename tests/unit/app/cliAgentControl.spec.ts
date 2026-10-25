import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  screenToTailLines,
  tryHandleAgentControlCommands,
} from '../../../src/app/cli/commands/agentControl.mjs'
import opencodeSnapshot from './fixtures/opencodePresentationSnapshot.json'

type CapturedRequest = {
  kind: string
  id: string
  payload: Record<string, unknown>
  at: number
}

function stubControlSurface(values: Record<string, unknown>): {
  requests: CapturedRequest[]
  stdout: () => string
  stderr: () => string
} {
  const requests: CapturedRequest[] = []
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '') as CapturedRequest
    requests.push({ ...body, at: Date.now() })
    return new Response(
      JSON.stringify({ __opencoveControlEnvelope: true, ok: true, value: values[body.id] ?? {} }),
    )
  })
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    out.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
    err.push(String(chunk))
    return true
  })
  vi.spyOn(process, 'exit').mockImplementation(code => {
    throw new Error(`exit ${code}`)
  })
  return { requests, stdout: () => out.join(''), stderr: () => err.join('') }
}

async function invokeAgentArgs(args: string[]): Promise<boolean> {
  return await tryHandleAgentControlCommands({
    command: 'agent',
    args,
    connection: { hostname: '127.0.0.1', port: 1, token: 'token' },
    pretty: false,
    timeoutMs: 1_000,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CLI agent control commands', () => {
  it('lists only agent nodes and prints their compact summary', async () => {
    const { requests, stdout } = stubControlSurface({
      'node.list': {
        nodes: [
          {
            id: 'n1',
            kind: 'agent',
            title: 'Worker',
            status: 'running',
            spaceId: 's1',
            sessionId: 'sess-1',
            projectId: 'p1',
            frame: { x: 0, y: 0, width: 1, height: 1 },
          },
        ],
      },
    })

    expect(await invokeAgentArgs(['agent', 'list', '--space', 's1'])).toBe(true)

    expect(requests.map(({ kind, id, payload }) => ({ kind, id, payload }))).toEqual([
      {
        kind: 'query',
        id: 'node.list',
        payload: { kind: 'agent', space: { kind: 'spaceId', spaceId: 's1' } },
      },
    ])
    expect(JSON.parse(stdout()).value).toEqual({
      agents: [
        { id: 'n1', title: 'Worker', status: 'running', spaceId: 's1', sessionId: 'sess-1' },
      ],
    })
  })

  it('spawns an agent through node.create with the space locator and agent data', async () => {
    const { requests } = stubControlSurface({ 'node.create': { node: { id: 'new' } } })

    await invokeAgentArgs([
      'agent',
      'spawn',
      '--space-name',
      'Main',
      '--provider',
      'codex',
      '--prompt',
      'do it',
      '--title',
      'W',
    ])

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      kind: 'command',
      id: 'node.create',
      payload: {
        kind: 'agent',
        space: { kind: 'spaceName', name: 'Main' },
        title: 'W',
        data: { prompt: 'do it', provider: 'codex' },
      },
    })
  })

  it('submits a prompt as the text then a separate delayed carriage return to the current session', async () => {
    const { requests, stdout } = stubControlSurface({
      'node.get': { node: { id: 'n1', sessionId: 'sess-1' } },
      'session.writeNode': { nodeId: 'n1', sessionId: 'sess-1', accepted: true },
    })

    await invokeAgentArgs(['agent', 'prompt', '--node', 'n1', '--text', 'fix the bug'])

    expect(requests.map(({ id, payload }) => ({ id, payload }))).toEqual([
      { id: 'node.get', payload: { nodeId: 'n1' } },
      {
        id: 'session.writeNode',
        payload: { nodeId: 'n1', sessionId: 'sess-1', data: 'fix the bug' },
      },
      { id: 'session.writeNode', payload: { nodeId: 'n1', sessionId: 'sess-1', data: '\r' } },
    ])
    expect(requests[2].at - requests[1].at).toBeGreaterThanOrEqual(250)
    expect(JSON.parse(stdout()).value).toMatchObject({ accepted: true })
  })

  it('fails without writing when the node has no session', async () => {
    const { requests, stderr } = stubControlSurface({
      'node.get': { node: { id: 'n1', sessionId: null } },
    })

    await expect(
      invokeAgentArgs(['agent', 'prompt', '--node', 'n1', '--text', 'hello']),
    ).rejects.toThrow('exit 2')

    expect(requests.map(request => request.id)).toEqual(['node.get'])
    expect(stderr()).toContain('node n1 has no running session')
  })

  it('reads the tail of the agent screen as plain text', async () => {
    const { requests, stdout } = stubControlSurface({
      'node.get': { node: { id: 'n1', sessionId: 'sess-1' } },
      'session.presentationSnapshot': {
        serializedScreen: 'first\r\n\x1b[1mtwo\x1b[1Cwords\x1b[0m\r\n\r\n\x1b]0;title\x07> ready',
      },
    })

    await invokeAgentArgs(['agent', 'read', '--node', 'n1', '--lines', '2'])

    expect(requests.map(({ id, payload }) => ({ id, payload }))).toEqual([
      { id: 'node.get', payload: { nodeId: 'n1' } },
      { id: 'session.presentationSnapshot', payload: { sessionId: 'sess-1' } },
    ])
    expect(stdout()).toBe('two words\n> ready\n')
  })
})

describe('screenToTailLines', () => {
  it('strips CSI, OSC and charset escapes, expands cursor-forward, and drops blank lines', () => {
    const screen =
      '\x1b(B\x1b[38;2;1;2;3mHello\x1b[3Cworld\x1b[0m   \r\n\x1b[2C\r\n\x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\\r\nlast'

    expect(screenToTailLines(screen, 40)).toEqual(['Hello   world', 'link', 'last'])
    expect(screenToTailLines(screen, 1)).toEqual(['last'])
  })

  it('splits an autowrapped alternate-screen snapshot into cols-wide rows', () => {
    const { serializedScreen, cols } = opencodeSnapshot
    expect(serializedScreen).not.toContain('\n')

    const lines = screenToTailLines(serializedScreen, 100, cols)

    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect([...line].length).toBeLessThanOrEqual(cols)
    }
    expect(lines).toContainEqual(
      expect.stringMatching(/^\s*┃\s+Ask anything… "What is the tech stack of this$/u),
    )
    expect(lines.at(-1)).toMatch(/^\s*~\\Documents\\AI Projects\\Cat Day:main\s+1\.19\.4$/u)
  })

  it('counts East Asian wide characters as two columns when splitting', () => {
    expect(screenToTailLines('漢字ab漢字', 40, 4)).toEqual(['漢字', 'ab漢', '字'])
  })
})
