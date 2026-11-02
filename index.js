/**
 * dsh-plugin-strata — 把三件事合并为一个插件：
 *
 *   1. strata 接入 dsh    —— bundle 自带 cordis.patch.yml，默认提供 provider `strata`
 *                            （baseURL 走 strata-hop :8080，模型 id 必须与 hop 配置里的键一致）；
 *   2. 模型切换路由       —— `strata_hop` 工具管理 127.0.0.1:8080 的 strata-hop
 *                            （status / models / warm / logs；路由源码在 router/）；
 *   3. 切换状态监控       —— 状态服务（默认 :8756）+ GUI 顶部芯片 + `strata_status` 工具，
 *                            并在 GUI 选中 strata 模型时立刻 POST /warm 预热引擎。
 *
 * 约定：对推理只读。本插件不发 prompt、不消耗 token；发往 hop 的请求只有
 * GET /v1/models、只读 POST /loaded（查询当前加载，不改状态）、
 * POST /warm（拉起引擎，幂等，无 token）——切换本身仍由 dsh 选模型触发。
 *
 * @module dsh-plugin-strata
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createMonitor, modelsOfHopConfig } from './lib/monitor.js'

export const name = 'dsh-plugin-strata'
export const inject = ['tools', 'sessions']

const HOME = process.env.HOME || homedir()

export const Config = z.object({
  hopUrl: z.string().default('http://127.0.0.1:8080'),
  hopConfig: z.string().default(join(HOME, '.config', 'strata', 'strata-hop.json')),
  hopEnvFile: z.string().default(join(HOME, '.config', 'strata', 'strata-hop.env')),
  apiKeyEnv: z.string().default('STRATA_API_KEY'),
  unit: z.string().default('strata-hop.service'),
  host: z.string().default('127.0.0.1'),
  port: z.number().default(8756),
  followJournal: z.boolean().default(true),
  pollSeconds: z.number().default(2),
  warmOnSelection: z.boolean().default(true),
  warmProvider: z.string().default('strata'),
})

/** Format a snapshot as the short text an agent (or a human) reads. */
function summarize (snapshot) {
  const lines = []
  const where = snapshot.live ?? snapshot.last
  if (where === null || where === undefined) {
    lines.push('strata: 暂无观测数据（monitor 刚启动）')
  } else {
    lines.push(`strata 当前: ${where.model ?? 'unknown'} · ${where.phase} · ${where.text ?? ''}`)
  }
  if (typeof snapshot.probeError === 'string' && snapshot.probeError !== '') lines.push(`探测错误: ${snapshot.probeError}`)
  const events = (snapshot.events ?? []).slice(-8)
  if (events.length > 0) {
    lines.push('最近事件:')
    for (const event of events) lines.push(`  ${new Date(event.at).toLocaleTimeString('zh-CN')} [${event.phase}] ${event.text}`)
  }
  return lines.join('\n')
}

/** Key for the hop router: env first, then the env file strata-hop itself uses. */
function readKey (config) {
  const fromEnv = process.env[config.apiKeyEnv]
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv
  try {
    if (!existsSync(config.hopEnvFile)) return undefined
    const prefix = new RegExp(`^\\s*(?:export\\s+)?${config.apiKeyEnv}\\s*=`)
    const line = readFileSync(config.hopEnvFile, 'utf8').split('\n').find((entry) => prefix.test(entry))
    if (line === undefined) return undefined
    return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '')
  } catch {
    return undefined
  }
}

function hopConfigJson (config) {
  try { return JSON.parse(readFileSync(config.hopConfig, 'utf8')) } catch { return undefined }
}

/** Call the hop router's control endpoints (never chat completions). */
async function hopFetch (config, method, path, body) {
  const key = readKey(config)
  const response = await fetch(`${config.hopUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(key !== undefined ? { authorization: `Bearer ${key}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let json
  try { json = JSON.parse(text) } catch { json = undefined }
  return { status: response.status, json, raw: json === undefined ? text.slice(0, 200) : undefined }
}

function run (cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 1 << 20 }, (error, stdout) => resolve(error === null ? String(stdout) : ''))
  })
}

export function apply (ctx, config) {
  const monitor = createMonitor({
    hop: config.hopUrl,
    hopConfig: config.hopConfig,
    apiKeyEnv: config.apiKeyEnv,
    unit: config.unit,
    host: config.host,
    port: config.port,
    probeIntervalMs: config.pollSeconds * 1000,
  })

  const ready = monitor.listen().then(
    () => ctx.logger?.info?.(`dsh-plugin-strata: monitor listening on http://${config.host}:${config.port}/events`),
    (error) => {
      ctx.logger?.warn?.(`dsh-plugin-strata: cannot listen on ${config.host}:${config.port}: ${String(error?.message ?? error)}`)
    },
  )

  let follower = null
  // Warm a model the moment a session selects it. Selection is written on the
  // server when the GUI chooses a model, so the hop engine boots before the
  // first inference request instead of during it. Only providers routed to the
  // hop are touched (`warmProvider`); cloud selections are ignored outright.
  ctx.on('session/event', (session, event) => {
    if (!config.warmOnSelection || event.type !== 'model/selection') return
    const model = event.data?.model
    const provider = event.data?.provider ?? config.warmProvider
    if (typeof model !== 'string' || model === '') return
    if (provider !== config.warmProvider) return
    monitor.warm(model, provider).then((result) => {
      if (result?.ok === false && result.error) ctx.logger?.warn?.(`dsh-plugin-strata: warm ${model} failed: ${result.error}`)
    }).catch(() => { /* hop offline; the next request triggers it anyway */ })
  })

  const stopFollower = () => {
    if (follower !== null) {
      try { follower.kill() } catch { /* already gone */ }
      follower = null
    }
  }
  const startFollower = () => {
    stopFollower()
    if (!config.followJournal) return
    // `journalctl --user -f -u <unit> -o cat` is a passive reader. If systemd's
    // journal is unreachable the process exits; retry with backoff.
    follower = spawn('journalctl', ['--user', '-f', '-n', '0', '-u', config.unit, '-o', 'cat'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let buffer = ''
    follower.stdout?.setEncoding('utf8')
    follower.stdout?.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line.trim() !== '') monitor.ingestLine(line)
    })
    follower.once('exit', () => { follower = null })
  }
  const restartTimer = setInterval(() => {
    if (config.followJournal && follower === null) startFollower()
  }, 5000)
  startFollower()

  ctx.effect(() => () => {
    clearInterval(restartTimer)
    stopFollower()
    monitor.close().catch(() => {})
    ctx.logger?.info?.('dsh-plugin-strata: stopped')
  }, 'dsh-plugin-strata: monitor lifecycle')

  // Tool 1 (功能 3): the read-only monitor view the GUI chip shows.
  ctx.tools.register(defineTool({
    name: 'strata_status',
    description:
      'Read the state of the local strata model router: which model is loaded, its current startup phase (starting / loading_model / loading_experts / ready / failed), the latest journal line, and recent events. Read-only: never changes which model is loaded.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summarize(value) }],
    },
    async execute () {
      await ready
      return monitor.snapshot()
    },
  }))

  // Tool 2 (功能 2): manage the strata-hop :8080 switching router itself.
  ctx.tools.register(defineTool({
    name: 'strata_hop',
    description:
      'Manage the strata-hop model-switching router on port 8080. Actions: status = router state (loaded model, served ids, systemd unit state, hop config default/preload); models = catalog ids from hop config + ids dsh serves; warm = preload one model without any inference tokens (idempotent — the actual switch happens by selecting the model in dsh, this only warms it first so the engine boots before, not during, the first request); logs = recent router journal. status, models and logs never change what is loaded; warm only starts an engine.',
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'models', 'warm', 'logs'], description: 'what to do' },
      model: { type: 'string', description: 'model id for warm (one of the catalog ids, verbatim)' },
      lines: { type: 'number', description: 'journal lines for logs (default 30, max 200)' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
    },
    async execute (input) {
      await ready
      const action = input?.action
      if (action === 'warm') {
        if (typeof input.model !== 'string' || input.model === '') return { ok: false, error: 'warm needs a model id (see action=models first)' }
        return monitor.warm(input.model, config.warmProvider)
      }
      if (action === 'logs') {
        const n = Math.max(1, Math.min(200, Number(input?.lines) || 30))
        const out = await run('journalctl', ['--user', '-n', String(n), '-o', 'cat', '-u', config.unit])
        return { unit: config.unit, lines: out.split('\n').filter((line) => line.trim() !== '').slice(-n) }
      }
      const [models, loaded, unitState] = await Promise.all([
        hopFetch(config, 'GET', '/v1/models'),
        hopFetch(config, 'POST', '/loaded', {}),
        run('systemctl', ['--user', 'is-active', config.unit]).then((out) => out.trim() === '' ? 'unknown' : out.trim()),
      ])
      const hop = hopConfigJson(config) ?? {}
      const served = Array.isArray(models.json?.data) ? models.json.data.map((entry) => entry?.id ?? entry) : []
      if (action === 'models') {
        return { servedFromHop: served, catalog: Object.keys(hop.models ?? {}), note: 'dsh model ids = hop config keys; pick one in the GUI selector, warm() preloads it' }
      }
      return {
        hopUrl: config.hopUrl,
        unit: config.unit,
        service: unitState,
        loaded: loaded.json?.loaded ?? null,
        served,
        catalog: Object.keys(hop.models ?? {}),
        defaultModel: hop.default_model,
        preloadModel: hop.preload_model,
        upstreamPort: hop.upstream_port,
      }
    },
  }))
}

/** Exported for unit tests. */
export { summarize }
