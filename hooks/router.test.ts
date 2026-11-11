import { describe, expect, test } from 'claude-code/testing'

import { classify } from './classify'

const DEFAULT = 'claude-opus-5-5[session-default]'

describe('classify', () => {
  const cases: Array<[string, string | undefined]> = [
    ['fix the typo in README', 'haiku'],
    ['git status', 'haiku'],
    ['extract all emails from this text: a@b.c, d@e.f', 'haiku'],
    ['classify these tickets as bug or feature', 'haiku'],
    ['add a login endpoint to the express api with unit tests', 'sonnet'],
    ['refactor this function to use async/await', 'sonnet'],
    ['design the architecture for a multi-tenant billing service and its tradeoffs', 'fable'],
    ['plan a long-horizon migration strategy for the monorepo', 'fable'],
    ['find the root cause of this race condition in the worker pool', 'opus'],
    ['the build failed again', 'opus'],
    ['still broken after your change', 'opus'],
    ['same error as before', 'opus'],
    ['write a comprehensive report synthesizing these papers and sources', 'opus'],
    ['thanks!', undefined],
    ['', undefined],
  ]
  for (const [prompt, tier] of cases) {
    test(`"${prompt}" -> ${tier ?? 'default'}`, () => {
      expect(classify(prompt)?.tier).toBe(tier)
    })
  }

  test('a long prompt that mentions a typo is not sent to haiku', () => {
    const long = 'please fix the typo, and then '.padEnd(400, 'x') + ' implement the new feature'
    expect(classify(long)?.tier).toBe('sonnet')
  })

  test('a huge prompt is classified quickly', () => {
    const huge = 'lorem ipsum '.repeat(200_000) + ' still broken'
    const t = Date.now()
    expect(classify(huge)?.tier).toBe('opus')
    expect(Date.now() - t).toBeLessThan(50)
  })
})

test('routes a turn, honours @override, and falls back when a model is refused', async ($, on) => {
  const seen: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'router' } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    seen.push(e.model)
    if (e.model === 'claude-haiku-5-5') throw new Error('model not available')
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn' } as never
  })
  const step = async (turnId: string, agentId?: string) => {
    const s = $.turn.step({ turnId, index: 0, model: DEFAULT, messageCount: 1, ...(agentId ? { agentId } : {}) })
    for (;;) {
      const r = await s.next()
      if (r.done) return r.value
    }
  }

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // Plain classification.
  await $.turn.start({ turnId: 't1', text: 'the tests failed again' })
  expect((await step('t1')).answer).toBe('ok')
  expect(seen.at(-1)).toBe('claude-opus-5-5')

  // Unmatched prompt: the session's model stands.
  await $.turn.start({ turnId: 't2', text: 'thanks!' })
  await step('t2')
  expect(seen.at(-1)).toBe(DEFAULT)

  // Subagent steps are never touched.
  await $.turn.start({ turnId: 't3', text: 'git status', agentId: 'a1' })
  await step('t3', 'a1')
  expect(seen.at(-1)).toBe(DEFAULT)

  // @override is stripped from the prompt and forces the tier.
  const sub = await $.prompt.submit({ text: '@fable thanks!' } as never)
  expect(sub.text).toBe('thanks!')
  await $.turn.start({ turnId: 't4', text: 'thanks!' })
  await step('t4')
  expect(seen.at(-1)).toBe('claude-fable-5-2')

  // The engine refuses haiku before streaming: the same request is retried on the default.
  seen.length = 0
  await $.turn.start({ turnId: 't5', text: 'fix the typo in README' })
  const r = await step('t5')
  expect(seen).toEqual(['claude-haiku-5-5', DEFAULT])
  expect(r.answer).toBe('ok')

  // ...and haiku is skipped for the rest of the session.
  seen.length = 0
  await $.turn.start({ turnId: 't6', text: 'git status' })
  await step('t6')
  expect(seen).toEqual([DEFAULT])
})
