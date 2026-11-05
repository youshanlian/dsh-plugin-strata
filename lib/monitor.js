/**
 * Strata switch monitor: a tiny, dependency-free status server for the local
 * strata-hop router plus a dsh plugin that mirrors its state into the chat UI.
 *
 * The monitor never starts, stops or otherwise touches strata; it only reads:
 *   - `POST /unload` on strata-hop (read-only probe: unloads nothing when the
 *     path is not a POST or when the request carries no model),
 *   - the `models` catalog and `GET /v1/models`,
 *   - the journal (strata-hop starts/stops/ready lines), when readable.
 *
 * Writes are accepted only from loopback: `POST /events` (fed by the journal
 * follower) and `POST /probe`. The browser plugin reads `GET /events` at 1 Hz.
 */

import { createServer } from 'node:http'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { paramsApi } from './params.js'

const MAX_EVENTS = 40
const MAX_MSG = 220

/** Fold a free-form status line into the short phase taxonomy the UI renders. */
function classify (text) {
  const s = String(text ?? '')
  if (/ready: http|is ready|preloaded/.test(s)) return 'ready'
  if (/EngineDied|exited during startup|exit code 1|Traceback|failed|could not start|did not become ready/.test(s)) return 'failed'
  if (/loading the experts|experts loaded|filling the GPU/.test(s)) return 'loading_experts'
  if (/loading the model|starting the engine|loading the vision/.test(s)) return 'loading_model'
  if (/starting qwen|preloading/.test(s)) return 'starting'
  // The engine idle-unloads itself (`--idle-unload 3600`); that is not a hop
  // shutdown, so it must not be reported as a transient 'stopping'.
  if (/model unloaded|unloaded after \d+ s idle/.test(s)) return 'unloaded'
  if (/stopping|shutting down|unload/.test(s)) return 'stopping'
  if (/listening on|engine started/.test(s)) return 'starting'
  return 'unknown'
}

function stripJournalPrefix (text) {
  const value = String(text ?? '')
  // "10月 30 18:30:01 host program[pid]: message" (German/locale month names) and
  // "Oct 30 18:30:01 host program[pid]: message" (C locale).
  return value
    .replace(/^\S+(?:\s+\d{1,2})?\s+\d{1,2}:\d{2}:\d{2}\s+\S+\s+[\w.@-]+(?:\[\d+\])?:\s*/u, '')
    .replace(/^[A-Za-z]{3}\s+\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\s+\S+\s+[\w.@-]+(?:\[\d+\])?:\s*/u, '')
}

function clean (text) {
  const s = stripJournalPrefix(text).replace(/\s+/g, ' ').trim()
  return s.length > MAX_MSG ? `${s.slice(0, MAX_MSG - 1)}…` : s
}

function parseJson (text) {
  try { return JSON.parse(text) } catch { return undefined }
}

/** Derive a phase from the raw model log tail, when one is readable. */
function phaseFromLog (model) {
  if (typeof model.log !== 'string' || !model.log) return undefined
  try {
    if (!existsSync(model.log)) return undefined
    const text = readFileSync(model.log, 'utf8').slice(-20000)
    const lines = text.split('\n').filter((line) => line.trim() !== '')
    const last = lines[lines.length - 1] ?? ''
    // The last `engine started` line marks the current attempt.
    let startAt = -1
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (/engine started/.test(lines[i])) { startAt = i; break }
    }
    const tail = lines.slice(Math.max(startAt, lines.length - 40), lines.length + 1)
    const current = tail[tail.length - 1] ?? last
    if (/engine started/.test(current) && /per_layer_token_embd|native projection matrices/.test(current)) {
      // A trivial mismatch line sits right after `engine started`; treat it as progress.
      return { phase: 'loading_model', line: current }
    }
    const failed = tail.find((line) => /ggml_cuda_init: failed|exited before it was ready|Traceback/.test(line))
    if (failed !== undefined && /ggml_cuda_init: failed/.test(current)) {
      return { phase: 'failed', line: failed }
    }
    return { phase: classify(current), line: current }
  } catch {
    return undefined
  }
}

export function createMonitor (options = {}) {
  const hop = options.hop ?? 'http://127.0.0.1:8080'
  const apiKeyEnv = options.apiKeyEnv ?? 'STRATA_API_KEY'
  const hopConfig = options.hopConfig ?? ''
  // 调参 (run-config tuning): the trusted host-side proxy for hop's /config.
  // The browser cannot call hop /config itself (strata serve rejects a foreign
  // Origin with 403 and hop forwards it), so the GUI panel talks to these
  // monitor routes instead; we relay with the hop key and no Origin header.
  const params = paramsApi({ hop, readKey, hopConfigPath: hopConfig })
  const unit = options.unit ?? 'strata-hop.service'
  const probeIntervalMs = options.probeIntervalMs ?? 1000
  options.defaultModel = options.defaultModel ?? 'qwen3.8-flash-next-iq3_s'
  const port = options.port ?? 8756
  const host = options.host ?? '127.0.0.1'
  const HOME = process.env.HOME || homedir()

  /** Read the hop API key from the environment, falling back to its env file. */
  function readKey () {
    const fromEnv = process.env[apiKeyEnv]
    if (fromEnv) return fromEnv
    const envFile = join(HOME, '.config', 'strata', 'strata-hop.env')
    try {
      const prefix = new RegExp(`^\\s*(?:export\\s+)?${apiKeyEnv}\\s*=`)
      const line = readFileSync(envFile, 'utf8').split('\n').find((l) => prefix.test(l))
      if (!line) return ''
      return line.replace(prefix, '').trim().replace(/^["']|["']$/g, '')
    } catch {
      return ''
    }
  }

  let period = 0
  let lastProbe = 0
  let bootstrapped = false
  // Journal lines rarely name the model, so remember the last one we saw or
  // probed and use it to label the events that carry no name.
  let knownModel = null
  let cached = { status: 'unknown', detail: null, phase: 'unknown', at: 0 }
  const state = {
    updatedAt: 0,
    seq: 0,
    period,
    live: null,
    last: null,
    events: [],
    probeError: null
  }

  /** Read the model catalog hop served by `GET /v1/models`. */
  async function listModels () {
    const key = readKey()
    const response = await fetch(`${hop}/v1/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(4000)
    })
    if (!response.ok) throw new Error(`models HTTP ${response.status}`)
    const body = await response.json()
    return (body?.data ?? []).map((model) => String(model.id))
  }

  /** Probe the loaded model without side effects: `POST /loaded` is read-only.
   *  (The old probe sent an empty `POST /unload`, which hop honours by
   *  unloading the current model — it killed the engine every poll.) */
  async function probeModel (model) {
    const key = readKey()
    try {
      const response = await fetch(`${hop}/loaded`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: `Bearer ${key}` } : {})
        },
        body: '{}',
        signal: AbortSignal.timeout(4000)
      })
      const text = await response.text()
      if (!response.ok) {
        return { status: 'down', detail: `HTTP ${response.status}`, phase: 'failed', at: Date.now() }
      }
      const payload = parseJson(text)
      if (payload !== undefined && payload.loaded === model) {
        return { status: 'up', detail: 'loaded', phase: 'ready', model: String(payload.loaded), at: Date.now() }
      }
      const detail = payload !== undefined && payload.loaded === null ? 'nothing loaded' : `loaded: ${payload?.loaded ?? 'unknown'}`
      return { status: 'down', detail: detail.slice(0, 160), phase: 'unloaded', model: payload?.loaded ?? null, at: Date.now() }
    } catch (error) {
      return { status: 'down', detail: String(error?.message ?? error), phase: 'failed', model: null, at: Date.now() }
    }
  }

  /**
   * Ask the engine itself whether it is warm. hop forwards `GET /health` to the
   * running model server, and the server answers `"loaded": true|false`. This is
   * the only signal that catches the engine's self-inflicted idle unload: hop
   * still routes to the live process (so `POST /loaded` keeps answering the
   * model's name) even after the ~55 GB of experts have been dropped and will be
   * re-read by the next request. Journal lines alone cannot track it either,
   * because the in-process reload logs `loading the experts` but never re-logs a
   * ready line — which is what froze the GUI chip on 载入专家权重.
   */
  async function probeEngine (model) {
    const key = readKey()
    try {
      const response = await fetch(`${hop}/health`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: AbortSignal.timeout(5000)
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`health HTTP ${response.status}`)
      const payload = parseJson(text)
      const named = typeof payload?.model === 'string' && payload.model !== '' ? payload.model : model
      if (payload?.loaded === true) {
        return { status: 'up', detail: `${named} loaded`, phase: 'ready', model: named, at: Date.now() }
      }
      if (payload?.loaded === false) {
        return { status: 'idle', detail: `${named} idle-unloaded; the next request re-reads the experts`, phase: 'unloaded', model: named, at: Date.now() }
      }
      if (payload?.error?.message !== undefined) {
        // hop answers `idle: no model loaded` when it has no engine running.
        return { status: 'idle', detail: String(payload.error.message).slice(0, 160), phase: 'unloaded', model: null, at: Date.now() }
      }
    } catch {
      /* nothing for hop to proxy /health to: fall back to hop's bookkeeping */
    }
    const fallback = await probeModel(model)
    return { ...fallback, model: fallback.model ?? model }
  }

  /** Probe the hop itself; a refused connection means the router is gone. */
  async function probeHop () {
    try {
      const key = readKey()
      const response = await fetch(`${hop}/v1/models`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: AbortSignal.timeout(3000)
      })
      if (!response.ok) return { status: 'down', detail: `HTTP ${response.status}` }
      return { status: 'up', detail: null }
    } catch (error) {
      return { status: 'down', detail: String(error?.message ?? error) }
    }
  }

  /**
   * Run one probe round for the model that succeeded the current period.
   * Returns a `last` snapshot worth showing, or null when nothing changed.
   */
  async function probe () {
    const now = Date.now()
    if (now - lastProbe < probeIntervalMs) return null
    lastProbe = now

    const hopState = await probeHop()
    if (hopState.status !== 'up') {
      cached = { ...cached, ...hopState, at: now }
      state.probeError = hopState.detail
      return { status: 'down', detail: `strata-hop ${hopState.detail ?? 'unreachable'}`, phase: 'failed', at: now }
    }
    state.probeError = null
    let models = []
    try {
      models = await listModels()
    } catch (error) {
      state.probeError = String(error?.message ?? error)
      return null
    }
    let target = null
    if (state.last !== null && models.includes(state.last.model)) target = state.last.model
    else if (state.live !== null && models.includes(state.live.model)) target = state.live.model
    else if (models.length > 0) {
      // Journal events carry no model name, so never gate the live probe on
      // them: hop always knows which model it routes to, and probing it is
      // passive. Gating here used to leave the chip stuck on the last journal
      // line — `loading the experts` — forever after an idle unload/reload.
      bootstrapped = true
      target = models.includes(options.defaultModel) ? options.defaultModel : models[0]
    }
    if (target === null) return null

    const result = await probeEngine(target)
    const model = (typeof result.model === 'string' && result.model !== '')
      ? (models.find((name) => name === result.model) ?? result.model)
      : (models.find((name) => name === target) ?? target)
    if (result.phase !== cached.phase) {
      // Record the transition, not just the endpoint: after the engine reloads
      // itself mid-session it emits no ready line, so this is the only `ready`
      // event the timeline will ever see.
      pushEvent({ kind: result.phase, text: `probe: ${result.detail ?? result.phase}`, model })
    }
    cached = { ...result, at: now }
    return { ...result, model, period }
  }

  /** Ask hop to warm a model now (starts its engine, zero inference tokens). */
  async function warm (model, provider, { force = false } = {}) {
    if (typeof model !== 'string' || model === '') return { ok: false, error: 'missing model' }
    if (typeof provider === 'string' && provider !== 'strata') return { ok: false, skipped: `provider ${provider}` }
    const key = readKey()
    try {
      const response = await fetch(`${hop}/warm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: `Bearer ${key}` } : {})
        },
        body: JSON.stringify(force ? { model, force: true } : { model }),
        signal: AbortSignal.timeout(4000)
      })
      const text = await response.text()
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}: ${text.slice(0, 120)}` }
      const payload = parseJson(text)
      if (payload?.already) pushEvent({ kind: 'ready', text: `warm: ${model} already loaded`, model })
      else if (payload?.preloading) pushEvent({ kind: 'starting', text: `warm: switching to ${model}`, model })
      else if (payload?.skipped) pushEvent({ kind: 'ready', text: `warm: skipped, keeping ${payload.loaded}`, model: payload.loaded })
      return { ok: true, payload }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }

  /** Turn a journal line into a progress event, if it concerns model startup. */
  function ingestLine (line) {
    const text = String(line ?? '')
    if (!/\[strata-hop\]|loading the |engine started|ready: http|EngineDied|exited before it was ready|model unloaded/.test(text)) return
    // Strip the journal's "date time host process[pid]:" prefix when present.
    const body = text.replace(/^\S+ \d{1,2}:\d{2}:\d{2} \S+ \S+:\s*/, '')
    if (/exited during startup|did not become ready/.test(body) && !/starting qwen/.test(body)) return
    const match = /starting (qwen[^\s:]+)|preloading (qwen[^\s]+)|starting the engine|loading (?:the model|the experts|the vision)/.exec(body)
    if (match !== null || /ready: http|is ready|EngineDied|exit code 1|model unloaded/.test(body)) {
      const phase = classify(body)
      if (phase === 'unknown') return
      pushEvent({ kind: phase === 'failed' ? 'failed' : phase, text: clean(body) })
    }
  }

  function pushEvent (event) {
    period += 1
    state.period = period
    state.seq += 1
    // Most `[strata] ...` progress lines carry no model name; take it from the
    // line when present, otherwise from the model we last saw hop route to.
    const named = /qwen[\w.\-]+/.exec(String(event.text ?? ''))
    const model = (typeof event.model === 'string' && event.model !== '') ? event.model : (named?.[0] ?? knownModel)
    if (model !== null && model !== undefined) knownModel = model
    const line = {
      seq: state.seq,
      at: Date.now(),
      period,
      kind: event.kind,
      phase: event.kind,
      text: clean(event.text ?? ''),
      model: model ?? null
    }
    state.events.push(line)
    if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS)
    state.live = { model: line.model, period, phase: line.phase, text: line.text, at: line.at }
    if (line.phase === 'ready' || line.phase === 'failed' || line.phase === 'unloaded') {
      state.last = { ...state.live, period }
    }
    state.updatedAt = line.at
    return line
  }

  /** Fill `last` from the raw model log so a fresh monitor is not blind. */
  function seedFromLogs () {
    if (!hopConfig) return
    let config
    try {
      config = parseJson(readFileSync(hopConfig, 'utf8'))
    } catch {
      return
    }
    for (const [name, model] of Object.entries(config?.models ?? {})) {
      const derived = phaseFromLog({ ...model, log: model.log ?? model.log_path })
      if (derived === undefined) continue
      if (derived.phase === 'ready' || derived.phase === 'failed') {
        period += 1
        state.period = period
        state.last = { model: name, period, phase: derived.phase, text: clean(derived.line), at: Date.now() }
        state.live = null // let the first live probe refine it
        lastProbe = 0
        break
      }
    }
  }

  async function snapshot () {
    const changed = await probe()
    if (changed !== null) {
      state.live = { model: changed.model ?? state.live?.model ?? null, period, phase: changed.phase, text: clean(changed.detail), at: changed.at }
      if (changed.phase === 'ready' || changed.phase === 'failed') state.last = { ...state.live, period }
      state.updatedAt = changed.at
    }
    return {
      ok: true,
      host: unit,
      hop,
      updatedAt: state.updatedAt,
      period,
      live: state.live,
      last: state.last,
      events: state.events.slice(-MAX_EVENTS),
      probeError: state.probeError
    }
  }

  function send (response, code, payload) {
    const text = JSON.stringify(payload)
    response.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Content-Length': Buffer.byteLength(text)
    })
    response.end(text)
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://monitor.invalid')
    if (request.method === 'GET' && (url.pathname === '/events' || url.pathname === '/health')) {
      snapshot().then((payload) => send(response, 200, payload)).catch((error) => send(response, 500, { ok: false, error: String(error?.message ?? error) }))
      return
    }
    if (request.method === 'POST' && url.pathname === '/events') {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { body += chunk; if (body.length > 65536) request.destroy() })
      request.on('end', () => {
        const payload = parseJson(body)
        if (payload === undefined) { send(response, 400, { ok: false, error: 'invalid json' }); return }
        const lines = Array.isArray(payload.lines) ? payload.lines : [payload.text ?? '']
        const model = typeof payload.model === 'string' ? payload.model : null
        const before = state.events.length
        for (const line of lines) ingestLine(line)
        if (state.events.length > before) state.events[state.events.length - 1].model = model
        send(response, 200, { ok: true })
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/probe') {
      snapshot().then((payload) => send(response, 200, payload)).catch((error) => send(response, 500, { ok: false, error: String(error?.message ?? error) }))
      return
    }
    // 调参：读当前模型的 run-config 键（hop /config；未加载时回落到 profile 文件视图）。
    if (request.method === 'GET' && url.pathname === '/params') {
      params.get().then((payload) => send(response, 200, payload)).catch((error) => send(response, 500, { ok: false, error: String(error?.message ?? error) }))
      return
    }
    // 调参：保存改动（经 hop POST /config，只改正在加载的模型的配置）。
    if (request.method === 'POST' && url.pathname === '/params') {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { body += chunk; if (body.length > 65536) request.destroy() })
      request.on('end', () => {
        const payload = parseJson(body)
        if (payload === undefined || payload.set === undefined) { send(response, 400, { ok: false, error: 'expect {"set": {"<key>": <value|null>, …}}' }); return }
        params.set(payload.set).then((result) => send(response, 200, result)).catch((error) => send(response, 500, { ok: false, error: String(error?.message ?? error) }))
      })
      return
    }
    // 调参：让保存的值立刻生效（hop /unload + /warm force —— 只重启引擎，不发 prompt、不耗 token）。
    if (request.method === 'POST' && url.pathname === '/restart') {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { body += chunk; if (body.length > 65536) request.destroy() })
      request.on('end', () => {
        const payload = parseJson(body)
        const model = typeof payload?.model === 'string' && payload.model !== '' ? payload.model : undefined
        params.restart(model).then((result) => send(response, 200, result)).catch((error) => send(response, 500, { ok: false, error: String(error?.message ?? error) }))
      })
      return
    }
    // 聊天设置：读 serve 与各应用共享的默认值（hop GET /settings；仅引擎加载时有值）。
    if (request.method === 'GET' && url.pathname === '/settings') {
      params.settings().then((payload) => send(response, 200, payload)).catch((error) => send(response, 500, { ok: false, error: String(error?.message ?? error) }))
      return
    }
    // 聊天设置：保存（hop POST /settings，全量替换语义；立即生效、持久化，不需要重启）。
    if (request.method === 'POST' && url.pathname === '/settings') {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { body += chunk; if (body.length > 65536) request.destroy() })
      request.on('end', () => {
        const payload = parseJson(body)
        if (payload === undefined || payload.defaults === undefined) { send(response, 400, { ok: false, error: 'expect {"defaults": {"<key>": <value|null>, …}} 或 {"defaults": null}（清空）' }); return }
        params.setSettings(payload.defaults).then((result) => send(response, 200, result)).catch((error) => send(response, 500, { ok: false, error: String(error?.message ?? error) }))
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/') {
      send(response, 200, { ok: true, name: 'strata-switch-monitor', unit, hop })
      return
    }
    send(response, 404, { ok: false, error: 'not found' })
  })

  return {
    host,
    port,
    server,
    snapshot,
    pushEvent,
    warm,
    params,
    ingestLine,
    seedFromLogs,
    listen () {
      seedFromLogs()
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          server.off('error', reject)
          resolve(server.address())
        })
      })
    },
    async close () {
      await new Promise((resolve) => server.close(() => resolve()))
    },
    /** Follow the journal for `unit` by polling `journalctl --user -u` (no side effects). */
    followJournalOnChip () {
      // Placeholder: journal following lives in the plugin host (dsh), which
      // already has a subprocess service; the monitor itself stays passive.
    }
  }
}

/** Discover strata models declared in a strata-hop config, for the journal follower. */
export function modelsOfHopConfig (path) {
  try {
    const config = JSON.parse(readFileSync(path, 'utf8'))
    return Object.keys(config?.models ?? {})
  } catch {
    return []
  }
}

export { classify, clean, stripJournalPrefix, readdirSync, join, execFile }
