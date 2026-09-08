# Repair only when extraction breaks

This experiment serves one local URL whose layout changes between queries.
Normal queries use an installed PTC extraction component and have **no model
capability granted**. A completed extraction that violates its contract starts
a bounded repair agent. The agent uses the shipped `debug.nav` prelude to
investigate frozen evidence, proposes new selectors, and produces a replacement
component. It must pass checks before later queries use it.

```sh
# DeepSeek first; Gemini fallback after an unsuccessful investigation/candidate.
pnpm run demo:repair -- ../ptc_runner/.env

# Use the model that completed the observed debugging experiment.
PTC_REPAIR_MODEL=openrouter:google/gemini-3.7-flash \
  pnpm run demo:repair -- ../ptc_runner/.env

# No API key or model required for policy and fixture tests.
pnpm run test:repair
```

See [observed results](observed-run.md) for measured accuracy, latency, cost,
model comparison, and links to retained evidence.
For a closer look at the model conversation, see
[inside an LLM repair](debug-turns.md).

## What changes

The same `/quotes` URL returns three synthetic quotation/author records.
`fixtures.mjs` changes only the markup; expected content stays fixed.

| Queries | Layout                                                      | Consequence for the previously accepted recipe     |
| ------- | ----------------------------------------------------------- | -------------------------------------------------- |
| 1–2     | `div.quote`, `span.text`, `small.author`                    | Initial recipe works                               |
| 3–4     | `article.entry`, `p.words`, `span.speaker`                  | Old container matches nothing                      |
| 5–6     | Same container/text, author moves to `footer > cite.byline` | Old recipe returns quotations with missing authors |

The held-out `/held-out` page has different content, extra wrappers, reordered
author placement, and navigation text that must not be mistaken for authors.
It is not included in the repair agent's evidence capture.

## The loop

1. Run the current `site.recipe/extract` through PTC and inspect its MCP calls.
2. Check the application contract: at least two records, nonempty `text` and
   `author`, unique quotation text, and no omitted/truncated/paginated result.
   Transport errors abort; they do not trigger selector rewriting.
3. If the contract fails, record an explicit PTC failure linked to the query
   run. Capture fresh HTML in a separate model-free probe run.
4. Copy exactly those three runs into an immutable evidence directory. The
   model gets run references, not a prepared diagnosis or raw HTML prompt.
5. Invoke shipped `agent.core` with an evidence mission containing shipped
   `debug.nav`. The model writes and executes bounded PTC-Lisp programs that
   read `execution_errors` and `provider_exchanges` to discover the mismatch.
6. Verify the repair agent's own capability log. It must have successfully
   read nonempty evidence from all three required run/collection pairs.
7. Render its schema-validated selector proposal into a documented, signed
   component. `ptc materialize` applies promotion gates and hashes the candidate;
   `ptc validate` checks it against the component it replaces.
8. Test the candidate on the broken page and the held-out page. Both must satisfy
   the operational contract **and** match the benchmark's exact quotation/author
   pairs. Only then update the active descriptor. Reuse it on the next query.

An empty extraction is a successful MCP response with unusable application data.
The separate failure run deliberately makes this distinction visible in PTC's
debug evidence. It retains the validation errors and the originating query ID.

The model proposes selectors, not arbitrary replacement code. PTC-Lisp's
`pr-str` encodes selector strings into the fixed component template. No new
capability is granted by learning a recipe. The browser server's core contains
no fixture-specific selectors.

## Stats and evidence

Each experiment creates `.local/run-*`, with:

- `report.json`: per-query and per-stage timing, accuracy, model identity,
  calls, tokens, reported USD microunits, candidate decisions, and run IDs.
- `queries.csv`: a compact query-level table.
- `*-exchanges.json`: verified MCP calls and responses.
- `*-debug-audit.json`: proof of the model's required debug reads.
- `*-repair-result.json`: proposed selectors, generated component, and the
  agent's executed PTC programs.
- `initial/`, `candidate-*/`, and `accepted-after-query-*.json`: immutable
  components/descriptors and the accepted recipe after each query.
- `project/.ptc/`: canonical PTC traces and private inspection artifacts.

You can audit a completed experiment without repeating model/browser work:

```sh
node examples/ptc/repair-loop/audit.mjs /absolute/path/to/run-DIRECTORY/report.json
```

The audit publishes new `*-reaudit-debug-audit.json` files and refuses to
overwrite them. Private inspection and generated artifacts stay in ignored,
owner-only experiment directories. The local server closes even on failure;
the evidence is retained for diagnosis. Each PTC run shuts down its own MCP
server/browser process.

## Limits and interpretation

There are two repair attempts per contract failure, four per experiment, and
eight model turns per attempt. A failed first attempt uses the user-selected
fallback, `openrouter:google/gemini-3.7-flash`. `PTC_REPAIR_MODEL` selects the
first-attempt model; the default is `openrouter:deepseek/deepseek-v4-flash`.
Reported model identities come from PTC's resolved-model usage, not the host's
historical `deepseek` alias.

An investigation has a 240-second PTC budget, a 210-second CLI subprocess
timeout, 32 mission calls, and at most 2,048 output tokens per model call. The
entire experiment stops after ten minutes. There is no hard dollar cap; if
`usage_complete` is false, the reported cost is incomplete. Model-call counts
are distinct from repair-attempt counts: an investigation is a multi-turn agent.

The fixture origin is bound to one ephemeral loopback port and explicitly
allowed only in the generated browser host configuration. No broad localhost
exception is enabled. The browser inherits no environment variables or model
credentials. The OpenRouter key is read through PTC's explicit `--env-file`.

The minimum-record rule is specific to this task; a genuinely empty search
result would need a different contract. Shape checks cannot detect all
plausible but wrong data: a unit test demonstrates swapped attribution passing
the shape checks and failing the exact oracle. Real deployments need suitable
business invariants or labelled canary pages. The oracle is test-only and is
never sent to the model.

This is one controlled experiment, not a model benchmark across many sites.
Timings include fresh PTC/browser startup and private-log inspection. There is
no measured always-call-a-model baseline. Accepted recipes are reused within
the experiment and saved for inspection; each new invocation starts from the
same baseline to make runs comparable.

The implementation follows PtcRunner's existing `debug-a-failed-run` and
kernel tutorial examples. Source compatibility commit:
`f53170ebf304ef0caf3a8aca44233f3f255e2c5f`. Every experiment also records the
installed CLI's full version and commit. No PtcRunner source is modified or
required by this independent project.
