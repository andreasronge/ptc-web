# Repository guidance

## Project overview

`ptc-web` is a TypeScript browser-content MCP server and library. It uses a
server-owned Playwright Chromium profile, captures immutable DOM snapshots, and
returns bounded Markdown, text, and structured records over stdio.

## Setup and commands

- Use a supported Node.js release from `package.json` (`>=20.19.0`) and install
  the locked dependency tree with `pnpm install --frozen-lockfile`. This
  repository uses pnpm, with its exact version pinned in `package.json`.
- Install the browser runtime with `pnpm exec playwright install chromium`.
- Run `pnpm run build` to compile TypeScript into the ignored `dist/` directory.
- Run `pnpm test` for the full suite. Browser tests use local fixture servers;
  the default PtcRunner compatibility test expects the sibling source checkout.
- Run `pnpm run verify` before proposing a change. It checks formatting and
  types, rebuilds, and runs the full test suite.
- Use `pnpm run format` when repository files need Prettier formatting.

## Repository conventions

- Keep production code in `src/`, TypeScript tests in `test/`, extraction
  recipes in `recipes/`, and worked integrations in `examples/ptc/`.
- Do not commit `dist/`, `node_modules/`, Playwright output, tarballs, local PTC
  traces, browser profiles, credentials, or other generated artifacts.
- Preserve ESM imports and the strict TypeScript settings in `tsconfig.json`.
- Keep stdout reserved for MCP protocol messages. Send bounded diagnostics to
  stderr, and do not expose credentials, private host paths, or browser data.
- Treat URL validation, DNS/IP policy, redirect and subrequest interception,
  cursor integrity, snapshot immutability, and byte budgets as security-sensitive.

## Change boundaries

- Do not publish packages, create version tags, or change the package version
  as part of an ordinary code change.
- Avoid changing release credentials, publishing behavior, or the public tool
  contract without explicit maintainer direction.
- Keep changes scoped to the task and preserve unrelated work in the tree.
