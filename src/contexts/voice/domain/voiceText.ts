/** Appended to every voice prompt so the boss hands back a short line meant to be heard. */
export const VOICE_REPLY_INSTRUCTION =
  '(Voice request: end your reply with a line starting "SAY:" holding a 1-3 sentence spoken summary.)'

const FALLBACK_SENTENCE_COUNT = 3

// Abbreviations whose trailing period does not end a sentence.
const ABBREVIATIONS = new Set(['e.g.', 'i.e.', 'etc.', 'vs.', 'mr.', 'mrs.', 'ms.', 'dr.', 'st.'])

/**
 * Builds the text typed into the boss terminal. It stays on one line: a newline inside an agent
 * TUI prompt can submit early or open a multi-line editor, depending on the agent.
 */
export function buildVoicePrompt(transcript: string): string {
  return `${transcript.trim()} ${VOICE_REPLY_INSTRUCTION}`
}

export function splitIntoSentences(text: string): string[] {
  const sentences: string[] = []
  for (const line of text.split(/\n+/)) {
    let current = ''
    for (const word of line.split(/\s+/).filter(Boolean)) {
      current = current ? `${current} ${word}` : word
      if (/[.!?]["')\]]*$/.test(word) && !ABBREVIATIONS.has(word.toLowerCase())) {
        sentences.push(current)
        current = ''
      }
    }
    if (current) {
      sentences.push(current)
    }
  }
  return sentences
}

/** Kokoro reads at most 510 phoneme tokens per call; 200 characters stays well below that. */
export const MAX_SPEECH_CHUNK_CHARS = 200

/**
 * Splits text into the pieces synthesized one at a time: sentences, with an overlong sentence cut
 * at clause punctuation first and at word boundaries last.
 */
export function chunkForSpeech(text: string, maxChars = MAX_SPEECH_CHUNK_CHARS): string[] {
  return splitIntoSentences(text).flatMap(sentence => splitLongText(sentence, maxChars))
}

function splitLongText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text]
  }

  const clauses = text.split(/(?<=[,;:])\s+/)
  if (clauses.length > 1) {
    // A packed chunk holds several clauses or one overlong clause; only the latter recurses.
    return packPieces(clauses, maxChars).flatMap(chunk => splitLongText(chunk, maxChars))
  }

  const words = text
    .split(/\s+/)
    .flatMap(word => word.match(new RegExp(`.{1,${maxChars}}`, 'g')) ?? [])
  return packPieces(words, maxChars)
}

function packPieces(pieces: string[], maxChars: number): string[] {
  const chunks: string[] = []
  let current = ''
  for (const piece of pieces) {
    const joined = current ? `${current} ${piece}` : piece
    if (joined.length <= maxChars || !current) {
      current = joined
      continue
    }
    chunks.push(current)
    current = piece
  }
  if (current) {
    chunks.push(current)
  }
  return chunks
}

/** The SAY: line when the boss wrote one, otherwise the first sentences of the reply. */
export function pickSpokenText(reply: string): string | null {
  const sayLine = findLastSayLine(reply)
  if (sayLine !== null) {
    return sayLine
  }

  const sentences = splitIntoSentences(stripMarkdown(reply)).slice(0, FALLBACK_SENTENCE_COUNT)
  return sentences.length > 0 ? sentences.join(' ') : null
}

function findLastSayLine(reply: string): string | null {
  const lines = reply.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    // Tolerates markdown decoration such as "**SAY:** ..." or "> SAY: ...".
    const match = /^[\s>*_-]*SAY:[*_]*\s*(.*)$/i.exec(lines[index])
    const spoken = match?.[1].replace(/[*_]+$/, '').trim()
    if (spoken) {
      return spoken
    }
  }
  return null
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/^\s*#{1,6}\s.*$/gm, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+\.|>)\s+/gm, '')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
}
