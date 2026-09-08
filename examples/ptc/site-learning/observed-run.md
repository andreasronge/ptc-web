# Observed live run — 2026-09-07

The installed `ptc` was 0.14.0, clean commit
`7e78607e51017e5ce08a6482df1ee42d50d47c88`.
The compatibility source checkout was
`13f7f508058f16f7d1dd7635312d237cbf58b8a3`.

| Stage                 | Observed result                                                                | PTC run reference                |
| --------------------- | ------------------------------------------------------------------------------ | -------------------------------- |
| Probe `/tag/love/`    | Captured Markdown and HTML; five successful MCP exchanges                      | `cmd-6p7zghd285342em0v1rg8g9854` |
| Learn                 | DeepSeek returned container `div.quote`, fields `span.text` and `small.author` | `cmd-5hg78appwmxke3r76nzkrp8aca` |
| Check original page   | Ten records; four successful MCP exchanges                                     | `cmd-6w4tq8aj7n64z0cvkgn8qpnh0q` |
| Reuse on `/tag/life/` | Ten records; four successful MCP exchanges; no LLM calls                       | `cmd-5748q49yxx4s0bs9z05d6cnkv1` |

Both pages were on `https://quotes.toscrape.com`. The model saw only the probe
page before producing its recipe. The successful learning call reported 6,797
input tokens, 170 output tokens, and 491 USD microunits ($0.000491). This is
that call's reported cost, not the total cost of exploratory attempts.

The exact generated component is retained in `recipes/quotes.clj`; its SHA-256
is `03b25833fc71986e39fb328b6c71ee8df244f011e0b1d456fd8646cedc5d62c7`.
The private evidence on this machine is in `.local/demo-1SXJLr/`, with
canonical trace/inspection files in `.ptc/`. Evidence directories are ignored.

Google redirected the test search to its unusual-traffic challenge. PTC logged
the challenge HTML and Markdown. A subsequent trial verified that the demo's
challenge check stops before the learning stage. Google search-result
extraction has therefore **not** been demonstrated.

The deterministic suite passed 15 tests with the opt-in PATH test skipped.
The PATH test passed separately, including private exchange assertions.
