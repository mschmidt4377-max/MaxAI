import { describe, expect, it } from 'vitest'
import {
  IDLE_VOICE_TURN,
  MIN_VOICE_HOLD_MS,
  reduceVoiceTurn,
  type VoiceTurnEvent,
  type VoiceTurnState,
} from '../../../src/contexts/voice/domain/voiceTurn'

function run(events: VoiceTurnEvent[], from: VoiceTurnState = IDLE_VOICE_TURN): VoiceTurnState {
  return events.reduce(reduceVoiceTurn, from)
}

const HELD = MIN_VOICE_HOLD_MS + 500

describe('reduceVoiceTurn', () => {
  it('walks one full turn back to idle', () => {
    const phases: string[] = []
    let state = IDLE_VOICE_TURN
    for (const event of [
      { type: 'press', turnId: 't1' },
      { type: 'release', turnId: 't1', heldMs: HELD },
      { type: 'transcribed', turnId: 't1', text: ' list the agents ' },
      { type: 'sent', turnId: 't1' },
      { type: 'replied', turnId: 't1', speak: true },
      { type: 'spoken', turnId: 't1' },
    ] as VoiceTurnEvent[]) {
      state = reduceVoiceTurn(state, event)
      phases.push(state.phase)
    }
    expect(phases).toEqual(['listening', 'transcribing', 'sending', 'waiting', 'speaking', 'idle'])
  })

  it('carries the trimmed transcript into sending', () => {
    expect(
      run([
        { type: 'press', turnId: 't1' },
        { type: 'release', turnId: 't1', heldMs: HELD },
        { type: 'transcribed', turnId: 't1', text: ' list the agents ' },
      ]),
    ).toEqual({ phase: 'sending', turnId: 't1', transcript: 'list the agents' })
  })

  it('cancels a release shorter than the minimum hold', () => {
    expect(
      run([
        { type: 'press', turnId: 't1' },
        { type: 'release', turnId: 't1', heldMs: MIN_VOICE_HOLD_MS - 1 },
      ]),
    ).toEqual({ phase: 'cancelled', turnId: 't1' })
  })

  it('cancels listening on window blur', () => {
    expect(
      run([
        { type: 'press', turnId: 't1' },
        { type: 'blur', turnId: 't1' },
      ]),
    ).toEqual({ phase: 'cancelled', turnId: 't1' })
  })

  it('reports no-speech for an empty transcript', () => {
    expect(
      run([
        { type: 'press', turnId: 't1' },
        { type: 'release', turnId: 't1', heldMs: HELD },
        { type: 'transcribed', turnId: 't1', text: '   ' },
      ]),
    ).toEqual({ phase: 'error', turnId: 't1', reason: 'no-speech' })
  })

  it('goes straight to idle when the reply is not spoken', () => {
    expect(
      run([{ type: 'replied', turnId: 't1', speak: false }], { phase: 'waiting', turnId: 't1' }),
    ).toBe(IDLE_VOICE_TURN)
  })

  it('a press during speaking interrupts playback and starts a new turn', () => {
    expect(run([{ type: 'press', turnId: 't2' }], { phase: 'speaking', turnId: 't1' })).toEqual({
      phase: 'listening',
      turnId: 't2',
    })
  })

  it('a press while the boss works starts a new turn, and the old standby is ignored', () => {
    const state = run(
      [
        { type: 'press', turnId: 't2' },
        { type: 'replied', turnId: 't1', speak: true },
      ],
      { phase: 'waiting', turnId: 't1' },
    )
    expect(state).toEqual({ phase: 'listening', turnId: 't2' })
  })

  it.each<VoiceTurnState>([
    { phase: 'listening', turnId: 't1' },
    { phase: 'transcribing', turnId: 't1' },
    { phase: 'sending', turnId: 't1', transcript: 'hi' },
  ])('ignores a press during $phase so only one turn runs', state => {
    expect(reduceVoiceTurn(state, { type: 'press', turnId: 't2' })).toBe(state)
  })

  it('ignores every event from a stale turn', () => {
    const state: VoiceTurnState = { phase: 'transcribing', turnId: 't2' }
    const stale: VoiceTurnEvent[] = [
      { type: 'release', turnId: 't1', heldMs: HELD },
      { type: 'blur', turnId: 't1' },
      { type: 'transcribed', turnId: 't1', text: 'old' },
      { type: 'sent', turnId: 't1' },
      { type: 'replied', turnId: 't1', speak: true },
      { type: 'spoken', turnId: 't1' },
      { type: 'failed', turnId: 't1', reason: 'send-failed' },
      { type: 'cancel', turnId: 't1' },
    ]
    for (const event of stale) {
      expect(reduceVoiceTurn(state, event)).toBe(state)
    }
  })

  it('ignores events that do not fit the current phase', () => {
    const waiting: VoiceTurnState = { phase: 'waiting', turnId: 't1' }
    expect(reduceVoiceTurn(waiting, { type: 'release', turnId: 't1', heldMs: HELD })).toBe(waiting)
    expect(reduceVoiceTurn(waiting, { type: 'spoken', turnId: 't1' })).toBe(waiting)
    expect(reduceVoiceTurn(IDLE_VOICE_TURN, { type: 'cancel', turnId: 't1' })).toBe(IDLE_VOICE_TURN)
  })

  it('fails and cancels only active turns', () => {
    const waiting: VoiceTurnState = { phase: 'waiting', turnId: 't1' }
    expect(
      reduceVoiceTurn(waiting, { type: 'failed', turnId: 't1', reason: 'send-failed' }),
    ).toEqual({ phase: 'error', turnId: 't1', reason: 'send-failed' })
    expect(reduceVoiceTurn(waiting, { type: 'cancel', turnId: 't1' })).toEqual({
      phase: 'cancelled',
      turnId: 't1',
    })
    const cancelled: VoiceTurnState = { phase: 'cancelled', turnId: 't1' }
    expect(
      reduceVoiceTurn(cancelled, { type: 'failed', turnId: 't1', reason: 'speak-failed' }),
    ).toBe(cancelled)
  })

  it('starts a new turn after an error', () => {
    expect(
      run([{ type: 'press', turnId: 't2' }], { phase: 'error', turnId: 't1', reason: 'no-speech' }),
    ).toEqual({ phase: 'listening', turnId: 't2' })
  })
})
