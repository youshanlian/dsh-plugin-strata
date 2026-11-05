/**
 * Strata run-config tuning (调参) — the dsh side of strata serve's `GET/POST /config`
 * (runconfig.py, the #564 Settings view).
 *
 * Why this exists at all: strata serve answers /config only for its own page
 * (`_own_page`: a foreign browser Origin is refused with 403), and hop forwards
 * every non-hop-header it receives — the browser's Origin included. So a browser
 * cannot talk to /config through hop directly. This module is the trusted proxy:
 * it runs on the host (the monitor server / the plugin tool), sends no Origin,
 * authenticates with the hop key, and mirrors runconfig's key list and value
 * checks so bad input is refused before anything is written.
 *
 * Semantics that must survive the trip (strata reads the run config when the
 * engine starts): a saved change is used from the **next start** of the model.
 * `restart()` applies it immediately: hop `POST /unload` then `POST /warm
 * {force:true}` — a config-only reload, it never sends a prompt and costs no
 * inference tokens (a cold engine start of ~25 s of load time is the only cost).
 *
 * Writes are only accepted while an engine is loaded, so the file hop itself
 * owns (strata-<model>.json) is never edited behind its back. When hop is down,
 * or nothing is loaded, `get()` falls back to a read of the model's profile
 * file — same key view, flagged `source: 'file'`, `writable: false`.
 */

import { readFileSync } from 'node:fs'

/** Mirrors runconfig.py's EDITABLE list (kind, choices, zh name + help for the GUI). */
export const PARAM_SPEC = [
  { key: 'sampling.temperature', name: '采样温度', kind: 'number', help: '请求不带 temperature 时的默认值（0 = 贪心；不设则按模型卡：思考 1.0 / 非思考 0.7）' },
  { key: 'sampling.top_p', name: '核采样 top_p', kind: 'number', rule: '0<x<=1', help: '请求不带 top_p 时的默认值（0 < x ≤ 1）' },
  { key: 'sampling.top_k', name: 'top_k', kind: 'number', rule: '1..64', help: '请求不带 top_k 时的默认值（1–64 的整数）' },
  { key: 'sampling.min_p', name: 'min_p', kind: 'number', rule: '0<=x<=1', help: '请求不带 min_p 时的默认值（0 ≤ x ≤ 1）' },
  { key: 'reasoning_budget_tokens', name: '思考预算（token）', kind: 'number', rule: 'int>=0', help: '把每个请求的思考量限制在这个 token 数（0 或空 = 不限制）' },
  { key: 'fit_max_tokens', name: '自动压缩 max_tokens', kind: 'bool', help: 'max_tokens 放不下上下文时自动缩短（默认开）；关掉则像 llama.cpp 一样回 400' },
  { key: 'anthropic_thinking', name: 'Anthropic 思考策略', kind: 'enum', choices: ['model', 'on_request'], help: 'Anthropic 请求没要思考时：按模型自己的方式（model）或不思考（on_request）' },
  { key: 'effort_position', name: '推理力度句位置', kind: 'enum', choices: ['start', 'end'], help: '非默认推理力度写在提示的开头（start，默认）还是结尾（end：改动时保住 KV 缓存）' },
  { key: 'aliases', name: '别名', kind: 'names', help: '服务器一并列出并应答的其他模型名（逗号分隔）' },
  { key: 'idle_unload_s', name: '闲置自动卸载（秒）', kind: 'number', rule: 'num>=0', help: '多少秒没有请求后卸载模型（0 或空 = 永不）' },
  { key: 'mtp', name: '草稿层（MTP）', kind: 'bool', help: '草稿层（MTP）：关掉则引擎启动时不带它（约省 1 GB 显存，出字更慢）；空或开 = 按安装原样' },
  { key: 'lazy_load', name: '懒加载', kind: 'bool', help: '启动时不加载模型；第一个请求才加载（仅纯文本模型可用）' },
  { key: 'engine_silence_s', name: '引擎沉默超时（秒）', kind: 'number', rule: 'num>=0', help: '引擎沉默超过这么久就结束请求（默认 300 秒，0 = 一直等）' },
  { key: 'api_monitor', name: '请求记录器', kind: 'bool', help: '在内存里保留最近 100 个请求的提示与回答（/api-monitor）' },
  { key: 'open_browser', name: '自动打开浏览器', kind: 'bool', help: '模型就绪时在浏览器打开聊天页' },
  { key: 'vram_reserve_mib', name: '预留显存（MiB）', kind: 'number', rule: 'int>=0', help: '引擎为其他程序预留的显存 MiB（引擎默认 700）' },
]

/**
 * serve 的「聊天设置」（POST /settings，与所有应用共享的默认值）：请求自己没带这些参数时用它。
 * 保存即生效（不用重启），持久化在 <profile>.shared-settings.json。
 * 镜像 serve clean_shared_defaults() 的键与校验。
 */
export const SHARED_SPEC = [
  { key: 'reasoning_effort', name: '思考档位', kind: 'enum', choices: ['none', 'low', 'medium', 'high'], help: '请求不带 reasoning_effort 时用的档位（none = 不思考）。dsh 模型选择器里选了 Effort 的请求会自带档位，那种情况以请求为准。' },
  { key: 'temperature', name: '采样温度', kind: 'number', help: '0–2 的数字；0 = 贪心（同问同答）。立即生效；dsh 请求不带 temperature，所以这条对 dsh 聊天直接有用' },
  { key: 'top_p', name: '核采样 top_p', kind: 'number', rule: '0<x<=1', help: '0 < top_p ≤ 1' },
  { key: 'top_k', name: 'top_k', kind: 'number', rule: '1..64', help: '1–64 的整数' },
  { key: 'seed', name: '随机种子', kind: 'number', rule: 'int>0', help: '正整数；固定后可复现采样（想恢复随机就留空清除）' },
  { key: 'max_tokens', name: '最大输出 token', kind: 'number', rule: 'int>0', help: '请求不带 max_tokens 时的输出上限。dsh 的请求总是自带 max_tokens，这条主要作用于其他应用。' },
  { key: 'reasoning_budget_tokens', name: '思考预算（token）', kind: 'number', rule: 'int>=0', help: '把思考量限制在这个 token 数（0 = 不限制）；覆盖运行配置里的同名键' },
  { key: 'experimental_speed_projection', name: '实验性速度预测', kind: 'bool', help: '实验开关：开或关' },
]

const NOTE = '已保存到该模型的运行配置；从模型的下一次启动起生效。'
const NOTE_SHARED = '聊天设置对「没带该参数」的请求立即生效，无需重启；会持久化，重启后仍在。dsh 明确自带的参数（max_tokens、选了 Effort 时的 reasoning_effort）以请求为准。'

function numberRule (key, value, { whole = false, lo = 0, hi = undefined, loOpen = false } = {}) {
  if (typeof value !== 'number' || Number.isNaN(value) || (whole && value !== Math.trunc(value))) {
    throw new Error(`${key}: 需要${whole ? '整数' : '数字'}，不是 ${JSON.stringify(value)}`)
  }
  if (loOpen ? value <= lo : value < lo) throw new Error(`${key}: 需要${loOpen ? '>' : '≥'} ${lo}`)
  if (hi !== undefined && value > hi) throw new Error(`${key}: 需要 ≤ ${hi}`)
  return whole ? Math.trunc(value) : value
}

function ruleOf (spec) {
  if (spec.rule !== undefined) return spec.rule
  if (spec.key === 'sampling.temperature') return 'num>=0'
  if (spec.key === 'sampling.top_p') return '0<x<=1'
  if (spec.key === 'sampling.top_k') return '1..64'
  if (spec.key === 'sampling.min_p') return '0<=x<=1'
  return 'num>=0'
}

/** Mirrors runconfig.check(): the value to store, or a throw naming what is expected. */
export function checkValue (key, value) {
  const spec = PARAM_SPEC.find((entry) => entry.key === key)
  if (spec === undefined) throw new Error(`${key}: 不在可调键列表里`)
  if (value === null) return null
  if (spec.kind === 'bool') {
    if (typeof value !== 'boolean') throw new Error(`${key}: 需要 true 或 false`)
    return value
  }
  if (spec.kind === 'enum') {
    if (!spec.choices.includes(value)) throw new Error(`${key}: 需要 ${spec.choices.join(' / ')} 之一`)
    return value
  }
  if (spec.kind === 'names') {
    const list = Array.isArray(value)
      ? value
      : String(value).split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')
    if (list.length === 0) return null
    if (!list.every((entry) => typeof entry === 'string' && entry.trim() !== '' && entry.length <= 128)) {
      throw new Error(`${key}: 需要模型名列表`)
    }
    return list
  }
  switch (ruleOf(spec)) {
    case 'int>=0': return numberRule(key, value, { whole: true })
    case '1..64': return numberRule(key, value, { whole: true, lo: 1, hi: 64 })
    case '0<x<=1': return numberRule(key, value, { hi: 1, loOpen: true })
    case '0<=x<=1': return numberRule(key, value, { hi: 1 })
    default: return numberRule(key, value)
  }
}

/** 聊天设置（/settings）的取值校验，镜像 serve 的 clean_shared_defaults()。null/空 = 不带该键（清除）。 */
export function checkSharedValue (key, value) {
  const spec = SHARED_SPEC.find((entry) => entry.key === key)
  if (spec === undefined) throw new Error(`${key}: 不是聊天设置的键（可设：${SHARED_SPEC.map((entry) => entry.key).join(', ')}）`)
  if (value === null || value === '') return null
  if (key === 'reasoning_effort') {
    if (!['none', 'low', 'medium', 'high'].includes(value)) throw new Error(`${key}: 需要 none / low / medium / high`)
    return value
  }
  if (key === 'experimental_speed_projection') {
    if (typeof value !== 'boolean') throw new Error(`${key}: 需要 true 或 false`)
    return value
  }
  switch (key) {
    case 'temperature': return numberRule(key, value, { hi: 2 })
    case 'top_p': return numberRule(key, value, { hi: 1, loOpen: true })
    case 'top_k': return numberRule(key, value, { whole: true, lo: 1, hi: 64 })
    case 'seed': case 'max_tokens': return numberRule(key, value, { whole: true, lo: 0, loOpen: true })
    default: return numberRule(key, value, { whole: true })
  }
}

const NAME_BY_KEY = new Map(PARAM_SPEC.map((entry) => [entry.key, entry.name]))

/** 给 hop /config 返回的 keys 补上中文名称（hop 自己不带 name）。 */
function withNames (json) {
  if (Array.isArray(json?.keys)) {
    json.keys = json.keys.map((entry) => ({ ...entry, ...(NAME_BY_KEY.get(entry.key) !== undefined ? { name: NAME_BY_KEY.get(entry.key) } : {}) }))
  }
  return json
}

/** The GET /config-shaped view of a model's profile file (read-only fallback). */
export function viewOfProfile (cfg, file) {
  const keys = PARAM_SPEC.map((spec) => {
    let value = null
    if (spec.key.startsWith('sampling.')) {
      const block = cfg.sampling
      if (block !== null && typeof block === 'object') value = block[spec.key.slice('sampling.'.length)] ?? null
    } else if (spec.key === 'vram_reserve_mib') {
      const args = Array.isArray(cfg.args) ? cfg.args : []
      const at = args.indexOf('--vram-reserve-mib')
      if (at >= 0 && at + 1 < args.length) {
        const raw = Number(args[at + 1])
        value = Number.isFinite(raw) ? raw : args[at + 1]
      }
    } else {
      value = cfg[spec.key] ?? null
    }
    return { key: spec.key, name: spec.name, value, help: spec.help, kind: spec.kind, ...(spec.choices !== undefined ? { choices: spec.choices } : {}) }
  })
  return { file, keys, note: NOTE }
}

/** Read hop's current model without side effects (`POST /loaded` is a query). */
async function currentLoaded (hop, key) {
  try {
    const response = await fetch(`${hop}/loaded`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: '{}',
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) return { error: `HTTP ${response.status}` }
    const body = await response.json()
    return { loaded: body?.loaded ?? null }
  } catch (error) {
    return { error: String(error?.message ?? error) }
  }
}

/** The default model hop would start from its own config file. */
function defaultModelOf (hopConfigPath) {
  try {
    const cfg = JSON.parse(readFileSync(hopConfigPath, 'utf8'))
    const models = cfg?.models ?? {}
    if (typeof cfg?.default_model === 'string' && models[cfg.default_model] !== undefined) return cfg.default_model
    return Object.keys(models)[0] ?? null
  } catch {
    return null
  }
}

/**
 * `readKey` is the plugin/monitor's key reader (hop's api key); `hopConfigPath`
 * is strata-hop.json (to find profile paths for the read-only fallback).
 */
export function paramsApi ({ hop, readKey, hopConfigPath }) {
  async function hopJson (method, path, body, timeoutMs = 6000) {
    const key = readKey()
    const response = await fetch(`${hop}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    let json
    try { json = JSON.parse(text) } catch { json = undefined }
    return { status: response.status, json, raw: json === undefined ? text.slice(0, 300) : undefined }
  }

  function fileView (model) {
    try {
      const hopCfg = JSON.parse(readFileSync(hopConfigPath, 'utf8'))
      const entry = hopCfg?.models?.[model]
      const profile = typeof entry?.profile === 'string' ? entry.profile : undefined
      if (profile === undefined) return { ok: false, error: `hop 配置里没有 ${model} 的 profile 路径` }
      const cfg = JSON.parse(readFileSync(profile, 'utf8'))
      return { ok: true, ...viewOfProfile(cfg, profile), model, source: 'file', loaded: null, writable: false }
    } catch (error) {
      return { ok: false, error: `读取 profile 失败：${String(error?.message ?? error)}` }
    }
  }

  return {
    /** The current model's tunable keys (live via hop /config, else the file view). */
    async get () {
      const where = await currentLoaded(hop, readKey())
      if (where.loaded !== null && where.loaded !== undefined) {
        const result = await hopJson('GET', '/config', undefined)
        if (result.json?.keys !== undefined) return { ok: true, ...withNames(result.json), model: where.loaded, source: 'hop', loaded: where.loaded, writable: true }
        return { ok: false, error: `hop /config HTTP ${result.status}${result.raw !== undefined ? ` ${result.raw}` : ''}`, model: where.loaded }
      }
      const model = defaultModelOf(hopConfigPath)
      if (model === null) return { ok: false, error: where.error !== undefined ? `hop 不可用（${where.error}），且 hop 配置读不出默认模型` : 'hop 没有模型，也没有默认模型可显示' }
      return fileView(model)
    },

    /** Save changes through hop /config — only while an engine is loaded. */
    async set (values) {
      if (values === null || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length === 0) {
        return { ok: false, error: '没有要保存的改动（{"<key>": <value 或 null>, …}；null = 清除、回默认）' }
      }
      let checked
      try {
        checked = {}
        for (const [key, value] of Object.entries(values)) checked[key] = checkValue(key, value)
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
      const where = await currentLoaded(hop, readKey())
      if (where.loaded === null || where.loaded === undefined) {
        return { ok: false, error: '当前没有模型加载：调参只改正在运行的引擎的配置，请先在 dsh 里选择 strata 模型（引擎会预热）再保存。' }
      }
      const result = await hopJson('POST', '/config', { set: checked }, 10000)
      if (result.json?.keys === undefined) {
        return { ok: false, error: `hop /config HTTP ${result.status}${result.raw !== undefined ? ` ${result.raw}` : ''}` }
      }
      return { ok: true, ...withNames(result.json), model: where.loaded, source: 'hop', loaded: where.loaded, writable: true }
    },

    /** serve 的「聊天设置」（POST /settings，与所有应用共享）：当前值 + 规格。仅引擎加载时可用。 */
    async settings () {
      const where = await currentLoaded(hop, readKey())
      if (where.loaded === null || where.loaded === undefined) {
        return { ok: false, error: '当前没有模型加载：聊天设置由正在运行的引擎持有，请先在 dsh 里选择 strata 模型（引擎会预热）。' }
      }
      const result = await hopJson('GET', '/settings', undefined)
      if (result.json === undefined) {
        return { ok: false, error: `hop /settings HTTP ${result.status}${result.raw !== undefined ? ` ${result.raw}` : ''}` }
      }
      return {
        ok: true,
        keys: SHARED_SPEC,
        values: result.json.defaults ?? {},
        shared: result.json.shared === true,
        model: where.loaded,
        loaded: where.loaded,
        writable: true,
        note: NOTE_SHARED,
      }
    },

    /**
     * 保存聊天设置（全量替换语义，serve 如此）：values 里没带的键会被清除；
     * null / 空清除。立即生效，无需重启；持久化在 profile 旁边的 shared-settings.json。
     */
    async setSettings (values) {
      if (values === null) {
        const where = await currentLoaded(hop, readKey())
        if (where.loaded === null || where.loaded === undefined) return { ok: false, error: '当前没有模型加载：请先加载模型再清除聊天设置。' }
        const cleared = await hopJson('POST', '/settings', { defaults: null }, 10000)
        if (cleared.json?.error !== undefined) return { ok: false, error: String(cleared.json.error?.message ?? cleared.raw ?? '清除失败') }
        return { ok: true, shared: false, values: {}, model: where.loaded, loaded: where.loaded, writable: true, note: NOTE_SHARED }
      }
      if (values === undefined || typeof values !== 'object' || Array.isArray(values)) {
        return { ok: false, error: '聊天设置需要对象 {"<key>": <value 或 null>, …}；null / 空 = 清除该键。注意是全量替换：没带的键会被清除。' }
      }
      let defaults
      try {
        defaults = {}
        for (const [key, value] of Object.entries(values)) {
          const checkedValue = checkSharedValue(key, value)
          if (checkedValue !== null) defaults[key] = checkedValue
        }
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
      const where = await currentLoaded(hop, readKey())
      if (where.loaded === null || where.loaded === undefined) {
        return { ok: false, error: '当前没有模型加载：聊天设置由正在运行的引擎持有，请先加载模型再保存。' }
      }
      const result = await hopJson('POST', '/settings', { defaults }, 10000)
      if (result.json?.error !== undefined) return { ok: false, error: String(result.json.error?.message ?? result.raw ?? '保存失败') }
      if (result.json?.defaults === undefined) return { ok: false, error: `hop /settings HTTP ${result.status}${result.raw !== undefined ? ` ${result.raw}` : ''}` }
      return {
        ok: true,
        keys: SHARED_SPEC,
        values: result.json.defaults ?? {},
        shared: result.json.shared === true,
        model: where.loaded,
        loaded: where.loaded,
        writable: true,
        note: NOTE_SHARED,
      }
    },

    /** Apply saved values now: unload, then warm the same model with force. No prompt tokens. */
    async restart (model) {
      const where = await currentLoaded(hop, readKey())
      const target = model ?? where.loaded
      if (target === null || target === undefined) return { ok: false, error: '没有要重启的模型（当前未加载，且未点名模型）' }
      if (where.loaded !== null && where.loaded !== undefined) await hopJson('POST', '/unload', { model: where.loaded })
      const warm = await hopJson('POST', '/warm', { model: target, force: true }, 10000)
      if (warm.json?.ok !== true) return { ok: false, error: `预热失败：HTTP ${warm.status}${warm.raw !== undefined ? ` ${warm.raw}` : ''}` }
      return { ok: true, restarting: target, note: '引擎正在按新配置重新加载（约 25 秒）。' }
    },
  }
}
