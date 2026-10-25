import { invokeControlSurface } from '../invoke.mjs'
import { readFlagValue, requireFlagValue } from '../args.mjs'
import { createNodeFromArgs, parseSpaceLocator } from './nodeControl.mjs'

const SUBMIT_DELAY_MS = 300
const DEFAULT_READ_LINES = 40

export const AGENT_GUIDE = `OpenCove orchestrator guide

You can drive other AI agents (Claude Code, Codex, OpenCode) on this canvas.

1. Find agents.
   opencove agent list [--space <id>]
   Each entry has id, title, status, spaceId, sessionId. Use id as --node.

2. Spawn a worker in a space when none fits.
   opencove agent spawn --space <id> [--provider <id>] [--model <id>] [--title <text>] [--prompt <text>]
   Use opencove space list to find space ids. The output includes the new node id.

3. Send a prompt.
   opencove agent prompt --node <id> --text "<task>"
   Give each worker one clear, self-contained task: the goal, the files or inputs,
   the constraints, and what "done" looks like. Workers do not see your context.

4. Poll until the worker is done.
   opencove agent read --node <id> [--lines <n>]
   Re-read every 15-30 seconds. The worker is busy while a spinner, "esc to interrupt",
   or streaming output is visible. It is done when it shows its idle input prompt again.
   Answer any question or permission prompt it shows with agent prompt.

5. Collect results.
   Read more lines (--lines 200) or ask the worker to write its result to a file,
   then check that file yourself. Verify the work before you report it.

Rules
- One task per worker. Spawn more workers for parallel work; never give two workers the same files.
- Do not send a new prompt to a worker that is still busy.
- Never kill or delete agents you did not spawn.
`

function fail(message) {
  process.stderr.write(`[opencove] ${message}\n`)
  process.exit(2)
}

function printJson(value, pretty) {
  process.stdout.write(`${pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)}\n`)
}

const ESCAPE_SEQUENCE =
  // eslint-disable-next-line no-control-regex -- terminal escape sequences start with ESC.
  /\u001b\[([0-?]*)[ -/]*([@-~])|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()*+][0-~]|\u001b[ -~]/gu

export function screenToTailLines(serializedScreen, lineCount) {
  const text = serializedScreen
    .replace(ESCAPE_SEQUENCE, (_match, params, final) =>
      final === 'C' ? ' '.repeat(Number.parseInt(params, 10) || 1) : '',
    )
    .replace(/(?!\n)\p{Cc}/gu, '')
  const lines = text
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)
  return lines.slice(-lineCount)
}

async function invokeOrExit(connection, request, { pretty, timeoutMs }) {
  const { result } = await invokeControlSurface(connection, request, { timeoutMs })
  if (!result || result.ok === false) {
    printJson(result, pretty)
    process.exit(1)
  }
  return result
}

async function resolveAgentSession(connection, nodeId, options) {
  const result = await invokeOrExit(
    connection,
    { kind: 'query', id: 'node.get', payload: { nodeId } },
    options,
  )
  const sessionId = result.value?.node?.sessionId
  if (!sessionId) {
    fail(`node ${nodeId} has no running session`)
  }
  return sessionId
}

export async function tryHandleAgentControlCommands({
  command,
  args,
  connection,
  pretty,
  timeoutMs,
}) {
  if (command === 'agent' && args[1] === 'list') {
    const space = parseSpaceLocator(args)
    const projectId = readFlagValue(args, '--project')
    const result = await invokeOrExit(
      connection,
      {
        kind: 'query',
        id: 'node.list',
        payload: {
          kind: 'agent',
          ...(space ? { space } : {}),
          ...(projectId ? { projectId } : {}),
        },
      },
      { pretty, timeoutMs },
    )
    const agents = (result.value?.nodes ?? []).map(node => ({
      id: node.id,
      title: node.title,
      status: node.status ?? null,
      spaceId: node.spaceId ?? null,
      sessionId: node.sessionId ?? null,
    }))
    printJson({ __opencoveControlEnvelope: true, ok: true, value: { agents } }, pretty)
    return true
  }

  if (command === 'agent' && args[1] === 'spawn') {
    await createNodeFromArgs({ kind: 'agent', args, connection, pretty, timeoutMs })
    return true
  }

  if (command === 'agent' && args[1] === 'prompt') {
    const nodeId = requireFlagValue(args, '--node')
    const text = requireFlagValue(args, '--text')
    const sessionId = await resolveAgentSession(connection, nodeId, { pretty, timeoutMs })
    const write = data =>
      invokeOrExit(
        connection,
        { kind: 'command', id: 'session.writeNode', payload: { nodeId, sessionId, data } },
        { pretty, timeoutMs },
      )
    // Agent TUIs treat text and Enter arriving in one chunk as a paste and do not submit it.
    await write(text)
    await new Promise(resolve => setTimeout(resolve, SUBMIT_DELAY_MS))
    printJson(await write('\r'), pretty)
    return true
  }

  if (command === 'agent' && args[1] === 'read') {
    const nodeId = requireFlagValue(args, '--node')
    const rawLines = readFlagValue(args, '--lines')
    const lineCount = rawLines ? Number(rawLines) : DEFAULT_READ_LINES
    if (!Number.isInteger(lineCount) || lineCount <= 0) {
      fail(`invalid --lines: ${rawLines}`)
    }
    const sessionId = await resolveAgentSession(connection, nodeId, { pretty, timeoutMs })
    const result = await invokeOrExit(
      connection,
      { kind: 'query', id: 'session.presentationSnapshot', payload: { sessionId } },
      { pretty, timeoutMs },
    )
    const lines = screenToTailLines(result.value?.serializedScreen ?? '', lineCount)
    process.stdout.write(lines.length > 0 ? `${lines.join('\n')}\n` : '')
    return true
  }

  return false
}
