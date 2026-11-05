/**
 * Standalone smoke test for the monitor half of dsh-plugin-strata.
 * Boots the status server, probes the live hop router (read-only:
 * GET /v1/models + POST /loaded only), feeds synthetic journal lines,
 * prints a snapshot, and shuts everything down. Never starts engines,
 * never sends prompts, never consumes tokens.
 *
 *   node tools/smoke.js [--port 8757]
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createMonitor, modelsOfHopConfig } from '../lib/monitor.js'

const argIndex = process.argv.indexOf('--port')
const port = argIndex >= 0 ? Number(process.argv[argIndex + 1]) : 8757
const HOME = process.env.HOME || homedir()

const monitor = createMonitor({
  hop: process.env.STRATA_HOP_URL ?? 'http://127.0.0.1:8080',
  hopConfig: join(HOME, '.config', 'strata', 'strata-hop.json'),
  apiKeyEnv: 'STRATA_API_KEY',
  unit: 'strata-hop.service',
  host: '127.0.0.1',
  port,
  probeIntervalMs: 500,
})

const catalog = modelsOfHopConfig(join(HOME, '.config', 'strata', 'strata-hop.json'))

await monitor.listen()
console.log(`monitor listening on http://127.0.0.1:${port}/events (hop catalog: ${catalog.join(', ') || 'n/a'})`)

const before = await monitor.snapshot()
console.log('probe snapshot:', JSON.stringify(before.live ?? before.last ?? null))

monitor.ingestLine('[strata-hop] loading the model qwen3.8-flash-next-uncensored-iq3m')
monitor.ingestLine('[strata-hop] loading the experts')
monitor.ingestLine('[strata-hop] ready: http://127.0.0.1:8081  (qwen3.8-flash-next-uncensored-iq3m)')

const after = await monitor.snapshot()
console.log('journal snapshot phase:', after.live?.phase ?? after.last?.phase ?? JSON.stringify(after.events?.slice(-3)))
console.log('events tail:', JSON.stringify(after.events?.slice(-3) ?? []))

const http = await fetch(`http://127.0.0.1:${port}/events`).then((response) => response.json())
console.log('http /events ok:', http.ok === true)

// 调参路由：GET 只读；POST 只测会被拒绝的输入（校验失败/空改动都在写 hop 之前就返回，
// 不产生任何副作用；/restart 会真重启引擎，冒烟里不触发）。
const params = await fetch(`http://127.0.0.1:${port}/params`).then((response) => response.json())
console.log('http /params:', params.ok === true ? `ok source=${params.source} loaded=${params.loaded} keys=${params.keys?.length}` : `not ok: ${params.error}`)
const post = async (path, body) => fetch(`http://127.0.0.1:${port}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}).then((response) => response.json())
const badValue = await post('/params', { set: { 'sampling.top_p': 3 } })
console.log('POST /params top_p=3 rejected:', badValue.ok === false ? `yes (${badValue.error})` : 'NO — BUG')
const emptySet = await post('/params', { set: {} })
console.log('POST /params empty rejected:', emptySet.ok === false ? 'yes' : 'NO — BUG')
const junkBody = await fetch(`http://127.0.0.1:${port}/params`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })
console.log('POST /params malformed ->', junkBody.status === 400 ? '400 yes' : `NO — BUG (${junkBody.status})`)

// 聊天设置路由：GET 只读（引擎没加载时返回友好错误，不算失败）；
// POST 只测被 monitor 挡下的缺参请求，不产生写入。
const settings = await fetch(`http://127.0.0.1:${port}/settings`).then((response) => response.json())
console.log('http /settings:', settings.ok === true ? `ok shared=${settings.shared} keys=${settings.keys?.length}` : `not writable: ${settings.error}`)
const noDefaultsResponse = await fetch(`http://127.0.0.1:${port}/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
const noDefaults = await noDefaultsResponse.json().catch(() => ({}))
console.log('POST /settings without defaults ->', noDefaultsResponse.status === 400 && String(noDefaults.error ?? '').includes('defaults') ? '400 yes' : `NO — BUG (${noDefaultsResponse.status} ${JSON.stringify(noDefaults)})`)

await monitor.close()
console.log('closed; smoke OK')
