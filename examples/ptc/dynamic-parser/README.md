# Change parser code without restarting PtcRunner

This integration test uses real PTC mission evaluations, Chromium, and
`ptc-fs-mcp` disk persistence. No model or API key is needed: two candidate
programs are supplied deterministically to isolate replacement and persistence.

```sh
pnpm run test:dynamic-parser -- ../ptc-fs-mcp/dist/cli.js
```

Use a built filesystem-server CLI. Alternatively set `PTC_FS_MCP_CLI`; the
default is `../ptc-fs-mcp/dist/cli.js` relative to the ptc-web checkout. `ptc`
must be on PATH and Playwright Chromium installed. No PtcRunner or filesystem
server source code is imported into this project.

## What “dynamic” means

`workflow.clj` is a frozen component. It does not change during the run.
`parser-v1.clj` and `parser-v2.clj` are **program text**, not installed preludes.
The workflow selects which text to pass to:

```clojure
(kernel/eval-source-with "browser" parser-source
  {"snapshot_id" snapshot-id})
```

The browser mission compiles and executes the submitted program using its
existing permissions. Each parser program creates a local `parse` function,
calls it, and returns the extraction. The next evaluation may receive different
source text. No installed prelude function is overwritten.

Version 1 searches for `div.quote` and `small.author`. Version 2 searches for
`article.entry` and `span.speaker`. Both are actual `.clj` programs containing a
function. A model could author the replacement; this test supplies it as input.

## Three missions in one workflow

| Environment     | Responsibility                                                       | Granted tools                   |
| --------------- | -------------------------------------------------------------------- | ------------------------------- |
| Workflow        | Select source, compile-check it, validate results, coordinate saving | Kernel evaluation/check helpers |
| Browser mission | Execute the selected parser                                          | ptc-web only                    |
| Writer mission  | Save accepted code as `parser-v2.clj`                                | Filesystem write only           |
| Reader mission  | Read saved code                                                      | Filesystem read only            |

The same browser mission is reused across evaluations. Naming a filesystem
tool in browser code cannot grant it write permission.

## What the test proves

The replacement run performs these steps **under one PTC run ID**:

1. Open and capture the fixture page.
2. Execute v1 against its snapshot and observe empty results.
3. Compile-check v2, execute it against the **same snapshot**, and validate all
   three quotation/author pairs.
4. Test v2 against four different pairs on a held-out page with extra wrappers.
5. Save the exact accepted source through the writer mission and `ptc-fs-mcp`.
6. Read the `.clj` file back through the reader mission.
7. Execute that loaded text in the same browser mission against the original
   snapshot and get the correct answer again.
8. Close both pages and check that browser code cannot call the write tool.

A later run receives only a mode and URL, reads the saved file through MCP,
and executes it successfully. That later run proves persistence; restarting
was **not necessary to activate the new parser** in the replacement run.

A negative-control run happens first. It tries a parser that works on the
three-record page but limits the four-record held-out page to three records.
Validation fails. The test confirms no file exists and no write tool was called.

## Evidence and limits

Each invocation retains `.local/run-*` containing the generated PTC project,
envelopes, private inspection, saved file, and `report.json`. PTC's private
analysis REPL inspects the actual MCP exchanges. Assertions verify identical
snapshot IDs for old/new/disk-loaded code within one run, write/read ordering,
exact saved bytes, successful later reload, and zero model calls.

Only the fixture's exact ephemeral loopback origin is allowed. Filesystem
providers are confined to the experiment's `saved/` directory with `*.clj`
includes. Subprocesses inherit no environment. The fixture closes in `finally`;
PTC owns MCP/browser cleanup. Artifacts remain available for inspection.

Each run allows 90 seconds and 16 subordinate evaluations; each evaluation
allows 15 seconds. Saved source must fit one bounded filesystem read. The test
uses a unique directory and one writer; it does not test concurrent updates
or crash-safe promotion across multiple writers. Compilation checks syntax
and authority, not semantic correctness—the fixture assertions check that.

This test establishes the runtime mechanism. The separate repair-loop demo
establishes model-driven debugging through `debug.nav`. Combining autonomous
repair and this same-run persistence path remains a separate extension.

## Verified result — 2026-09-08

Passed with PATH PtcRunner 0.14.0, clean revision
`7e78607e51017e5ce08a6482df1ee42d50d47c88`, and local `ptc-fs-mcp` 0.4.0
from clean checkout `447292e4b9a04ebb121872365d5a8ce12dac28e0`.
The report records the filesystem CLI's exact SHA-256 as well.

The replacement run was `cmd-3stpdz62pp8qsqbr2wa19v3xvg`. It contained eight
browser-mission evaluations, one writer evaluation, and one reader evaluation.
Its twelve inspected MCP calls included the old, corrected, and disk-loaded
parser executions. All three used the identical original snapshot ID.
Corrected extraction returned 3/3 original and 4/4 held-out pairs.

The later reload run was `cmd-6kvdjacz74ysykdh82jctzgcqb`. Its input contained
no parser code; it returned the expected three pairs from the saved program.
The negative-control run was `cmd-2p86wj6z8rat0w7hjchqbbc5p5`; it reached the
held-out pagination failure and made no filesystem write. The browser write
check returned `outcome: invalid` with `kind: unknown_tool`.

All runs made zero model calls. The saved source hash was
`78bb31ca2b4acad6c0efd50764146aaeb93bc8bba1cee462f7c2125eaa6f0b9a`.
Local evidence: `.local/run-wgCYwI/report.json` and its adjacent exchange logs.
