import { BrowserWindow, ipcMain } from 'electron'
import { registerHandledIpc } from '../../../../app/main/ipc/handle'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  VoiceEngineStatus,
  VoiceSpeakChunkEvent,
  VoiceSpeakResult,
  VoiceTranscribeResult,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { VoiceService } from '../../application/VoiceService'
import {
  normalizeVoiceCancelSpeakPayload,
  normalizeVoiceSpeakPayload,
  normalizeVoiceTranscribePayload,
} from './validate'

const INVOKE_CHANNELS = [
  IPC_CHANNELS.voicePrepare,
  IPC_CHANNELS.voiceGetStatus,
  IPC_CHANNELS.voiceTranscribe,
  IPC_CHANNELS.voiceSpeak,
  IPC_CHANNELS.voiceCancelSpeak,
] as const

export function registerVoiceIpcHandlers(service: VoiceService): IpcRegistrationDisposable {
  // One controller per in-flight speak request, so a cancel or a closed window stops synthesis.
  const speaking = new Map<string, AbortController>()

  const stopBroadcastingStatus = service.onStatus(status => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.voiceStatus, status)
      }
    }
  })

  registerHandledIpc(
    IPC_CHANNELS.voicePrepare,
    async (): Promise<VoiceEngineStatus> => {
      await service.prepare()
      return service.getStatus()
    },
    { defaultErrorCode: 'voice.prepare_failed' },
  )

  registerHandledIpc(IPC_CHANNELS.voiceGetStatus, (): VoiceEngineStatus => service.getStatus(), {
    defaultErrorCode: 'voice.prepare_failed',
  })

  registerHandledIpc(
    IPC_CHANNELS.voiceTranscribe,
    async (_event, payload: unknown): Promise<VoiceTranscribeResult> => {
      const { pcm16k } = normalizeVoiceTranscribePayload(payload)
      return { text: await service.transcribe(pcm16k) }
    },
    { defaultErrorCode: 'voice.transcribe_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.voiceSpeak,
    async (event, payload: unknown): Promise<VoiceSpeakResult> => {
      const { requestId, text, voice } = normalizeVoiceSpeakPayload(payload)
      if (speaking.has(requestId)) {
        throw createAppError('common.invalid_input', {
          debugMessage: `voice:speak requestId ${requestId} is already speaking`,
        })
      }

      const controller = new AbortController()
      const sender = event.sender
      const abortOnClose = (): void => controller.abort()
      speaking.set(requestId, controller)
      sender.once('destroyed', abortOnClose)
      try {
        return await service.speak(text, voice, controller.signal, chunk => {
          if (sender.isDestroyed()) {
            controller.abort()
            return
          }
          const message: VoiceSpeakChunkEvent = { requestId, ...chunk }
          sender.send(IPC_CHANNELS.voiceSpeakChunk, message)
        })
      } finally {
        speaking.delete(requestId)
        if (!sender.isDestroyed()) {
          sender.removeListener('destroyed', abortOnClose)
        }
      }
    },
    { defaultErrorCode: 'voice.speak_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.voiceCancelSpeak,
    (_event, payload: unknown): void => {
      const { requestId } = normalizeVoiceCancelSpeakPayload(payload)
      speaking.get(requestId)?.abort()
    },
    { defaultErrorCode: 'voice.speak_failed' },
  )

  return {
    dispose: () => {
      for (const channel of INVOKE_CHANNELS) {
        ipcMain.removeHandler(channel)
      }
      for (const controller of speaking.values()) {
        controller.abort()
      }
      speaking.clear()
      stopBroadcastingStatus()
      void service.dispose()
    },
  }
}
