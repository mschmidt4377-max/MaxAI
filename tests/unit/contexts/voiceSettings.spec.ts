import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  isNormalizedAgentSettings,
  normalizeAgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'
import {
  DEFAULT_VOICE_SETTINGS,
  normalizeVoiceSettings,
} from '../../../src/contexts/voice/domain/voiceSettings'

describe('normalizeVoiceSettings', () => {
  it('defaults to disabled, local engine, George, no boss, spoken replies', () => {
    expect(normalizeVoiceSettings(undefined)).toEqual({
      enabled: false,
      engine: 'local',
      voice: 'bm_george',
      bossNodeId: null,
      speakReplies: true,
    })
  })

  it('keeps valid saved values', () => {
    const saved = {
      enabled: true,
      engine: 'openai-realtime',
      voice: 'af_heart',
      bossNodeId: 'node-1',
      speakReplies: false,
    }
    expect(normalizeVoiceSettings(saved)).toEqual(saved)
  })

  it('replaces each invalid field with its default and keeps the valid ones', () => {
    expect(
      normalizeVoiceSettings({
        enabled: 'yes',
        engine: 'whisper-cloud',
        voice: 'jf_alpha',
        bossNodeId: '   ',
        speakReplies: false,
      }),
    ).toEqual({ ...DEFAULT_VOICE_SETTINGS, speakReplies: false })
  })

  it('trims the boss node id', () => {
    expect(normalizeVoiceSettings({ bossNodeId: ' node-7 ' }).bossNodeId).toBe('node-7')
  })
})

describe('agent settings voice field', () => {
  it('fills voice defaults for settings saved before voice existed', () => {
    const { voice: _voice, ...legacy } = DEFAULT_AGENT_SETTINGS
    const normalized = normalizeAgentSettings(legacy)
    expect(normalized.voice).toEqual(DEFAULT_VOICE_SETTINGS)
    expect(isNormalizedAgentSettings(legacy)).toBe(false)
    expect(isNormalizedAgentSettings(normalized)).toBe(true)
  })

  it('round-trips user voice choices', () => {
    const voice = { ...DEFAULT_VOICE_SETTINGS, enabled: true, voice: 'bm_lewis' as const }
    expect(normalizeAgentSettings({ ...DEFAULT_AGENT_SETTINGS, voice }).voice).toEqual(voice)
  })
})
