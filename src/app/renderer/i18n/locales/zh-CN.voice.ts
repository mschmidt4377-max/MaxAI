export const zhCNVoiceShortcuts = {
  group: {
    title: '语音',
    help: '按住按键对主控 Agent 说话，松开即发送。',
  },
  command: {
    title: '按住说话',
    help: '按住以录制发给主控 Agent 的语音指令。',
  },
}

export const zhCNVoice = {
  voice: {
    settings: {
      groupTitle: '语音控制',
      groupHelp: '按住说话键，说出指令，主控 Agent 就会执行。语音只在本机处理。',
      enabledLabel: '启用语音控制',
      enabledHelp: '首次使用时会下载语音模型（约 120 MB），之后启动直接使用本地副本。',
      engineLabel: '引擎',
      engineHelp: '本地引擎在本机运行 Whisper 与 Kokoro。',
      engineLocal: '本地（Whisper + Kokoro）',
      engineRealtime: 'OpenAI Realtime',
      comingSoon: '即将推出',
      voiceLabel: '声音',
      voiceHelp: '朗读回复时使用的声音。',
      bossLabel: '主控 Agent',
      bossHelp: '接收语音指令的 Agent。',
      bossNone: '无',
      bossMissing: '请重新选择。之前选择的 Agent 已关闭。',
      bossNoAgents: '请先在画布上打开一个 Agent。',
      speakRepliesLabel: '朗读回复',
      speakRepliesHelp: '主控 Agent 完成后，朗读回复的简短摘要。',
      shortcutHelp: '按住说话键：{{shortcut}}。可在 设置 > 快捷操作 中修改。',
    },
    indicator: {
      loadingModels: '正在加载语音模型…',
      downloadingModels: '正在下载语音模型：{{percent}}%',
      listening: '正在聆听…',
      transcribing: '正在识别…',
      sending: '正在发送给 {{boss}}',
      waiting: '{{boss}} 正在工作',
      speaking: '正在朗读',
      cancelled: '已取消',
      engineError: '语音模型加载失败：{{message}}',
      errors: {
        'no-speech': '没有听到语音。请按住按键重试。',
        'no-boss': '请在 设置 > Agent > 语音 中选择主控 Agent。',
        'mic-failed': '麦克风不可用。',
        'transcribe-failed': '无法把语音转成文字。',
        'send-failed': '无法把指令发送给主控 Agent。',
        'speak-failed': '无法朗读回复。',
      },
    },
  },
}
