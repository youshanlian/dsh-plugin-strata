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

await monitor.close()
console.log('closed; smoke OK')
