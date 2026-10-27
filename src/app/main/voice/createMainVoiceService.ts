import { app, utilityProcess } from 'electron'
import { join, resolve } from 'node:path'
import { VoiceService } from '../../../contexts/voice/application/VoiceService'
import { LocalVoiceEngine } from '../../../contexts/voice/infrastructure/localEngine/LocalVoiceEngine'
import { createElectronUtilityPtyHostProcess } from '../../../platform/process/ptyHost/electronUtilityProcessAdapter'
import { createTestVoiceEngine, isTestVoiceEngineRequested } from './createTestVoiceEngine'

export function createMainVoiceService(): VoiceService {
  if (isTestVoiceEngineRequested()) {
    return new VoiceService(createTestVoiceEngine())
  }
  return new VoiceService(
    new LocalVoiceEngine({
      cacheDir: resolve(app.getPath('userData'), 'models'),
      // electron-vite emits voiceHost.js next to the main entry.
      createProcess: () =>
        createElectronUtilityPtyHostProcess(
          utilityProcess.fork(join(__dirname, 'voiceHost.js'), [], {
            stdio: 'pipe',
            serviceName: 'OpenCove Voice Engine',
          }),
        ),
      reportIssue: message => {
        if (process.env.NODE_ENV !== 'test') {
          process.stderr.write(`${message}\n`)
        }
      },
    }),
  )
}
