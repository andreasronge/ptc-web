# ptc-web

A standalone browser-content MCP server for JavaScript-rendered pages.

**Demo software.** It gives compatible MCP clients bounded, inspectable access
to web content. Its URL policy and resource limits are deliberate boundaries,
but it is not a general-purpose browser automation service.

Read JavaScript-rendered pages as bounded Markdown or structured records. Keep
site-specific interpretation in extraction recipes while the server owns
browser access, HTML parsing, extraction, and resource limits.

## Implemented foundation

- TypeScript and Node.js 20.19 or newer, with exact dependency versions.
- Official `@modelcontextprotocol/server` v2 and MCP `2026-07-28` only over
  stdio. Legacy initialization is rejected.
- Playwright Chromium in a server-owned persistent profile, temporary by
  default and never shared with the user's normal browser profile.
- Immutable, expiring DOM snapshots; paginated Markdown/text reads; literal
  passage finding; and declarative CSS-selector record extraction.
- Mozilla Readability for articles, Turndown with GFM for Markdown, and Cheerio
  for selectors.
- Deterministic authored fixtures for article, listing, discussion,
  documentation, dynamic rendering, and a held-out article layout.

## Install and run

Install the Chromium build matching this package once, then start the MCP
server through npm:

```console
npx -y playwright@1.63.0 install chromium
npx -y ptc-web
```

For a source checkout:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run build
node dist/src/cli.js
```

The process speaks MCP on stdout and writes only bounded diagnostics to stderr.
`--help` and `--version` do not start Chromium.

## Tools

| Tool           | Contract                                                                  |
| -------------- | ------------------------------------------------------------------------- |
| `page_open`    | Open a permitted URL and wait for a bounded readiness condition.          |
| `page_capture` | Freeze the current DOM into an immutable snapshot and return a preview.   |
| `page_read`    | Read paginated Markdown or text using `article` or `document` extraction. |
| `page_extract` | Apply a declarative container/field CSS recipe to a snapshot.             |
| `page_find`    | Find paginated literal passages in a snapshot representation.             |
| `page_close`   | Close a browser page; its snapshots remain readable until expiry.         |

Every cursor is process-local, integrity protected, and bound to the immutable
snapshot, operation, representation, and recipe/query that issued it. A cursor
cannot silently resume against changed parameters. Snapshot coverage reports
DOM truncation, blocked subrequests, network request count, and the fact that
unloaded site content remains unknown.

## Access policy

Public HTTP(S) is allowed by default. URL credentials, other schemes, and IPs
that are not globally routable are denied. Hostnames are resolved and every
answer must be public. Each intercepted fetch disables automatic redirects;
Chromium receives one redirect hop at a time, and every next hop is routed
through policy before it is fetched. The same policy applies to every browser
subrequest. Service workers are disabled.

Tests and deliberate local installations can allow exact origins (scheme,
host, and port) with a comma-separated value:

```sh
PTC_WEB_ALLOW_LOCAL_ORIGINS=http://127.0.0.1:8123,http://[::1]:8123 node dist/src/cli.js
```

This does not allow other ports or other local origins.

## Configurable limits

| Environment variable            | Default | Meaning                                             |
| ------------------------------- | ------: | --------------------------------------------------- |
| `PTC_WEB_MAX_CAPTURE_BYTES`     |   2 MiB | Retained UTF-8 DOM bytes per snapshot.              |
| `PTC_WEB_MAX_RESOURCE_BYTES`    |   8 MiB | Response-body bytes per browser network request.    |
| `PTC_WEB_MAX_REQUESTS_PER_PAGE` |     256 | Requests including explicit redirect hops per page. |
| `PTC_WEB_MAX_RESPONSE_BYTES`    |  48,000 | Serialized application result target per tool call. |
| `PTC_WEB_MAX_SNAPSHOTS`         |      32 | Live snapshots in one server process.               |
| `PTC_WEB_MAX_PAGES`             |       8 | Concurrent page handles.                            |
| `PTC_WEB_MAX_EXTRACT_RECORDS`   |     500 | Containers considered by one extraction.            |
| `PTC_WEB_MAX_FIND_MATCHES`      |     200 | Matches considered by one find.                     |
| `PTC_WEB_NAVIGATION_TIMEOUT_MS` |  15,000 | Maximum open/readiness time.                        |
| `PTC_WEB_SNAPSHOT_TTL_MS`       | 300,000 | Snapshot lifetime.                                  |

All limits must be positive integers; the result limit must be at least 8 KiB.
`PTC_WEB_PROFILE_DIR` opts into a host-owned dedicated profile directory.
`PTC_WEB_HEADLESS=false` displays Chromium. Temporary profiles, pages, and
snapshots are cleaned up on normal shutdown; cancellation closes an in-flight
page.

## Validation

```sh
pnpm run verify
```

The default suite covers the library, browser behavior, MCP stdio transport,
security boundaries, fixtures, and extraction behavior. One optional
compatibility lane exercises the server through PtcRunner; the server itself
does not depend on PtcRunner.

## Design

- [Library architecture](docs/architecture.md)
- [Fixtures and tests](docs/fixtures.md)

Search, arbitrary click/scroll operations, existing-Chrome integration, hosted
extraction services, and a custom extension are intentionally outside this
foundation.

## Development and releases

CI tests Node.js 20.19, 22, and 24 on Linux and macOS, and smoke-tests the
packed npm artifact. See [RELEASING.md](RELEASING.md) for the tag-driven npm
release process. This project is available under the [MIT License](LICENSE).

## Dynamic screen-scraper example

The [dynamic-parser example](examples/ptc/dynamic-parser/README.md) combines
`ptc-web` with a separately installed filesystem MCP server. A workflow opens
a JavaScript-rendered page, selects parser code from a writable file, executes
that parser against the captured page, and saves the result. Changing the
parser file changes the screen scraper on the next run without restarting the
runtime or modifying `ptc-web`.
