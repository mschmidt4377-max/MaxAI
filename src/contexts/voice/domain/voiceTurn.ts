/**
 * One push-to-talk turn: idle -> listening -> transcribing -> sending -> waiting -> speaking -> idle.
 *
 * Invariants:
 * - At most one turn is active; every active state carries the id of the turn that owns it.
 * - An event for a turn other than the active one changes nothing, so a late standby or
 *   transcript from an abandoned turn can never drive the current one.
 * - An ignored event returns the same state object, so callers can detect a no-op by identity.
 */

export type VoiceErrorReason =
  | 'no-speech'
  | 'no-boss'
  | 'mic-failed'
  | 'transcribe-failed'
  | 'send-failed'
  | 'speak-failed'

export type VoiceTurnState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'listening'; readonly turnId: string }
  | { readonly phase: 'transcribing'; readonly turnId: string }
  | { readonly phase: 'sending'; readonly turnId: string; readonly transcript: string }
  | { readonly phase: 'waiting'; readonly turnId: string }
  | { readonly phase: 'speaking'; readonly turnId: string }
  | { readonly phase: 'error'; readonly turnId: string; readonly reason: VoiceErrorReason }
  | { readonly phase: 'cancelled'; readonly turnId: string }

export type VoiceTurnEvent =
  | { readonly type: 'press'; readonly turnId: string }
  | { readonly type: 'release'; readonly turnId: string; readonly heldMs: number }
  | { readonly type: 'blur'; readonly turnId: string }
  | { readonly type: 'transcribed'; readonly turnId: string; readonly text: string }
  | { readonly type: 'sent'; readonly turnId: string }
  | { readonly type: 'replied'; readonly turnId: string; readonly speak: boolean }
  | { readonly type: 'spoken'; readonly turnId: string }
  | { readonly type: 'failed'; readonly turnId: string; readonly reason: VoiceErrorReason }
  | { readonly type: 'cancel'; readonly turnId: string }

/** A shorter hold is treated as an accidental tap, not a request. */
export const MIN_VOICE_HOLD_MS = 300

export const IDLE_VOICE_TURN: VoiceTurnState = { phase: 'idle' }

/** Phases in which a key press starts a new turn. Waiting stays open so the boss never blocks the mic. */
const PRESSABLE_PHASES: ReadonlySet<VoiceTurnState['phase']> = new Set([
  'idle',
  'waiting',
  'speaking',
  'error',
  'cancelled',
])

export function reduceVoiceTurn(state: VoiceTurnState, event: VoiceTurnEvent): VoiceTurnState {
  if (event.type === 'press') {
    return PRESSABLE_PHASES.has(state.phase) ? { phase: 'listening', turnId: event.turnId } : state
  }

  if (state.phase === 'idle' || state.turnId !== event.turnId) {
    return state
  }

  const { turnId } = state
  switch (event.type) {
    case 'release':
      if (state.phase !== 'listening') {
        return state
      }
      return event.heldMs < MIN_VOICE_HOLD_MS
        ? { phase: 'cancelled', turnId }
        : { phase: 'transcribing', turnId }
    case 'blur':
      return state.phase === 'listening' ? { phase: 'cancelled', turnId } : state
    case 'transcribed': {
      if (state.phase !== 'transcribing') {
        return state
      }
      const transcript = event.text.trim()
      return transcript.length > 0
        ? { phase: 'sending', turnId, transcript }
        : { phase: 'error', turnId, reason: 'no-speech' }
    }
    case 'sent':
      return state.phase === 'sending' ? { phase: 'waiting', turnId } : state
    case 'replied':
      if (state.phase !== 'waiting') {
        return state
      }
      return event.speak ? { phase: 'speaking', turnId } : IDLE_VOICE_TURN
    case 'spoken':
      return state.phase === 'speaking' ? IDLE_VOICE_TURN : state
    case 'failed':
      return isActivePhase(state) ? { phase: 'error', turnId, reason: event.reason } : state
    case 'cancel':
      return isActivePhase(state) ? { phase: 'cancelled', turnId } : state
    default: {
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}

function isActivePhase(state: VoiceTurnState): boolean {
  return state.phase !== 'idle' && state.phase !== 'error' && state.phase !== 'cancelled'
}
