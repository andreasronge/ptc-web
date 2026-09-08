# PtcRunner integration

This example follows the component and host-installation conventions in
PtcRunner commit `f53170ebf304ef0caf3a8aca44233f3f255e2c5f`.

Build `ptc-web`, then run the project with a public URL in `ptc.json`. The host
document starts `../../dist/src/cli.js` over stdio and maps
the server's read-only browser tools into one mission. The workflow executes
the PTC-Lisp program supplied in the input without requiring a model.

Local fixture URLs remain denied unless the host explicitly adds their exact
origin to `PTC_WEB_ALLOW_LOCAL_ORIGINS` in the transport environment. The
automated compatibility test creates that narrow configuration dynamically.

```sh
pnpm run build
ptc run examples/ptc/ptc-project.json
```

There are two compatibility lanes:

```sh
# Reproducible source-checkout validation at the commit recorded above. The
# default is the sibling directory ../ptc_runner; override it when needed.
PTC_RUNNER_CHECKOUT=/path/to/ptc_runner pnpm run test:ptc

# Standalone-user validation with the `ptc` executable currently on PATH.
# This runs ptc init, validate, doctor, doctor --connect, and run.
pnpm run test:ptc:path
```

The PATH lane reads the installed executable's V4 version envelope and prints
its full source revision as a test diagnostic. On 2026-09-07 it passed with
PtcRunner `0.14.0`, clean revision
`7e78607e51017e5ce08a6482df1ee42d50d47c88`.

The PATH test also uses PTC's private analysis REPL to verify all six ordered
MCP tool calls, protocol metadata, response digests, and handle/snapshot
correlation. These records do not include the initial discovery exchange.
Temporary run and analysis artifacts are removed when the test finishes.

For a live OpenRouter/DeepSeek example that probes a page, inspects its logs,
learns a component, and reuses it on another page, see
[site learning](site-learning/README.md).

The [repair loop](repair-loop/README.md) extends this with changing local pages:
ordinary queries use no model; contract failures invoke an agent using shipped
`debug.nav`; only candidates passing original and held-out checks are reused.
It records query accuracy, latency, model calls, tokens, cost, and debug evidence.

The [dynamic parser test](dynamic-parser/README.md) executes old and corrected
`.clj` programs within one PTC run, validates the correction, saves it with
`ptc-fs-mcp`, and reloads it both immediately and in a later run.
