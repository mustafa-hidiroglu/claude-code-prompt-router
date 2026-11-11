import type { EngineInterface, Register } from 'claude-code'

import { classify, MODEL_IDS, parseOverride, type Route } from './classify'

/** A classification slower than this is discarded and the default model stands. */
const BUDGET_MS = 25

function setStatus($: EngineInterface, isShown: boolean, text: string | undefined): void {
  if (isShown) $.ui.status(text)
}

export const register: Register = (on, options) => {
  const isEnabled = options.enabled !== false
  const showStatus = options.showStatus !== false

  // Module state: reset on reload, which is the safe direction (no routing until the next prompt).
  let isPaused = false
  let last: (Route & { at: string }) | undefined
  const byTurn = new Map<string, Route>()
  const overrides = new Map<string, Route>() // stripped prompt text -> forced route
  const refused = new Set<string>() // model ids the engine rejected this session


  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'router',
      description: 'Prompt router: show the last routing, or `/router on|off` for this session',
    })
    return next(e)
  })

  on('command.run', { command: 'router' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off') isPaused = true
    if (arg === 'on') isPaused = false
    const state = !isEnabled ? 'disabled in /config' : isPaused ? 'paused' : 'active'
    const lastLine = last ? `last: ${last.model} (${last.reason}) for "${last.at}"` : 'no prompt routed yet'
    const refusedLine = refused.size ? `\nrejected by the engine: ${[...refused].join(', ')}` : ''
    return {
      text: `Prompt router ${state}. ${lastLine}${refusedLine}\nOverride one prompt with a prefix: @haiku, @sonnet, @fable, @opus.`,
    }
  })

  // Explicit `@tier` prefix: strip it so the model never sees it, remember the forced tier.
  on('prompt.submit', ($, e, next) => {
    if (!isEnabled || isPaused || e.command || e.isMeta) return next(e)
    try {
      const o = parseOverride(e.text)
      if (!o || !o.text.trim()) return next(e)
      overrides.set(o.text, { tier: o.tier, model: MODEL_IDS[o.tier], reason: 'manual override' })
      return next({ ...e, text: o.text })
    } catch {
      return next(e) // fail-safe: prompt goes through untouched
    }
  })

  // Decide once per main-loop turn.
  on('turn.start', ($, e, next) => {
    if (!isEnabled || isPaused || e.agentId) return next(e)
    try {
      const started = Date.now()
      const route = overrides.get(e.text) ?? classify(e.text)
      overrides.delete(e.text)
      const tookMs = Date.now() - started

      if (route && tookMs <= BUDGET_MS && !refused.has(route.model)) {
        byTurn.set(e.turnId, route)
        last = { ...route, at: e.text.slice(0, 40) }
        setStatus($, showStatus, `router: ${route.tier} (${route.reason})`)
      } else {
        setStatus($, showStatus, route && tookMs > BUDGET_MS ? 'router: default (timed out)' : 'router: default')
      }
    } catch {
      setStatus($, showStatus, 'router: default (error)')
    }
    return next(e)
  })

  // Rewrite the model on each request of a routed turn. If the engine refuses the routed
  // model before streaming anything, retry the request untouched on the default model.
  on('turn.step', async function* ($, e, next) {
    const route = e.agentId ? undefined : byTurn.get(e.turnId)
    if (!route || route.model === e.model || refused.has(route.model)) return yield* next(e)

    const stream = next({ ...e, model: route.model })[Symbol.asyncIterator]()
    let hasYielded = false
    try {
      for (;;) {
        const r = await stream.next()
        if (r.done) return r.value
        hasYielded = true
        yield r.value
      }
    } catch (err) {
      if (hasYielded) throw err // mid-stream failure: not ours to replay
      refused.add(route.model)
      byTurn.delete(e.turnId)
      $.ui.toast(`prompt-router: ${route.model} failed, using the default model`)
      setStatus($, showStatus, 'router: default (fallback)')
      return yield* next(e)
    }
  })

  on('turn.complete', ($, e, next) => {
    byTurn.delete(e.turnId)
    return next(e)
  })
}
