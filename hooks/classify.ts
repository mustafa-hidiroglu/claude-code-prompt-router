// Pure, synchronous prompt classifier. No I/O, no engine access: safe to unit-test
// and cheap to run on every prompt (precompiled regexes, linear-time patterns).

export type Tier = 'haiku' | 'sonnet' | 'fable' | 'opus'

export const MODEL_IDS: Readonly<Record<Tier, string>> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  fable: 'claude-fable-5-2',
  opus: 'claude-opus-5-5',
}

export type Route = { tier: Tier; model: string; reason: string }

/** Prompts longer than this never go to Haiku, whatever words they contain. */
const SHORT = 280
/** Only this much of the prompt (head + tail) is scanned, bounding the cost. */
const SCAN_HEAD = 3000
const SCAN_TAIL = 1000

const RULES: ReadonlyArray<{ tier: Tier; reason: string; re: RegExp; shortOnly?: boolean }> = [
  // 1. Escalation: repeated failure. Checked first so it beats everything.
  {
    tier: 'opus',
    reason: 'repeated failure',
    re: /\b(?:failed|failing|fails|broken|crash(?:ed|es|ing)?|erroring)\s+(?:again|still)\b|\b(?:still|again)\b[^.!?\n]{0,25}\b(?:broken|failing|fails|failed|crash\w*|erroring|not working|doesn'?t work|wrong|the same)\b|\bdidn'?t (?:work|fix|help)\b|\b(?:not|never) fixed\b|\bsame (?:error|issue|bug|problem|failure)\b|\b(?:third|3rd|fourth|another|one more) (?:time|attempt|try)\b|\bkeeps? (?:failing|breaking|crashing)\b/i,
  },
  // 2. Deep debugging.
  {
    tier: 'opus',
    reason: 'deep debugging',
    re: /\broot[- ]cause\b|\brace conditions?\b|\bdeadlocks?\b|\bmemory leaks?\b|\bheisenbug\b|\bflaky\b|\bintermittent(?:ly)?\b|\bsegfaults?\b|\bcore dump\b|\bstack ?traces?\b|\bbisect\b|\bregressions?\b|\bdeep[- ]debug\w*\b|\bdebug(?:ging)? (?:this )?(?:deeply|thoroughly)\b|\bwhy (?:does|is|do) [^.?\n]{0,60}\b(?:hang|crash|leak|fail)\w*\b/i,
  },
  // 3. Long-running knowledge work.
  {
    tier: 'opus',
    reason: 'long-running knowledge work',
    re: /\bliterature review\b|\bdue diligence\b|\bresearch report\b|\bdeep research\b|\bwhite ?paper\b|\bcomprehensive (?:report|analysis|review|audit)\b|\bsynthesi[sz]e\b[^.\n]{0,40}\b(?:sources|documents|papers|findings)\b/i,
  },
  // 4. Cheap ops, only on short prompts: typo fix, extraction, classification, commands.
  {
    tier: 'haiku',
    reason: 'simple operation',
    shortOnly: true,
    re: /^\s*(?:git|npm|pnpm|yarn|bun|ls|cd|cat|mkdir|rm|mv|cp|brew|pip|make)\b|\b(?:typos?|spelling|misspell\w*|rename|extract|classify|categori[sz]e|reformat|format|lint|sort|count|bump (?:the )?version|translate|what time|git (?:status|log|add|commit|push|pull|diff|branch|checkout|stash)|commit (?:this|these|it|the changes)|run (?:the )?(?:tests?|build|linter|lint))\b|\blabel (?:these|each|the)\b|\bconvert\b[^.\n]{0,30}\bto (?:json|csv|yaml|markdown)\b/i,
  },
  // 5. Demanding reasoning, long-horizon agentic work, architecture.
  {
    tier: 'fable',
    reason: 'architecture / long-horizon',
    re: /\barchitect(?:ure|ural|ing)?\b|\bsystem design\b|\bdesign doc\b|\brfcs?\b|\bre-?design\b|\bre-?architect\w*\b|\btrade-?offs?\b|\bmigration (?:plan|strategy)\b|\blong[- ]horizon\b|\bfrom scratch\b|\bautonomous(?:ly)?\b|\bmulti[- ](?:step|phase|service|system|repo)\b|\bcodebase[- ]wide\b|\bacross the (?:whole|entire) (?:codebase|repo|project)\b|\bscalab(?:le|ility)\b|\bdistributed systems?\b|\bformal(?:ly)? (?:proof|verif\w*)\b|\bprove (?:that|it)\b|\bultrathink\b|\bthink (?:hard|deeply|carefully)\b|\broadmap\b/i,
  },
  // 6. Standard coding and everyday reasoning.
  {
    tier: 'sonnet',
    reason: 'coding',
    re: /\b(?:implement|refactor|bug|fix|function|component|endpoint|api|unit tests?|tests?|css|html|react|typescript|javascript|python|sql|query|code|script|feature|class|method|module|hook|compile|build|deploy|explain|why|how (?:do|does|can|should)|review)\b/i,
  },
]

const OVERRIDE = /^\s*@(haiku|sonnet|fable|opus)\b[:,]?\s*/i

/** An explicit `@tier` prefix: the tier and the prompt without the prefix. */
export function parseOverride(text: string): { tier: Tier; text: string } | undefined {
  const m = OVERRIDE.exec(text)
  const tier = m?.[1]
  if (!m || !tier) return undefined
  return { tier: tier.toLowerCase() as Tier, text: text.slice(m[0].length) }
}

/**
 * Pick a tier for a prompt, or `undefined` to abstain (the session's model stands).
 * First matching rule wins; rules are ordered by priority.
 */
export function classify(raw: string): Route | undefined {
  const text = raw.trim()
  if (!text) return undefined
  const scanned =
    text.length > SCAN_HEAD + SCAN_TAIL ? text.slice(0, SCAN_HEAD) + '\n' + text.slice(-SCAN_TAIL) : text
  const isShort = text.length <= SHORT

  for (const rule of RULES) {
    if (rule.shortOnly && !isShort) continue
    if (rule.re.test(scanned)) return { tier: rule.tier, model: MODEL_IDS[rule.tier], reason: rule.reason }
  }
  return undefined
}
