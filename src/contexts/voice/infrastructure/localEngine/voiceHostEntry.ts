import process from 'node:process'
import { createVoiceHostHandler } from './voiceHostHandler'
import { loadVoiceModels } from './voiceHostModels'
import type { VoiceHostReply } from './voiceHostProtocol'

// Entry of the voice utility process forked by LocalVoiceEngine.
interface ParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: VoiceHostReply): void
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort
if (!parentPort) {
  throw new Error('[voice-host] must run in an Electron utility process')
}

const handle = createVoiceHostHandler({
  loadModels: loadVoiceModels,
  send: reply => parentPort.postMessage(reply),
})

parentPort.on('message', ({ data }) => {
  void handle(data)
})
