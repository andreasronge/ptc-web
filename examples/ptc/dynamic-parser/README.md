# Change parser code without restarting PTC Runner

This example shows how PTC Runner can test, save, and reuse a screen-scraping
parser while it is running.

PTC Runner separates work into two kinds of environments:

- The **workflow** is the coordinator. It decides what to run and checks the
  results.
- A **mission** is an isolated worker with only the tools it needs. The browser
  mission can use `ptc-web`, the reader can read files, and the writer can write
  files.

A **prelude** is trusted helper code installed before the run. The workflow uses
the fixed `kernel` prelude to check and execute parser code. The parser itself is
just program text passed to a mission; replacing it does not change the prelude
or the workflow.

**MCP servers** are separate programs that provide tools. `ptc-web` provides
browser tools through Playwright. Two restricted `ptc-fs-mcp` instances provide
read-only and write-only access to the same parser directory.

![PTC dynamic-parser architecture: a workflow delegates browser, file-reading, and file-writing work to isolated missions backed by restricted MCP servers.](dyn-parser.png)

## What happens

1. The browser mission captures a rendered page.
2. It runs the old parser and then a candidate parser on the same snapshot.
3. The workflow also checks the candidate on a held-out page.
4. The writer mission saves only a candidate that passes both checks.
5. The reader mission loads the saved parser, and the browser mission runs it
   again without restarting PTC Runner.

The browser mission cannot write files, rejected parsers are never saved, and
the example makes no model calls.

## Run it

Build `ptc-web` and `ptc-fs-mcp`, install Playwright Chromium, and put `ptc` on
your PATH. Then run from the `ptc-web` checkout:

```sh
pnpm run test:dynamic-parser -- ../ptc-fs-mcp/dist/cli.js
```

The filesystem CLI argument is optional when the sibling checkout shown above
exists. You can also set `PTC_FS_MCP_CLI` to another built `ptc-fs-mcp` CLI.
