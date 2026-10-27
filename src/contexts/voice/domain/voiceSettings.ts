import {
  isRecord,
  normalizeBoolean,
  normalizeTextValue,
} from '../../settings/domain/settingsNormalization'

export const VOICE_ENGINE_IDS = ['local', 'openai-realtime'] as const
export type VoiceEngineId = (typeof VOICE_ENGINE_IDS)[number]

/** The English voices kokoro-js 1.2 ships. Other Kokoro languages need a phonemizer it lacks. */
export const KOKORO_VOICE_IDS = [
  'af_heart',
  'af_alloy',
  'af_aoede',
  'af_bella',
  'af_jessica',
  'af_kore',
  'af_nicole',
  'af_nova',
  'af_river',
  'af_sarah',
  'af_sky',
  'am_adam',
  'am_echo',
  'am_eric',
  'am_fenrir',
  'am_liam',
  'am_michael',
  'am_onyx',
  'am_puck',
  'am_santa',
  'bf_alice',
  'bf_emma',
  'bf_isabella',
  'bf_lily',
  'bm_daniel',
  'bm_fable',
  'bm_george',
  'bm_lewis',
] as const
export type KokoroVoiceId = (typeof KOKORO_VOICE_IDS)[number]

export interface VoiceSettings {
  enabled: boolean
  engine: VoiceEngineId
  voice: KokoroVoiceId
  /** The agent node that receives voice prompts; null until the user picks one. */
  bossNodeId: string | null
  speakReplies: boolean
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: false,
  engine: 'local',
  voice: 'bm_george',
  bossNodeId: null,
  speakReplies: true,
}

function isVoiceEngineId(value: unknown): value is VoiceEngineId {
  return VOICE_ENGINE_IDS.includes(value as VoiceEngineId)
}

function isKokoroVoiceId(value: unknown): value is KokoroVoiceId {
  return KOKORO_VOICE_IDS.includes(value as KokoroVoiceId)
}

export function normalizeVoiceSettings(value: unknown): VoiceSettings {
  const input = isRecord(value) ? value : {}
  const bossNodeId = normalizeTextValue(input.bossNodeId)

  return {
    enabled: normalizeBoolean(input.enabled) ?? DEFAULT_VOICE_SETTINGS.enabled,
    engine: isVoiceEngineId(input.engine) ? input.engine : DEFAULT_VOICE_SETTINGS.engine,
    voice: isKokoroVoiceId(input.voice) ? input.voice : DEFAULT_VOICE_SETTINGS.voice,
    bossNodeId: bossNodeId.length > 0 ? bossNodeId : null,
    speakReplies: normalizeBoolean(input.speakReplies) ?? DEFAULT_VOICE_SETTINGS.speakReplies,
  }
}
