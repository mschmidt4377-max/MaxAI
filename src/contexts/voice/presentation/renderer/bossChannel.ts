import type { TerminalSessionStateEvent } from '@shared/contracts/dto'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { resolveAgentPresentation } from '@contexts/workspace/presentation/renderer/utils/agentPresentation'
import { readFinalMessage, writeBossInput } from './voiceApi'

export interface VoiceBossAgent {
  nodeId: string
  sessionId: string
  title: string
  workspaceName: string
}

/** Agent nodes that can receive voice prompts, in canvas order. */
export function listVoiceBossAgents(workspaces: readonly WorkspaceState[]): VoiceBossAgent[] {
  return workspaces.flatMap(workspace =>
    workspace.nodes
      .filter(node => node.data.sessionId && resolveAgentPresentation(node.data).isAgent)
      .map(node => ({
        nodeId: node.id,
        sessionId: node.data.sessionId,
        title: node.data.title,
        workspaceName: workspace.name,
      })),
  )
}

/** Agent TUIs need a beat between pasted text and Enter, or they treat Enter as part of the paste. */
const SUBMIT_DELAY_MS = 300
const FINAL_MESSAGE_ATTEMPTS = 5
const FINAL_MESSAGE_RETRY_MS = 220

export interface AskBossDeps {
  onSessionState(
    sessionId: string,
    listener: (event: TerminalSessionStateEvent) => void,
  ): () => void
  onSessionExit(sessionId: string, listener: () => void): () => void
}

/**
 * Types the prompt into the boss and resolves with the reply it gives.
 *
 * The reply counts only after the boss is seen `working` after the submit and then `standby`.
 * The state hub replays the last cached state on subscribe, so a standby (or a busy boss's
 * standby for an older task) seen before the submit can never end this turn.
 */
export async function askBoss(
  boss: VoiceBossAgent,
  prompt: string,
  signal: AbortSignal,
  onSent: () => void,
  deps: AskBossDeps,
): Promise<string | null> {
  const previousReply = await readFinalMessage(boss.sessionId).catch(() => null)
  let submitted = false
  let cleanup = (): void => {}

  const finished = new Promise<void>((resolve, reject) => {
    let sawWorking = false
    const stopState = deps.onSessionState(boss.sessionId, event => {
      if (!submitted) {
        return
      }
      if (event.state === 'working') {
        sawWorking = true
      } else if (event.state === 'standby' && sawWorking) {
        resolve()
      }
    })
    const stopExit = deps.onSessionExit(boss.sessionId, () =>
      reject(new Error('The boss agent exited.')),
    )
    const onAbort = (): void => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    cleanup = () => {
      stopState()
      stopExit()
      signal.removeEventListener('abort', onAbort)
    }
  })
  // The turn may be abandoned before anyone awaits `finished`; keep that from being unhandled.
  finished.catch(() => {})

  try {
    await writeBossInput(boss.nodeId, boss.sessionId, prompt)
    await delay(SUBMIT_DELAY_MS, signal)
    await writeBossInput(boss.nodeId, boss.sessionId, '\r')
    submitted = true
    onSent()
    await finished
  } finally {
    cleanup()
  }

  return readNewReply(boss.sessionId, previousReply, signal, FINAL_MESSAGE_ATTEMPTS)
}

/**
 * The session file can lag the standby signal, so retry until the reply differs from the one
 * before the prompt. Still seeing the old reply means silence, not a stale answer read aloud.
 */
async function readNewReply(
  sessionId: string,
  previousReply: string | null,
  signal: AbortSignal,
  attemptsLeft: number,
): Promise<string | null> {
  const reply = await readFinalMessage(sessionId).catch(() => null)
  if (reply && reply !== previousReply) {
    return reply
  }
  if (attemptsLeft <= 1) {
    return null
  }
  await delay(FINAL_MESSAGE_RETRY_MS, signal)
  return readNewReply(sessionId, previousReply, signal, attemptsLeft - 1)
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
