import { describe, expect, it } from 'vitest'
import { convertX10MouseReportsToSgr } from '../../../src/platform/process/pty/x10Mouse'

describe('convertX10MouseReportsToSgr', () => {
  it('converts low-byte motion reports so ConPTY does not type their payload', () => {
    expect(convertX10MouseReportsToSgr('one\u001b[MCABtwo')).toBe('one\u001b[<35;33;34Mtwo')
  })

  it('converts high-byte reports beyond column 95', () => {
    expect(convertX10MouseReportsToSgr('\u001b[M È%')).toBe('\u001b[<0;168;5M')
  })

  it('converts consecutive reports and leaves other input alone', () => {
    expect(convertX10MouseReportsToSgr('\u001b[MCWG\u001b[MCXFhi\u001b[A')).toBe(
      '\u001b[<35;55;39M\u001b[<35;56;38Mhi\u001b[A',
    )
  })

  it('keeps a truncated report untouched', () => {
    expect(convertX10MouseReportsToSgr('\u001b[MC')).toBe('\u001b[MC')
  })
})
