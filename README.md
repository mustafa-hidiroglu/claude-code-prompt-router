# Claude Code Prompt Router: automatic model routing (Haiku / Sonnet / Fable / Opus)

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-d97757)
![No external LLM](https://img.shields.io/badge/external%20LLM-none-blue)
![Runs locally](https://img.shields.io/badge/runs-100%25%20local-brightgreen)

A **Claude Code plugin (mod)** that reads each prompt before it is sent and picks the model to match the task. Simple jobs go to **Claude Haiku**, everyday coding to **Claude Sonnet**, architecture and long-horizon work to **Claude Fable**, and deep debugging or repeated failures to **Claude Opus**. You spend less on easy prompts without losing quality on hard ones.

> ## ✅ Requires no external LLM and no external router
>
> - **No extra model calls.** Classification is done by local regular expressions, not by asking another LLM.
> - **No proxy, gateway or router service.** No LiteLLM, OpenRouter, custom base URL or API key. Requests go through Claude Code's normal connection.
> - **No network access at all.** The plugin makes zero HTTP requests, and nothing about your prompts leaves your machine because of it.
> - **No dependencies.** Plain TypeScript running inside Claude Code's own plugin runtime. Nothing to `npm install`.
>
> A prompt is classified in about 0.1 ms.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install prompt-router --marketplace mustafa-hidiroglu/claude-code-prompt-router
```

Answer `y` to add the marketplace, then press Enter to pick the user scope. The plugin is active right away, in that session and every later one.

From a shell:

```
claude plugin install prompt-router --marketplace mustafa-hidiroglu/claude-code-prompt-router
```

In the desktop app: click **+** next to the prompt box → **Plugins** → **Add marketplace** → `mustafa-hidiroglu/claude-code-prompt-router` → **Add plugin**.

## Routing rules

Rules are checked in this order; the first match wins. If nothing matches, your session's own model is used unchanged.

| Priority | Model | When | Example triggers |
|---|---|---|---|
| 1 | `claude-opus-5-5` | **Repeated failure** | "failed again", "still broken", "same error", "didn't work", "third attempt" |
| 2 | `claude-opus-5-5` | **Deep debugging** | root cause, race condition, deadlock, memory leak, flaky, stack trace, regression, bisect |
| 3 | `claude-opus-5-5` | **Long-running knowledge work** | literature review, due diligence, comprehensive report, synthesize sources |
| 4 | `claude-haiku-5-5` | **Simple operation** (prompts ≤ 280 characters only) | typo fix, rename, extract, classify, format, lint, `git status`, "run the tests" |
| 5 | `claude-fable-5-2` | **Demanding reasoning / architecture / long-horizon agentic work** | architecture, system design, RFC, tradeoffs, migration plan, from scratch, multi-step, "think hard" |
| 6 | `claude-sonnet-5-5` | **Standard coding and everyday reasoning** | implement, refactor, bug, test, API, component, explain |

Long prompts never go to Haiku, even if they mention a typo.

### Force a model for one prompt

Start the prompt with `@haiku`, `@sonnet`, `@fable` or `@opus`. The prefix is removed before the model sees the prompt.

```
@opus why does the cache return stale entries under load?
```

### Commands and settings

- `/router` shows the last routing decision and whether the router is active.
- `/router off` / `/router on` pauses or resumes routing for the current session.
- In `/config`: **Route prompts by complexity** (on/off) and **Show the routed model in the status line** (on/off).

The status line shows each decision, for example `router: sonnet (coding)`.

## Fail-safes

The router never blocks your session:

- If classification throws or takes longer than 25 ms, your default model is used.
- If the API rejects a routed model before any output streams, the same request is retried on your default model, and that model is skipped for the rest of the session (you get a toast).
- Subagents are never re-routed. They keep the model they were spawned with.
- Only the first 3,000 and last 1,000 characters of a very long prompt are scanned, so classification stays fast at any size.

## How it works

The plugin is a Claude Code hooks module (`hooks/register.ts`) on three lifecycle events:

1. **`prompt.submit`** handles an `@model` override and strips the prefix.
2. **`turn.start`** classifies the turn's text once with `hooks/classify.ts` (pure regex, no I/O).
3. **`turn.step`** rewrites the `model` on every API request of that turn on the main loop.

To change the rules or model IDs, edit `RULES` and `MODEL_IDS` in [`hooks/classify.ts`](hooks/classify.ts).

## Development

```
claude plugin validate .   # manifest + hooks module checks
claude plugin test .       # runs hooks/router.test.ts (18 tests)
claude --plugin-dir .      # start a session with the local copy loaded
```

## FAQ

**Does it send my prompt anywhere to decide the model?**
No. The decision is made by regular expressions inside Claude Code. There is no external LLM, embedding model, router API or network call.

**Is this an alternative to OpenRouter, LiteLLM or other LLM routers?**
For Claude Code, yes, for picking between Claude models. It needs no proxy, gateway, base URL change or extra API key.

**Will it override the model I chose with `/model`?**
Only for prompts that match a rule. Use `/router off` to keep your chosen model, or start a prompt with `@<model>`.

## License

[MIT](LICENSE) © 2026 Mustafa Can Hidiroglu
