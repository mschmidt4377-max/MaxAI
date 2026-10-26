export const enVoiceShortcuts = {
  group: {
    title: 'Voice',
    help: 'Hold the key to talk to your boss agent. Release it to send.',
  },
  command: {
    title: 'Push to Talk',
    help: 'Hold to record a voice command for the boss agent.',
  },
}

export const enVoice = {
  voice: {
    settings: {
      groupTitle: 'Voice control',
      groupHelp:
        'Hold the push-to-talk key, speak a command, and the boss agent runs it. Speech stays on this computer.',
      enabledLabel: 'Enable voice control',
      enabledHelp:
        'The speech models (about 120 MB) download the first time. Later starts use the copy on disk.',
      engineLabel: 'Engine',
      engineHelp: 'Local runs Whisper and Kokoro on this computer.',
      engineLocal: 'Local (Whisper + Kokoro)',
      engineRealtime: 'OpenAI Realtime',
      comingSoon: 'Coming soon',
      voiceLabel: 'Voice',
      voiceHelp: 'The voice that reads replies out loud.',
      bossLabel: 'Boss agent',
      bossHelp: 'The agent that receives your voice commands.',
      bossNone: 'None',
      bossMissing: 'Pick an agent. The one you chose before was closed.',
      bossNoAgents: 'Open an agent on the canvas first.',
      speakRepliesLabel: 'Speak replies',
      speakRepliesHelp: 'Read a short summary of the reply out loud when the boss finishes.',
      shortcutHelp: 'Push-to-talk key: {{shortcut}}. Change it in Settings > Quick Actions.',
    },
    indicator: {
      loadingModels: 'Loading voice models…',
      downloadingModel: 'Downloading {{file}} ({{percent}}%)',
      listening: 'Listening…',
      transcribing: 'Transcribing…',
      sending: 'Sending to {{boss}}',
      waiting: '{{boss}} is working',
      speaking: 'Speaking',
      cancelled: 'Cancelled',
      engineError: 'Voice models failed to load: {{message}}',
      errors: {
        'no-speech': 'No speech heard. Hold the key and try again.',
        'no-boss': 'Pick a boss agent in Settings > Agent > Voice.',
        'mic-failed': 'The microphone is not available.',
        'transcribe-failed': 'Could not turn the speech into text.',
        'send-failed': 'Could not send the command to the boss agent.',
        'speak-failed': 'Could not read the reply out loud.',
      },
    },
  },
}
