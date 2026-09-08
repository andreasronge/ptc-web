# Learn a site once, reuse its extraction function

This demo answers: “Which quotations are on this page, and who are they
attributed to?” It probes the public love-tag page on Quotes to Scrape, learns
its layout with DeepSeek through OpenRouter, and reuses the learned function
on the life-tag page. It reads the first page only, not every page of the site.

Run from the ptc-web checkout with Node, Playwright Chromium, and `ptc` on PATH:

```sh
pnpm run build
node examples/ptc/site-learning/run.mjs ../ptc_runner/.env
```

The environment-file path is an explicit local input. Only PtcRunner reads the
OpenRouter credential; the browser subprocess does not inherit the environment.
The driver resolves the current Node executable into a private host document.
This avoids assuming a system Node installation or copying PtcRunner code.

Two optional URL arguments replace the probe and next page. They must be
different HTTP(S) URLs on the same origin. ptc-web additionally enforces its
public-destination policy through redirects and subrequests. This example does
not enable any local-origin exception.

## What runs

1. A PTC workflow opens the probe URL, captures an immutable snapshot, reads
   bounded Markdown and HTML, and closes the browser handle.
2. `ptc repl --profile private-run-analysis-v2` reads that run's
   `provider_exchanges`. The driver checks the five ordered calls, protocol
   version, matching response IDs, and complete successful MCP results.
3. A second PTC workflow gives DeepSeek the captured evidence and the inspected
   call summary. The model proposes two scalar field selectors and a repeated
   container selector in a constrained JSON response.
4. PTC-Lisp renders those selectors as a documented `site.recipe/extract`
   component with a signature and read effect. The model supplies selector
   data, not arbitrary executable source. Strings are encoded with `pr-str`.
5. `ptc materialize --from-result` applies PtcRunner's promotion gates and
   publishes a hash-checked candidate descriptor. `ptc validate` compiles it.
6. The workflow uses that candidate on the original URL to check for nonempty
   records, then on the second URL to demonstrate reuse. Both runs' exchanges
   are inspected. The second query must make zero model calls.

`workflow.clj` implements the PTC phases; `run.mjs` coordinates completed runs
because private log inspection and component replacement happen between runs.
An active PTC component bundle is immutable. The original placeholder component
is never overwritten. The resulting candidate can be used in later runs with
`--component-override-descriptor PATH/descriptor.json`, as long as its base
component hash still matches.

## Evidence and limits

The driver prints its artifact directory under `.local/demo-*`. It contains
the executable's full version/commit envelope, inputs, results, inspected
exchanges, generated component and descriptor, usage, and a report. PTC's
canonical traces and private inspection artifacts remain under `.ptc/`.
Both directories are ignored by version control. Inspection contains full
page content and model exchanges; do not publish it indiscriminately.

The learning phase makes one model request with at most 1,200 output tokens.
There is no automatic retry loop or hard dollar budget. Each run is limited to
180 seconds, each browser evaluation to 30 seconds, mission tool calls to 16,
and workflow capability calls to eight. The underlying server retains its
default navigation, capture, network, snapshot, and response limits.

Probe Markdown is capped at 12,000 bytes. The DOM evidence must fit one bounded
server response; extraction is capped at ten records. The driver rejects
truncated extraction, missing field values, and additional result cursors.
It does not follow site pagination. Nonempty results on two pages show that a
recipe works for those pages, not that every attribution is historically true
or that the layout will never change.

Recognizable challenge pages stop the demo before learning. This is a small
demo heuristic, not a universal bot-block detector. Google returned an
“unusual traffic” CAPTCHA during the live trial; no bypass was attempted.
Public sites and model responses can change, so this is an opt-in live demo,
not part of the deterministic default test suite.

See [the observed run](observed-run.md) for verified results, run references,
and the exact generated example in [recipes/quotes.clj](recipes/quotes.clj).

The integration follows PtcRunner's existing kernel tutorial and component
conventions. Compatibility source checkout:
`f53170ebf304ef0caf3a8aca44233f3f255e2c5f`. The installed CLI records its own
full revision on every invocation of the demo.
