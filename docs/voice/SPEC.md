# Voice Control ("Jarvis") Spec

Status: approved 2026-10-25 (hotkey changed to Alt+X, rebindable). Plan steps 1 to 4 done.

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
| Text to speech | `onnx-community/Kokoro-82M-v1.0-ONNX`, q8, voice `bm_george` | 5.1 s to make 5.1 s of audio (q4 is now used; see "Model precision") |
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
- Kokoro speed is the same in plain Node 26 and in the `utilityProcess`.

### Model precision (step 3, measured 2026-10-25)

| Kokoro dtype | Size | Compute per 1 s of audio | Output |
| --- | --- | --- | --- |
| `q8` | 92 MB | 1.3 s (gaps between sentences) | clean |
| `fp16` | 163 MB | n/a | **all-NaN audio for 3 of 6 test sentences: never use** |
| `fp32` | 326 MB | 0.28 s | clean |
| `q4` (chosen) | 40 MB | 0.25 s | clean |

The fp16 NaN audio plays as silence and makes Whisper print `!!!!` until its token limit. The host now rejects any chunk with non-finite samples. Whisper `q8` on clean speech: 5 of 6 test sentences exact (it hears "Codex" as "codecs"), about 0.7 s per sentence. With q4 Kokoro in the built app's host: model load 2.5 s from cache, first audio 0.64 s, 14.3 s of speech made in 4.3 s with no playback gaps, worst main-thread lag 16 ms.

## Why the models run outside the renderer

The production CSP is `script-src 'self'` and `connect-src 'self'`. That blocks WebAssembly compilation and model downloads in the renderer, and `tests/unit/security/contentSecurityPolicy.spec.ts` locks it. Loosening it would weaken the app's security. Running inference in a main-side `utilityProcess` keeps the CSP unchanged, uses native CPU code (faster than WASM), and keeps heavy work off the main and renderer threads.

## Flow

```
renderer: hold key -> getUserMedia -> MediaRecorder -> release -> decodeAudioData -> 16 kHz mono PCM
  -> IPC voice:transcribe -> utilityProcess (Whisper) -> text
renderer: controlSurface session.writeNode(boss, text), wait 300 ms, write "\r"
renderer: ptyEventHub.onSessionState(boss) sees working -> standby (only states after the Enter count)
  -> session.finalMessage (retry 5 x 220 ms until it differs from the reply before the prompt)
  -> reply text -> pick spoken part
  -> IPC voice:speak -> utilityProcess (Kokoro) streams one audio chunk per sentence
renderer: play chunks in order with WebAudio
```

### What gets spoken

Each voice prompt gets this text appended on the same line, after a space: `(Voice request: end your reply with a line starting "SAY:" holding a 1-3 sentence spoken summary.)` It stays on one line because a newline inside an agent TUI prompt can submit early or open a multi-line editor. The app speaks only the last non-empty `SAY:` line, and accepts markdown decoration such as `**SAY:**`. If the boss leaves it out, the app speaks the first 3 sentences of the reply, without code blocks, headings, or markdown markers.

## Module layout (`src/contexts/voice/`)

| Layer | Contents |
| --- | --- |
| `domain` | `VoiceSettings` type, defaults, `normalizeVoiceSettings`; `VoiceTurnState` machine; `splitIntoSentences`; `pickSpokenText` (SAY: line or first 3 sentences) |
| `application` | `VoiceEngine` port; `VoiceService`, the owner of the model load state (`idle`, `loading`, `ready`, `error`); `createVoiceTurnController`, which drives each turn through the state machine and runs its side effects behind injected ports |
| `infrastructure` | `localEngine/`: `LocalVoiceEngine` (main side) forks `voiceHostEntry` in a `utilityProcess` (Whisper + Kokoro, model cache under userData `models/`); `voiceHostHandler` runs requests one at a time there |
| `presentation/main-ipc` | Invoke: `voice:prepare`, `voice:get-status`, `voice:transcribe`, `voice:speak`, `voice:cancel-speak`. Events: `voice:status` (to all windows), `voice:speak-chunk` (to the requesting window). All payloads are validated at the boundary |
| `presentation/renderer` | `voiceApi.ts` (the only file touching `window.opencoveApi`), `micRecorder`, `speechPlayer`, `bossChannel` (`askBoss`, `listVoiceBossAgents`), `useVoiceAssistant` hook (key down/up, blur cancels), `VoiceIndicator` overlay, `VoiceSection` (the Voice tab of Settings > Agent) |

`AppShell.tsx` is at 497 of 500 lines, so the hook mounts through `AppShellOverlays`.

The microphone uses MediaRecorder and resamples on release with `decodeAudioData` in a 16 kHz `OfflineAudioContext`. An AudioWorklet would need its own module URL; this path needs no extra script and no CSP change. The microphone is open only while the key is held.

### `VoiceEngine` port

```ts
interface VoiceEngine {
  readonly id: VoiceEngineId // 'local' now, 'openai-realtime' later
  prepare(onProgress: (p: VoiceModelProgress) => void): Promise<void>
  transcribe(pcm16k: Float32Array): Promise<string>
  speak(text: string, voice: KokoroVoiceId, signal: AbortSignal): AsyncIterable<VoiceAudioChunk>
  onUnavailable(listener: (reason: string) => void): () => void // models lost, e.g. process exit
  dispose(): Promise<void>
}
```

Aborting `signal` stops speech after the current sentence. When the utility process exits, every pending request fails, `VoiceService` returns to `idle`, and the next request forks a new process and loads again.

The OpenAI Realtime engine implements the same port. Its `transcribe` and `speak` call the Realtime API. A later version can let Realtime hold the conversation itself and pass work to the Claude boss as a tool call.

### Turn state machine

`idle -> listening -> transcribing -> sending -> waiting -> speaking -> idle`

Any active state can go to `error(reason)` or `cancelled`. Reasons: `no-speech`, `no-boss` (no boss chosen, or its node was closed; the microphone never opens), `mic-failed`, `transcribe-failed`, `send-failed`, `speak-failed`. Releasing the key within 300 ms (`MIN_VOICE_HOLD_MS`) cancels `listening`, and so does window blur. Pressing the key during `speaking` stops playback and starts `listening`. Pressing during `waiting` also starts a new turn, so a boss on a long task never blocks the microphone. Pressing during `listening`, `transcribing`, or `sending` does nothing, so only one turn runs at a time. Every event carries a turn id, and an event for any turn but the active one is ignored. This is how a late standby from an abandoned turn is dropped. The machine is `reduceVoiceTurn` in `domain/voiceTurn.ts`.

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
2. Domain and settings (pure code, unit tests). Done. The `voice.pushToTalk` keybinding moved to step 4, because adding a command needs Shortcuts labels and strings.
3. Engine in the utility process and IPC. Done.
4. Renderer: capture, hook, indicator, settings page, `voice.pushToTalk` keybinding, en and zh-CN strings. Done.
5. E2E, manual check, CHANGELOG.
