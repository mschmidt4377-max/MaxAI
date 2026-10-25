export function convertX10MouseReportsToSgr(data: string): string {
  // X10 mouse report: ESC [ M + 3 bytes where each byte is 32-255:
  // - button + 32
  // - x + 32 (1-indexed cell coords)
  // - y + 32 (1-indexed cell coords)
  //
  // ConPTY's input parser does not recognize X10 reports: it drops the ESC [ M prefix
  // and forwards the 3 payload bytes as typed text. Convert every report to SGR:
  //   ESC [ < button ; x ; y M
  // which ConPTY translates into console mouse events.
  const prefix = '\u001b[M'
  let cursor = 0
  let converted = ''

  while (cursor < data.length) {
    const nextIndex = data.indexOf(prefix, cursor)
    if (nextIndex === -1) {
      converted += data.slice(cursor)
      break
    }

    converted += data.slice(cursor, nextIndex)

    if (nextIndex + 5 >= data.length) {
      converted += data.slice(nextIndex)
      break
    }

    const buttonByte = data.charCodeAt(nextIndex + 3)
    const xByte = data.charCodeAt(nextIndex + 4)
    const yByte = data.charCodeAt(nextIndex + 5)

    const isCandidate =
      buttonByte >= 32 &&
      buttonByte <= 255 &&
      xByte >= 32 &&
      xByte <= 255 &&
      yByte >= 32 &&
      yByte <= 255

    if (!isCandidate) {
      converted += prefix
      cursor = nextIndex + prefix.length
      continue
    }

    const button = buttonByte - 32
    const x = xByte - 32
    const y = yByte - 32
    converted += `\u001b[<${button};${x};${y}M`
    cursor = nextIndex + 6
  }

  return converted
}
