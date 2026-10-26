# Voice Control ("Jarvis") Spec

Status: approved 2026-10-25 (hotkey changed to Alt+X, rebindable). Plan step 1 (spike) done.

## Goal

Hold a key, speak a command, and a chosen boss agent runs it. When the boss finishes, a voice reads its answer out loud. This is the Windows equivalent of the CNVS voice loop.

The first engine is free and local: Whisper hears, Kokoro speaks. A paid OpenAI Realtime engine plugs into the same port later without changing callers.

## Industry reference

- CNVS (macOS): local NVIDIA Parakeet speech recognition, or OpenAI Realtime for two-way conversation.
- Push-to-talk follows the Discord and walkie-talkie model: hold to record, release to send.

## Feasibility (measured 2026-10-25 on the target Windows PC, Node 26, CPU only)

| Step | Model | Result |
| --- | --- | --- |
| Speech to text | `onnx-community/whisper-base.en`, q8 | 0.7 s for a 5 s clip, exact transcript |
| Text to speech | `onnx-community/Kokoro-82M-v1.0-ONNX`, q8, voice `bm_george` | 5.1 s to make 5.1 s of audio |
| First load | both, including download | about 60 s once; models are cached after |

Kokoro runs at about real time on this CPU. Speaking sentence by sentence (play sentence n while making sentence n+1) gets the first audio out in 1 to 2 s.

### Spike result: `utilityProcess` (plan step 1, done 2026-10-25)

Electron 41.5.1, `@huggingface/transformers` 3.8.1, `kokoro-js` 1.2.1, `onnxruntime-node` 1.21.0. The host was a CommonJS file loaded with `require`, the same form electron-vite emits for main entries.

| Check | Dev (`electron.exe <dir>`) | Packaged (`electron-builder --dir`, asar) |
| --- | --- | --- |
| `onnxruntime-node` loads, transformers picks the `onnx` backend | yes | yes |
| Model load (from local cache) | Kokoro 1.3 s, Whisper 1.4 s | Kokoro 1.1 s, Whisper 1.2 s |
| First sentence audio ready | 2.4 s | 2.3 s |
| Whisper on 8.6 s of audio | 1.0 s, exact transcript | 1.1 s, exact transcript |
| Worst main-thread event-loop lag during inference | 15 ms | 16 ms |

Facts the build must respect:

- `process.release.name` is `node` in a `utilityProcess`, so transformers uses `onnxruntime-node`, not WASM.
- `Float32Array` audio crosses `process.parentPort.postMessage` as a `Float32Array`. No manual encoding is needed.
- electron-builder's default smart unpack puts `onnxruntime-node` and `@img/sharp-win32-x64` (a transformers dependency loaded at import) into `app.asar.unpacked`. No `asarUnpack` rule is needed.
- kokoro-js reads voice files from its own package with `fs`. That works from inside the asar.
- The transformers default cache is inside its own package folder, which is read-only in the asar. The engine must set `env.cacheDir` to userData `models/`.
- The unpacked folder carries `onnxruntime-node` binaries for every OS (about 200 MB). The release build should exclude the other platforms.
- Kokoro speed is the same in plain Node 26 and in the `utilityProcess`: about 1.3 s of compute per 1 s of audio for short sentences. The first sentence plays within 2.5 s, but there are gaps between later sentences. Step 3 should measure `fp32` against `q8` and tune ONNX thread counts before relying on sentence pipelining alone.

## Why the models run outside the renderer

The production CSP is `script-src 'self'` and `connect-src 'self'`. That blocks WebAssembly compilation and model downloads in the renderer, and `tests/unit/security/contentSecurityPolicy.spec.ts` locks it. Loosening it would weaken the app's security. Running inference in a main-side `utilityProcess` keeps the CSP unchanged, uses native CPU code (faster than WASM), and keeps heavy work off the main and renderer threads.

## Flow

```
renderer: hold key -> getUserMedia -> AudioWorklet -> 16 kHz mono PCM
  -> IPC voice:transcribe -> utilityProcess (Whisper) -> text
renderer: controlSurface session.writeNode(boss, text), wait 300 ms, write "\r"
renderer: ptyEventHub.onSessionState(boss) sees working -> standby
  -> session.finalMessage (retry 5 x 220 ms) -> reply text -> pick spoken part
  -> IPC voice:speak -> utilityProcess (Kokoro) streams one audio chunk per sentence
renderer: play chunks in order with WebAudio
```

### What gets spoken

Each voice prompt gets one line appended: `(Voice request: end your reply with a line starting "SAY:" holding a 1-3 sentence spoken summary.)` The app speaks only the `SAY:` text. If the boss leaves it out, the app speaks the first 3 sentences of the reply.

## Module layout (`src/contexts/voice/`)

| Layer | Contents |
| --- | --- |
| `domain` | `VoiceSettings` type, defaults, `normalizeVoiceSettings`; `VoiceTurnState` machine; `splitIntoSentences`; `pickSpokenText` (SAY: line or first 3 sentences) |
| `application` | `VoiceEngine` port; `runVoiceTurn` use case that drives one turn through the state machine |
| `infrastructure` | `LocalVoiceEngine` running in a `utilityProcess` (Whisper + Kokoro, model cache under userData `models/`) |
| `presentation/main-ipc` | `voice:transcribe`, `voice:speak` (streamed chunks), `voice:status` (model download progress), all validated at the boundary |
| `presentation/renderer` | `voiceApi.ts` (the only file touching `window.opencoveApi`), `useVoiceAssistant` hook (key down/up, blur cancels), `VoiceIndicator` overlay, `VoiceSection` settings page |

`AppShell.tsx` is at 497 of 500 lines, so the hook mounts through `AppShellOverlays`.

### `VoiceEngine` port

```ts
interface VoiceEngine {
  readonly id: VoiceEngineId // 'local' now, 'openai-realtime' later
  prepare(onProgress: (p: VoiceModelProgress) => void): Promise<void>
  transcribe(pcm16k: Float32Array): Promise<string>
  speak(text: string, voice: string): AsyncIterable<VoiceAudioChunk>
  dispose(): Promise<void>
}
```

The OpenAI Realtime engine implements the same port. Its `transcribe` and `speak` call the Realtime API. A later version can let Realtime hold the conversation itself and pass work to the Claude boss as a tool call.

### Turn state machine

`idle -> listening -> transcribing -> sending -> waiting -> speaking -> idle`

Any state can go to `error(reason)` or `cancelled`. Releasing the key early cancels `listening`. Pressing the key during `speaking` stops playback and starts `listening`. Only one turn runs at a time. A standby event for a stale turn is ignored by matching a turn id.

## Settings (`agentSettings.voice`, durable user intent)

| Field | Type | Default |
| --- | --- | --- |
| `enabled` | boolean | `false` |
| `engine` | `'local' \| 'openai-realtime'` | `'local'` (`openai-realtime` shown as "coming soon") |
| `voice` | Kokoro voice id | `'bm_george'` |
| `bossNodeId` | string or null | `null` (settings lists agent nodes; a missing node falls back to `null`) |
| `speakReplies` | boolean | `true` |

Push-to-talk is a new keybinding command `voice.pushToTalk`, default `Alt+X`. Users rebind it in Settings > Shortcuts like any other command (`agentSettings.keybindings` overrides). It is handled with its own keydown/keyup tracking because the shared dispatcher is keydown only. Releasing either Alt or X ends the recording.

## Acceptance criteria

1. With voice enabled and a boss chosen, holding Alt+X, saying "list the agents", and releasing makes the boss receive that text as a prompt.
2. When the boss finishes, the George voice speaks its `SAY:` summary, starting within 3 s of the boss going standby.
3. The first use shows model download progress in the indicator. Later app starts do not download again.
4. The production CSP and its test are unchanged.
5. Changing the voice in settings changes the next spoken reply.
6. Releasing the key early, window blur, and pressing during speech all behave as the state machine says.
7. Rebinding push-to-talk in Settings > Shortcuts takes effect without restart.

## Verification

- Unit tests: `normalizeVoiceSettings` (old data with missing or invalid fields), the state machine, `splitIntoSentences`, `pickSpokenText`.
- Contract tests for the three IPC channels.
- One Playwright E2E with a stub engine: hold key, fake transcript reaches a stub agent, stub reply is "spoken" (chunk events observed).
- Manual check on the real PC with George.

## Plan

1. Spike: `onnxruntime-node` + kokoro-js + Whisper inside an Electron `utilityProcess`, dev and packaged build. Done; see "Spike result".
2. Domain and settings (pure code, unit tests).
3. Engine in the utility process and IPC.
4. Renderer: capture, hook, indicator, settings page, en and zh-CN strings.
5. E2E, manual check, CHANGELOG.
