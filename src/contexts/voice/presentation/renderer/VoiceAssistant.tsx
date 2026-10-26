import React from 'react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { listVoiceBossAgents } from './bossChannel'
import { useVoiceAssistant } from './useVoiceAssistant'
import { VoiceIndicator } from './VoiceIndicator'

export function VoiceAssistant({
  settings,
}: {
  settings: Pick<AgentSettings, 'voice' | 'keybindings'>
}): React.JSX.Element | null {
  const { enabled, turn, engine } = useVoiceAssistant(settings)
  const bossNodeId = settings.voice.bossNodeId
  const bossTitle = useAppStore(state =>
    bossNodeId
      ? (listVoiceBossAgents(state.workspaces).find(agent => agent.nodeId === bossNodeId)?.title ??
        '')
      : '',
  )

  return enabled ? <VoiceIndicator turn={turn} engine={engine} bossTitle={bossTitle} /> : null
}
