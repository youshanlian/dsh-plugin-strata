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
}
