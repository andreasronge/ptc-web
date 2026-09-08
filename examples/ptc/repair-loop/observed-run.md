# Observed repair experiment — 2026-09-07

PtcRunner on PATH: 0.14.0, clean commit
`7e78607e51017e5ce08a6482df1ee42d50d47c88`.
Source-checkout compatibility: `13f7f508058f16f7d1dd7635312d237cbf58b8a3`.

| Query | Layout | Initial failure  | Model calls | Final exact pairs | Wall time |
| ----- | ------ | ---------------- | ----------: | ----------------: | --------: |
| 1     | v1     | None             |           0 |               3/3 |    8.25 s |
| 2     | v1     | None             |           0 |               3/3 |    7.97 s |
| 3     | v2     | Empty extraction |           7 |               3/3 |   73.11 s |
| 4     | v2     | None             |           0 |               3/3 |    7.40 s |
| 5     | v3     | Missing authors  |           6 |               3/3 |   65.30 s |
| 6     | v3     | None             |           0 |               3/3 |    7.92 s |

Both repairs also extracted all four held-out pairs correctly before acceptance.
The four healthy queries averaged 7.89 seconds; the two repaired queries
averaged 69.20 seconds. These are complete harness timings, including process
startup and inspection, not just browser or model latency.

The successful Gemini experiment took 177.52 seconds including setup, made
13 model calls in two investigations, and verified 50 MCP exchanges. Reported
usage was 54,312 input tokens, 2,445 output tokens, and 47,263 USD microunits
($0.047263). Usage was complete. The model was
`openrouter:google/gemini-3.7-flash`.

The first repair replaced the old selectors with `article.entry`, `p.words`,
and `span.speaker`. The second repaired the author selector for v3. No model
calls were made during ordinary queries, probing, or candidate verification.

The model used the actual shipped `debug.nav` prelude. A separate post-run
audit verified successful, nonempty reads of `execution_errors` for each
failure run, plus `provider_exchanges` for each failed query and fresh probe.
The recorded generated programs show the agent extracting the relevant HTML
from those responses before returning its selectors.

| Investigation         | Debug open calls | Debug read calls | Run reference                    |
| --------------------- | ---------------: | ---------------: | -------------------------------- |
| Empty-result repair   |                1 |                4 | `cmd-2rzjhny4j0mczffz17c1sex9g5` |
| Missing-author repair |                1 |                8 | `cmd-1fvbp9s6wqxz8pcbth7mfnvb0z` |

Private artifacts on this machine: `.local/run-tXJrcN/report.json`,
`queries.csv`, `06-repair-reaudit-debug-audit.json`, and
`13-repair-reaudit-debug-audit.json`. The explicit read-audit gate was added
while this experiment ran and was exercised afterward on both completed
investigations; subsequent runs apply it before candidate acceptance.

## DeepSeek attempt

Before Gemini, `openrouter:deepseek/deepseek-v4-flash` reached the eight-turn
limit on the first repair. Its programs repeatedly explored run metadata and
did not reach the current page HTML. No candidate was accepted. The two
preceding healthy queries had succeeded without model calls.

That failed investigation reported eight model calls, 29,474 input tokens,
1,098 output tokens, and $0.001146. Its run reference is
`cmd-6vqx5c2et1c7mqgt1jja5beg3e`; artifacts are in `.local/run-lCXWLM/`.
Gemini was then tested in a fresh full experiment at the user's suggestion.
This is not a statistically meaningful model ranking; the prompt and eight-turn
budget may be improved for DeepSeek.

Across both experiments, reported model cost was $0.048409.

## Verification

The default suite passed 23 tests, with the existing opt-in PATH compatibility
test skipped. Eight new deterministic tests cover model-free success,
transport failure, silent extraction errors, bounded retries, rejecting a
candidate that fails the held-out check, subsequent reuse, oracle limitations,
fixture changes, and server cleanup.
