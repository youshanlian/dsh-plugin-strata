/**
 * Strata switch monitor — browser half.
 *
 * Renders a small live chip in the composer dock of the chat: what strata is
 * doing right now (which local model is loaded / loading / failed and the
 * progress line), seeded from the host monitor's `GET /events` status server and
 * refreshed once a second. Purely observational: it never switches models.
 *
 * @module strata-switch-monitor/client
 */
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'

const CSS = `
.ssm-chip{display:inline-flex;align-items:center;gap:6px;max-width:min(560px,100%);box-sizing:border-box;
  padding:3px 9px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1,#333);
  background:var(--dsw-alias-fill-l1,#1115);color:var(--dsw-alias-label-secondary,#888);
  font-size:11px;line-height:16px;white-space:nowrap;overflow:hidden;cursor:default;user-select:none}
.ssm-chip:hover{background:var(--dsw-alias-fill-l2,#1118)}
.ssm-dot{flex:none;width:7px;height:7px;border-radius:50%;background:#888}
.ssm-dot[data-phase=ready]{background:var(--dsw-alias-state-success-primary,#4caf50)}
.ssm-dot[data-phase=failed]{background:var(--dsw-alias-state-error-primary,#f44336)}
.ssm-dot[data-phase=starting],.ssm-dot[data-phase=loading_model],.ssm-dot[data-phase=loading_experts]{
  background:var(--dsw-alias-state-warning-primary,#ff9800);animation:ssm-pulse 1.1s ease-in-out infinite}
@keyframes ssm-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.ssm-model{flex:none;font-weight:600;color:var(--dsw-alias-label-primary,#ddd)}
.ssm-phase{flex:none}
.ssm-text{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary,#888)}
.ssm-open{padding:0 4px;border:0;background:none;color:inherit;cursor:pointer;font-size:11px}
.ssm-banner{margin:0 0 6px;padding:6px 10px;border-radius:8px;border:.5px solid var(--dsw-alias-state-warning-primary,#ff9800);
  background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#ff9800) 8%,transparent);
  color:var(--dsw-alias-label-secondary,#aaa);font-size:12px;line-height:17px;display:flex;gap:8px;align-items:flex-start}
.ssm-banner[data-phase=failed]{border-color:var(--dsw-alias-state-error-primary,#f44336);
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f44336) 8%,transparent)}
.ssm-banner-main{flex:1;min-width:0}
.ssm-banner-title{color:var(--dsw-alias-label-primary,#ddd);font-weight:600}
.ssm-list{margin:4px 0 0;padding:0;list-style:none;font-family:var(--dsw-font-mono,monospace);font-size:11px;
  color:var(--dsw-alias-label-tertiary,#888);max-height:150px;overflow:auto}
.ssm-dismiss{border:0;background:none;color:inherit;cursor:pointer;font-size:14px;line-height:16px;padding:0 2px}
.ssm-tune-root{position:relative;display:inline-flex;flex-direction:column;align-items:flex-start;gap:4px}
.ssm-tune-btn{padding:3px 9px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1,#333);
  background:var(--dsw-alias-fill-l1,#ffffff0d);color:var(--dsw-alias-label-secondary,#888);font-size:11px;line-height:16px;cursor:pointer}
.ssm-tune-btn:hover{background:var(--dsw-alias-fill-l2,#ffffff14);color:var(--dsw-alias-label-primary,#ddd)}
.ssm-tune-panel{position:absolute;bottom:calc(100% + 6px);left:0;z-index:40;width:min(540px,92vw);box-sizing:border-box;
  padding:8px 10px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l1,#333);
  background:var(--dsw-alias-bg-base-solid,#1b1b1b);box-shadow:0 6px 24px #0006;color:var(--dsw-alias-label-secondary,#888);font-size:12px;line-height:17px}
.ssm-tune-head{display:flex;gap:6px;align-items:center;margin-bottom:6px}
.ssm-tune-title{font-weight:600;color:var(--dsw-alias-label-primary,#ddd)}
.ssm-tune-tag{font-size:10px;padding:1px 6px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1,#333)}
.ssm-tune-rows{display:flex;flex-direction:column;gap:4px;max-height:44vh;overflow:auto}
.ssm-tune-row{display:flex;gap:8px;align-items:center}
.ssm-tune-key{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#ddd)}
.ssm-tune-row input,.ssm-tune-row select{width:130px;box-sizing:border-box;padding:2px 6px;border-radius:6px;
  border:.5px solid var(--dsw-alias-border-l1,#333);background:var(--dsw-alias-fill-l2,#ffffff14);color:var(--dsw-alias-label-primary,#ddd);font-size:12px}
.ssm-tune-row input::placeholder{color:var(--dsw-alias-label-tertiary,#888)}
.ssm-tune-hint{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary,#888);width:34px}
.ssm-tune-note{margin-top:6px;min-height:16px;color:var(--dsw-alias-state-warning-primary,#ff9800);font-size:11px;line-height:15px;white-space:normal}
.ssm-tune-actions{display:flex;gap:6px;margin-top:4px}
.ssm-tune-act{padding:3px 10px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l1,#333);
  background:var(--dsw-alias-fill-l2,#ffffff14);color:var(--dsw-alias-label-primary,#ddd);font-size:12px;cursor:pointer}
.ssm-tune-act:hover{background:var(--dsw-alias-fill-l3,#ffffff1a)}
.ssm-tune-act:disabled{opacity:.45;cursor:default}
.ssm-tune-foot{margin-top:6px;font-size:10px;color:var(--dsw-alias-label-tertiary,#888);line-height:14px;white-space:normal}
`

const PHASE_LABEL = {
  starting: '启动中',
  loading_model: '加载模型',
  loading_experts: '载入专家权重',
  ready: '就绪',
  failed: '启动失败',
  stopping: '卸载中',
  unloaded: '未加载',
  unknown: '未知',
}

const MODEL_LABEL = (model) => {
  if (typeof model !== 'string' || model === '') return 'strata'
  if (model.includes('uncensored')) return 'uncensored-iq3m'
  if (model.includes('iq3_s')) return 'iq3_s'
  return model
}

function injectCss () {
  if (typeof document === 'undefined') return
  const id = 'strata-switch-monitor/css'
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(id)}]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'strata-switch-monitor'
  tag.dataset.pluginCss = id
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/** Poll one endpoint, keeping the previous value on failure. */
function usePolled (url, ms) {
  const [snapshot, setSnapshot] = useState(null)
  useEffect(() => {
    let alive = true
    let timer = null
    const tick = async () => {
      try {
        const response = await fetch(url, { cache: 'no-store' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = await response.json()
        if (alive) setSnapshot(body)
      } catch {
        if (alive) setSnapshot((previous) => (previous === null ? previous : { ...previous, stale: true }))
      }
      if (alive) timer = setTimeout(tick, ms)
    }
    tick()
    return () => {
      alive = false
      if (timer !== null) clearTimeout(timer)
    }
  }, [url, ms])
  return snapshot
}

function currentOf (snapshot) {
  if (snapshot === null) return null
  const where = snapshot.live ?? snapshot.last
  if (where === null || where === undefined) return null
  return where
}

/** One compact chip: dot · model · phase · latest progress line. */
function StrataChip ({ url, ms }) {
  injectCss()
  const snapshot = usePolled(url, ms)
  const [open, setOpen] = useState(false)
  const where = currentOf(snapshot)
  if (where === null) return null
  const phase = PHASE_LABEL[where.phase] !== undefined ? where.phase : 'unknown'
  return jsxs('div', {
    className: 'ssm-chip',
    role: 'status',
    'aria-live': 'polite',
    title: where.text ?? '',
    children: [
      jsx('span', { className: 'ssm-dot', 'data-phase': phase }),
      jsx('span', { className: 'ssm-model', children: MODEL_LABEL(where.model) }),
      jsx('span', { className: 'ssm-phase', children: PHASE_LABEL[phase] }),
      where.text !== '' && where.text !== undefined
        ? jsx('span', { className: 'ssm-text', children: where.text })
        : null,
      snapshot?.events?.length > 0
        ? jsx('button', {
            type: 'button',
            className: 'ssm-open',
            title: open ? '收起' : '显示最近事件',
            onClick: () => setOpen((value) => !value),
            children: open ? '▾' : '▸',
          })
        : null,
      open
        ? jsx('ul', {
            className: 'ssm-list',
            children: (snapshot.events ?? []).slice(-12).map((event) =>
              jsx('li', {
                children: `${new Date(event.at).toLocaleTimeString('zh-CN')} [${event.phase}] ${event.text}`,
              }, String(event.seq)),
            ),
          })
        : null,
    ],
  })
}

/**
 * A banner while a switch is in flight or just failed, so the progress is
 * visible in the conversation itself rather than only in the chip.
 */
function StrataSwitchBanner ({ url, ms }) {
  injectCss()
  const snapshot = usePolled(url, ms)
  const [dismissed, setDismissed] = useState(null)
  const where = currentOf(snapshot)
  if (where === null) return null
  const phase = where.phase ?? 'unknown'
  const busy = ['starting', 'loading_model', 'loading_experts'].includes(phase)
  const failedPeriod = phase === 'failed' ? (where.period ?? 0) : null
  const visible = busy || (failedPeriod !== null && failedPeriod !== dismissed)
  if (!visible) return null
  const events = (snapshot.events ?? []).slice(-6)
  return jsxs('div', {
    className: 'ssm-banner',
    'data-phase': phase,
    role: 'status',
    children: [
      jsxs('div', {
        className: 'ssm-banner-main',
        children: [
          jsxs('div', {
            className: 'ssm-banner-title',
            children: `${MODEL_LABEL(where.model)} · ${PHASE_LABEL[phase] ?? phase}`,
          }),
          jsx('div', { children: where.text ?? '' }),
          events.length > 0
            ? jsx('ul', {
                className: 'ssm-list',
                children: events.map((event) =>
                  jsx('li', {
                    children: `${new Date(event.at).toLocaleTimeString('zh-CN')} [${event.phase}] ${event.text}`,
                  }, String(event.seq)),
                ),
              })
            : null,
        ],
      }),
      phase === 'failed'
        ? jsx('button', {
            type: 'button',
            className: 'ssm-dismiss',
            title: '关闭',
            onClick: () => setDismissed(failedPeriod),
            children: '×',
          })
        : null,
    ],
  })
}

const fmtParam = (entry) => {
  if (entry.kind === 'bool') return entry.value === true ? '1' : entry.value === false ? '0' : ''
  if (entry.kind === 'names') return Array.isArray(entry.value) ? entry.value.join(', ') : ''
  return entry.value === null || entry.value === undefined ? '' : String(entry.value)
}

const parseParam = (entry, raw) => {
  if (raw === '') return null
  if (entry.kind === 'bool') return raw === '1'
  if (entry.kind === 'number') {
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error(`${entry.key}: 需要数字，或留空表示清除`)
    return value
  }
  if (entry.kind === 'names') return raw.split(',').map((part) => part.trim()).filter((part) => part !== '')
  return raw
}

/**
 * 调参面板：编辑当前加载模型的 strata 运行配置（hop /config 的 GUI 半边）。
 * 读写都走宿主 monitor（:8756/params、/restart）——浏览器直连 hop 会被 strata
 * serve 的 _own_page Origin 检查拒掉，monitor 才是可信代理。保存只改下次启动用的
 * 配置；「重启生效」让 hop 卸载后带 force 重新预热该模型（约 25 秒、零 token）。
 * @param base - monitor 基址，如 http://<host>:8756。
 */
function StrataTune ({ base }) {
  injectCss()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [restarting, setRestarting] = useState(false)

  const load = async () => {
    try {
      const response = await fetch(`${base}/params`, { cache: 'no-store' })
      const body = await response.json()
      setData(body)
      setDraft({})
      if (!body.ok) setNote(body.error ?? '读取失败')
    } catch (error) {
      setNote(`读取失败: ${String(error?.message ?? error)}`)
    }
  }

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, base])

  useEffect(() => {
    if (!restarting) return undefined
    let alive = true
    let timer = null
    const tick = async () => {
      try {
        const response = await fetch(`${base}/events`, { cache: 'no-store' })
        const body = await response.json()
        const where = body.live ?? body.last ?? null
        if (!alive) return
        if (where !== null && where.phase === 'ready') {
          setRestarting(false)
          setNote('新配置已生效。')
          void load()
        } else if (where !== null && where.phase === 'failed') {
          setRestarting(false)
          setNote('重启失败：引擎没能启动，请展开状态芯片查看事件。')
        } else {
          setNote(`引擎正在按新配置加载：${where?.text ?? where?.phase ?? '…'}`)
        }
      } catch { /* monitor 短暂不可达：下一轮再试 */ }
      if (alive) timer = setTimeout(tick, 1200)
    }
    void tick()
    return () => { alive = false; if (timer !== null) clearTimeout(timer) }
  }, [restarting, base])

  const edit = (key, value) => setDraft((previous) => ({ ...previous, [key]: value }))

  const save = async () => {
    const set = {}
    try {
      for (const entry of data?.keys ?? []) {
        if (!(entry.key in draft)) continue
        set[entry.key] = parseParam(entry, draft[entry.key])
      }
    } catch (error) { setNote(String(error?.message ?? error)); return }
    if (Object.keys(set).length === 0) { setNote('没有改动：改一行再点保存（留空 = 清除、回 strata 默认）。'); return }
    setBusy(true)
    try {
      const response = await fetch(`${base}/params`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ set }),
      })
      const body = await response.json()
      if (body.ok) {
        setNote(`已保存 ${Object.keys(set).join(', ')}；${body.note ?? '从模型的下一次启动起生效。'} 点「重启生效」立即应用。`)
        setData(body)
        setDraft({})
      } else {
        setNote(`保存失败: ${body.error ?? `HTTP ${response.status}`}`)
      }
    } catch (error) {
      setNote(`保存失败: ${String(error?.message ?? error)}`)
    }
    setBusy(false)
  }

  const restart = async () => {
    setBusy(true)
    setNote('正在请求重启引擎…')
    try {
      const response = await fetch(`${base}/restart`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: data?.loaded ?? undefined }),
      })
      const body = await response.json()
      if (body.ok) setRestarting(true)
      else setNote(`重启失败: ${body.error ?? `HTTP ${response.status}`}`)
    } catch (error) {
      setNote(`重启失败: ${String(error?.message ?? error)}`)
    }
    setBusy(false)
  }

  const rows = (data?.keys ?? []).map((entry) => {
    const raw = entry.key in draft ? draft[entry.key] : fmtParam(entry)
    return jsxs('label', { className: 'ssm-tune-row', title: entry.help, key: entry.key, children: [
      jsx('span', { className: 'ssm-tune-key', children: entry.key }),
      entry.kind === 'bool'
        ? jsxs('select', { value: raw, onChange: (event) => edit(entry.key, event.target.value), children: [
          jsx('option', { value: '', children: '默认', key: 'd' }),
          jsx('option', { value: '1', children: '开', key: '1' }),
          jsx('option', { value: '0', children: '关', key: '0' }),
        ] })
        : entry.kind === 'enum'
          ? jsxs('select', { value: raw, onChange: (event) => edit(entry.key, event.target.value), children: [
            jsx('option', { value: '', children: '默认', key: 'd' }),
            ...(entry.choices ?? []).map((choice) => jsx('option', { value: choice, children: choice, key: choice })),
          ] })
          : jsx('input', {
            type: entry.kind === 'number' ? 'number' : 'text',
            step: entry.kind === 'number' ? 'any' : undefined,
            value: raw,
            placeholder: '默认',
            onChange: (event) => edit(entry.key, event.target.value),
          }),
      jsx('span', { className: 'ssm-tune-hint', children: raw === '' ? '默认' : '' }),
    ] })
  })

  return jsxs('div', { className: 'ssm-tune-root', children: [
    jsx('button', {
      type: 'button',
      className: 'ssm-tune-btn',
      title: '调整 strata 运行配置（temperature / top_p / 思考预算 / 显存预留 …），仅影响本地 strata 模型',
      onClick: () => setOpen((value) => !value),
      children: open ? '调参 ▾' : '调参 ▸',
    }),
    open
      ? jsxs('div', { className: 'ssm-tune-panel', role: 'dialog', 'aria-label': 'strata 调参', children: [
        jsxs('div', { className: 'ssm-tune-head', children: [
          jsx('span', { className: 'ssm-tune-title', children: `调参 · ${MODEL_LABEL(data?.model ?? data?.loaded ?? null)}` }),
          data?.source === 'file' ? jsx('span', { className: 'ssm-tune-tag', children: '只读（未加载）' }) : null,
          data?.loaded ? jsx('span', { className: 'ssm-tune-tag', children: '已加载' }) : null,
        ] }),
        data?.keys !== undefined ? jsx('div', { className: 'ssm-tune-rows', children: rows }) : null,
        data === null ? jsx('div', { className: 'ssm-tune-note', children: '读取中…' }) : null,
        jsx('div', { className: 'ssm-tune-note', children: note }),
        jsxs('div', { className: 'ssm-tune-actions', children: [
          jsx('button', { type: 'button', className: 'ssm-tune-act', disabled: busy || data?.writable !== true, onClick: () => void save(), children: '保存' }),
          jsx('button', { type: 'button', className: 'ssm-tune-act', disabled: busy || restarting || data?.loaded == null, onClick: () => void restart(), children: restarting ? '重启中…' : '重启生效' }),
          jsx('button', { type: 'button', className: 'ssm-tune-act', disabled: busy, onClick: () => void load(), children: '刷新' }),
          jsx('button', { type: 'button', className: 'ssm-tune-act', onClick: () => setOpen(false), children: '收起' }),
        ] }),
        jsx('div', {
          className: 'ssm-tune-foot',
          children: data?.writable === true
            ? '保存写入该模型下次启动用的运行配置（hop 会自动留 .bak）。点「重启生效」= hop 卸载后重新预热该模型（约 25 秒，不发 prompt、不耗 token）。'
            : data?.source === 'file' ? '当前没有加载的引擎：这里显示的是配置文件的只读内容。先在对话里选择 strata 模型（会自动预热），加载后即可编辑保存。' : '',
        }),
      ] })
      : null,
  ] })
}

/** Required client services. */
export const inject = ['slots']

/**
 * Browser plugin body: mount the chip and the switch banner.
 * @param ctx - client root context.
 */
export function apply (ctx) {
  injectCss()
  const url = typeof window === 'undefined' ? 'http://127.0.0.1:8756/events' : `${window.location.protocol}//${window.location.hostname}:8756/events`
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'strata-switch',
    order: 40,
    inject: () => ({ url, ms: 1000 }),
  }, StrataChip))
  ctx.slots.inject('conversation.content', () => ctx.slots.register({
    name: 'conversation.content',
    id: 'strata-switch-banner',
    order: 40,
    inject: () => ({ url, ms: 1000 }),
  }, StrataSwitchBanner))
  const apiBase = url.slice(0, url.length - '/events'.length)
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'strata-tune',
    order: 41,
    inject: () => ({ base: apiBase }),
  }, StrataTune))
}
