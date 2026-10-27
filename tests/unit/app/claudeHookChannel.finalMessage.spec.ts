import { request } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createClaudeHookChannel } from '../../../src/app/main/controlSurface/agentHook/claudeHookChannel'

function post(endpoint: string, token: string, payload: unknown): Promise<number> {
  const body = JSON.stringify(payload)
  return new Promise((resolveStatus, reject) => {
    const outgoing = request(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-opencove-hook-token': token,
      },
    })
    outgoing.once('error', reject)
    outgoing.once('response', response => {
      response.resume()
      response.once('end', () => resolveStatus(response.statusCode ?? 0))
    })
    outgoing.end(body)
  })
}

/** The shape Claude Code 2.1 sends on its Stop hook (captured from a real run). */
function stopPayload(lastAssistantMessage: string | undefined) {
  return {
    session_id: 'claude-session',
    transcript_path: 'C:/Users/me/.claude/projects/x/claude-session.jsonl',
    cwd: 'C:/repo',
    hook_event_name: 'Stop',
    stop_hook_active: false,
    ...(lastAssistantMessage === undefined ? {} : { last_assistant_message: lastAssistantMessage }),
  }
}

async function setup() {
  const channel = createClaudeHookChannel({
    port: 0,
    prepare: vi.fn(async () => ({ state: 'installed' as const, detail: null })),
  })
  await channel.start()
  const reservation = await channel.reserveSpawn()
  reservation.commit('session-1')
  return {
    channel,
    send: (payload: unknown) =>
      post(channel.getEndpoint() ?? '', reservation.env?.OPENCOVE_CLAUDE_HOOK_TOKEN ?? '', payload),
  }
}

describe('Claude hook final message', () => {
  it('keeps the Stop reply and has it ready when the standby event fires', async () => {
    const { channel, send } = await setup()
    const seenAtStandby: Array<string | null> = []
    channel.onState(event => {
      if (event.state === 'standby') {
        seenAtStandby.push(channel.getFinalMessage('session-1'))
      }
    })

    expect(await send(stopPayload('Two agents.\nSAY: You have two agents.'))).toBe(204)
    expect(seenAtStandby).toEqual(['Two agents.\nSAY: You have two agents.'])
    expect(channel.getFinalMessage('session-1')).toBe('Two agents.\nSAY: You have two agents.')
    await channel.dispose()
  })

  it('keeps the previous reply when a Stop carries none, and forgets it on dispose', async () => {
    const { channel, send } = await setup()
    await send(stopPayload('First.'))
    await send(stopPayload(undefined))
    await send(stopPayload('   '))
    expect(channel.getFinalMessage('session-1')).toBe('First.')

    channel.disposeSession('session-1')
    expect(channel.getFinalMessage('session-1')).toBeNull()
    await channel.dispose()
  })

  it('ignores last_assistant_message on events other than Stop', async () => {
    const { channel, send } = await setup()
    await send({ ...stopPayload('Not a reply.'), hook_event_name: 'UserPromptSubmit' })
    expect(channel.getFinalMessage('session-1')).toBeNull()
    await channel.dispose()
  })
})
