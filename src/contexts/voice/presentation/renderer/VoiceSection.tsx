import React from 'react'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import { useTranslation } from '@app/renderer/i18n'
import {
  SettingsGroup,
  SettingsGroupBody,
} from '@contexts/settings/presentation/renderer/settingsPanel/SettingsGroup'
import { formatKeyChord, resolveCommandKeybinding } from '@contexts/settings/domain/keybindings'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import {
  KOKORO_VOICE_IDS,
  type KokoroVoiceId,
  type VoiceEngineId,
  type VoiceSettings,
} from '../../domain/voiceSettings'
import { listVoiceBossAgents } from './bossChannel'
import { getPlatform } from './voiceApi'

const NO_BOSS = ''

function SettingsRow({
  label,
  help,
  children,
}: {
  label: string
  help: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="settings-panel__row">
      <div className="settings-panel__row-label">
        <strong>{label}</strong>
        <span>{help}</span>
      </div>
      <div className="settings-panel__control">{children}</div>
    </div>
  )
}

export function VoiceSection({
  voice,
  keybindings,
  workspaces,
  onChange,
}: {
  voice: VoiceSettings
  keybindings: AgentSettings['keybindings']
  workspaces: readonly WorkspaceState[]
  onChange: (voice: VoiceSettings) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const update = (patch: Partial<VoiceSettings>): void => onChange({ ...voice, ...patch })

  const platform = getPlatform()
  const shortcut = formatKeyChord(
    platform,
    resolveCommandKeybinding({ commandId: 'voice.pushToTalk', overrides: keybindings, platform }),
  )

  const agents = listVoiceBossAgents(workspaces)
  // A boss whose node was closed shows as unset; the stored id stays until the user picks again.
  const bossMissing = voice.bossNodeId !== null && !agents.some(a => a.nodeId === voice.bossNodeId)
  const bossHelp = bossMissing
    ? t('voice.settings.bossMissing')
    : agents.length === 0
      ? t('voice.settings.bossNoAgents')
      : t('voice.settings.bossHelp')

  return (
    <SettingsGroup
      id="settings-section-voice"
      title={t('voice.settings.groupTitle')}
      description={`${t('voice.settings.groupHelp')} ${t('voice.settings.shortcutHelp', { shortcut })}`}
    >
      <SettingsGroupBody>
        <SettingsRow
          label={t('voice.settings.enabledLabel')}
          help={t('voice.settings.enabledHelp')}
        >
          <Toggle
            data-testid="settings-voice-enabled"
            checked={voice.enabled}
            label={t('voice.settings.enabledLabel')}
            onCheckedChange={enabled => update({ enabled })}
          />
        </SettingsRow>

        <SettingsRow label={t('voice.settings.bossLabel')} help={bossHelp}>
          <CoveSelect
            id="settings-voice-boss"
            testId="settings-voice-boss"
            ariaLabel={t('voice.settings.bossLabel')}
            value={bossMissing ? NO_BOSS : (voice.bossNodeId ?? NO_BOSS)}
            options={[
              { value: NO_BOSS, label: t('voice.settings.bossNone') },
              ...agents.map(agent => ({
                value: agent.nodeId,
                label:
                  workspaces.length > 1 ? `${agent.title} · ${agent.workspaceName}` : agent.title,
              })),
            ]}
            onChange={nodeId => update({ bossNodeId: nodeId === NO_BOSS ? null : nodeId })}
          />
        </SettingsRow>

        <SettingsRow label={t('voice.settings.engineLabel')} help={t('voice.settings.engineHelp')}>
          <CoveSelect
            id="settings-voice-engine"
            testId="settings-voice-engine"
            ariaLabel={t('voice.settings.engineLabel')}
            value={voice.engine}
            options={[
              { value: 'local', label: t('voice.settings.engineLocal') },
              {
                value: 'openai-realtime',
                label: t('voice.settings.engineRealtime'),
                disabled: true,
                badge: t('voice.settings.comingSoon'),
              },
            ]}
            onChange={engine => update({ engine: engine as VoiceEngineId })}
          />
        </SettingsRow>

        <SettingsRow label={t('voice.settings.voiceLabel')} help={t('voice.settings.voiceHelp')}>
          <CoveSelect
            id="settings-voice-voice"
            testId="settings-voice-voice"
            ariaLabel={t('voice.settings.voiceLabel')}
            value={voice.voice}
            options={KOKORO_VOICE_IDS.map(id => ({ value: id, label: id }))}
            onChange={id => update({ voice: id as KokoroVoiceId })}
          />
        </SettingsRow>

        <SettingsRow
          label={t('voice.settings.speakRepliesLabel')}
          help={t('voice.settings.speakRepliesHelp')}
        >
          <Toggle
            data-testid="settings-voice-speak-replies"
            checked={voice.speakReplies}
            label={t('voice.settings.speakRepliesLabel')}
            onCheckedChange={speakReplies => update({ speakReplies })}
          />
        </SettingsRow>
      </SettingsGroupBody>
    </SettingsGroup>
  )
}
