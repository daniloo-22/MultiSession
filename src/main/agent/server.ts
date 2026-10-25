import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain, type BrowserWindow } from 'electron'
import { AGENT_ENDPOINT_FILE, IPC, type AgentEndpoint } from '@shared/types'
import { writeJson } from '../storage'
import { RendererRpc } from './renderer-rpc'
import { createTools, ToolError } from './tools'

const MAX_BODY = 1024 * 1024

/**
 * Local control server for AI assistants. Listens on 127.0.0.1 only, on a random port,
 * and requires a per-run token. Port and token are written to userData, where the MCP
 * bridge (launched by the assistant) reads them.
 */
export function createAgentServer(getWindow: () => BrowserWindow | null) {
  const bindings = new Map<string, number>()
  ipcMain.on(IPC.bindTab, (_e, tabId: string, webContentsId: number) => bindings.set(tabId, webContentsId))
  ipcMain.on(IPC.unbindTab, (_e, tabId: string) => bindings.delete(tabId))

  const rpc = new RendererRpc(getWindow)
  const tools = createTools(rpc, bindings, (tabId) => getWindow()?.webContents.send(IPC.agentActivity, tabId))

  const endpointFile = (): string => join(app.getPath('userData'), AGENT_ENDPOINT_FILE)
  let server: Server | null = null
  let token = ''
  let port = 0

  const authorized = (req: IncomingMessage): boolean => {
    // Browsers always send Origin on cross-site POSTs; a Host check stops DNS rebinding.
    if (req.headers.origin || req.headers.host !== `127.0.0.1:${port}`) return false
    const given = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer /, ''))
    const expected = Buffer.from(token)
    return given.length === expected.length && timingSafeEqual(given, expected)
  }

  const readBody = async (req: IncomingMessage): Promise<unknown> => {
    let size = 0
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY) throw new ToolError('richiesta troppo grande')
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }

  function start(): void {
    if (server) return
    token = randomBytes(32).toString('hex')
    server = createServer(async (req, res) => {
      const reply = (status: number, body: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.method !== 'POST' || req.url !== '/call') return reply(404, { ok: false, error: 'not found' })
      if (!authorized(req)) return reply(403, { ok: false, error: 'forbidden' })
      try {
        const { tool, args } = (await readBody(req)) as { tool: string; args?: Record<string, unknown> }
        const handler = tools[tool]
        if (!handler) return reply(404, { ok: false, error: `tool sconosciuto: ${tool}` })
        reply(200, { ok: true, content: await handler(args ?? {}) })
      } catch (err) {
        reply(200, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server?.address()
      if (!address || typeof address === 'string') return
      port = address.port
      writeJson(endpointFile(), { port, token, pid: process.pid } satisfies AgentEndpoint)
    })
  }

  function stop(): void {
    server?.close()
    server = null
    rmSync(endpointFile(), { force: true })
  }

  return { start, stop, setEnabled: (enabled: boolean) => (enabled ? start() : stop()) }
}
