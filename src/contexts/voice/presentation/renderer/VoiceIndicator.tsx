import React, { useEffect, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { VoiceEngineStatus } from '@shared/contracts/dto'
import type { VoiceTurnState } from '../../domain/voiceTurn'

/** How long an ended turn stays on screen. Derived UI only; the turn state does not change. */
const ERROR_VISIBLE_MS = 5_000
const CANCELLED_VISIBLE_MS = 1_200

type Tone = 'active' | 'info' | 'error'

function useEndedTurnVisible(turn: VoiceTurnState): boolean {
  const [hiddenTurn, setHiddenTurn] = useState<VoiceTurnState | null>(null)
  useEffect(() => {
    if (turn.phase !== 'error' && turn.phase !== 'cancelled') {
      return
    }
    const timer = setTimeout(
      () => setHiddenTurn(turn),
      turn.phase === 'error' ? ERROR_VISIBLE_MS : CANCELLED_VISIBLE_MS,
    )
    return () => clearTimeout(timer)
  }, [turn])
  return hiddenTurn !== turn
}

export function VoiceIndicator({
  turn,
  engine,
  bossTitle,
}: {
  turn: VoiceTurnState
  engine: VoiceEngineStatus
  bossTitle: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const endedTurnVisible = useEndedTurnVisible(turn)

  const view = ((): { text: string; tone: Tone } | null => {
    switch (turn.phase) {
      case 'listening':
        return { text: t('voice.indicator.listening'), tone: 'active' }
      case 'transcribing':
        return { text: t('voice.indicator.transcribing'), tone: 'info' }
      case 'sending':
        return { text: t('voice.indicator.sending', { boss: bossTitle }), tone: 'info' }
      case 'waiting':
        return { text: t('voice.indicator.waiting', { boss: bossTitle }), tone: 'info' }
      case 'speaking':
        return { text: t('voice.indicator.speaking'), tone: 'active' }
      case 'cancelled':
        return endedTurnVisible ? { text: t('voice.indicator.cancelled'), tone: 'info' } : null
      case 'error':
        if (!endedTurnVisible) {
          return null
        }
        return engine.state === 'error'
          ? { text: t('voice.indicator.engineError', { message: engine.message }), tone: 'error' }
          : { text: t(`voice.indicator.errors.${turn.reason}`), tone: 'error' }
      case 'idle':
        return null
      default: {
        const _exhaustive: never = turn
        return _exhaustive
      }
    }
  })()

  // Model loading shows whatever the turn is doing, so the first use explains the wait.
  const loading =
    engine.state === 'loading'
      ? engine.progress !== null
        ? t('voice.indicator.downloadingModels', { percent: Math.round(engine.progress * 100) })
        : t('voice.indicator.loadingModels')
      : null

  if (!view && !loading) {
    return null
  }

  return (
    <div
      className={`voice-indicator voice-indicator--${view?.tone ?? 'info'}`}
      data-testid="voice-indicator"
      data-voice-phase={turn.phase}
      role={view?.tone === 'error' ? 'alert' : 'status'}
      aria-live={view?.tone === 'error' ? 'assertive' : 'polite'}
    >
      <span className="voice-indicator__dot" aria-hidden="true" />
      <span className="voice-indicator__text">
        {view ? <span>{view.text}</span> : null}
        {loading ? <span className="voice-indicator__detail">{loading}</span> : null}
      </span>
    </div>
  )
}
