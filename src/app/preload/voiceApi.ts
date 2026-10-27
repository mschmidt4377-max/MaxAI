import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import type {
  VoiceCancelSpeakInput,
  VoiceEngineStatus,
  VoiceSpeakChunkEvent,
  VoiceSpeakInput,
  VoiceSpeakResult,
  VoiceTranscribeInput,
  VoiceTranscribeResult,
} from '../../shared/contracts/dto'
import { invokeIpc } from './ipcInvoke'

export interface VoicePreloadApi {
  prepare: () => Promise<VoiceEngineStatus>
  getStatus: () => Promise<VoiceEngineStatus>
  onStatus: (listener: (status: VoiceEngineStatus) => void) => () => void
  transcribe: (payload: VoiceTranscribeInput) => Promise<VoiceTranscribeResult>
  speak: (payload: VoiceSpeakInput) => Promise<VoiceSpeakResult>
  onSpeakChunk: (listener: (event: VoiceSpeakChunkEvent) => void) => () => void
  cancelSpeak: (payload: VoiceCancelSpeakInput) => Promise<void>
}

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

export function createVoicePreloadApi(): VoicePreloadApi {
  return {
    prepare: () => invokeIpc(IPC_CHANNELS.voicePrepare),
    getStatus: () => invokeIpc(IPC_CHANNELS.voiceGetStatus),
    onStatus: listener => subscribe(IPC_CHANNELS.voiceStatus, listener),
    transcribe: payload => invokeIpc(IPC_CHANNELS.voiceTranscribe, payload),
    speak: payload => invokeIpc(IPC_CHANNELS.voiceSpeak, payload),
    onSpeakChunk: listener => subscribe(IPC_CHANNELS.voiceSpeakChunk, listener),
    cancelSpeak: payload => invokeIpc(IPC_CHANNELS.voiceCancelSpeak, payload),
  }
}
