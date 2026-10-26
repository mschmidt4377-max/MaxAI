import type { GetSessionFinalMessageResult } from '@shared/contracts/dto'

type VoiceBridge = NonNullable<Window['opencoveApi']['voice']>

/** The only voice file that touches `window.opencoveApi`. Null in the browser shell. */
export function getVoiceBridge(): VoiceBridge | null {
  return typeof window !== 'undefined' ? (window.opencoveApi?.voice ?? null) : null
}

export function getPlatform(): string | undefined {
  return typeof window !== 'undefined' ? window.opencoveApi?.meta?.platform : undefined
}

export async function writeBossInput(
  nodeId: string,
  sessionId: string,
  data: string,
): Promise<void> {
  await window.opencoveApi.controlSurface.invoke({
    kind: 'command',
    id: 'session.writeNode',
    payload: { nodeId, sessionId, data },
  })
}

export async function readFinalMessage(sessionId: string): Promise<string | null> {
  const result = await window.opencoveApi.controlSurface.invoke<GetSessionFinalMessageResult>({
    kind: 'query',
    id: 'session.finalMessage',
    payload: { sessionId },
  })
  return result.message
}
