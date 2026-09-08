# Architecture

`ptc-web` is a TypeScript library and stdio MCP server for reading rendered web
pages. It owns browser access, bounded page capture, content conversion, and
structured extraction.

```text
MCP client
  -> MCP schemas and tool lifecycle
    -> Playwright browser manager
      -> immutable snapshot store
        -> text, Markdown, find, and record extraction
```

## Library surface

The package exports the main building blocks from `src/index.ts`:

- `createServer` and `PtcWebRuntime` create the MCP server and its managed
  runtime.
- `AccessPolicy` validates network destinations.
- `SnapshotStore` retains bounded, expiring DOM captures.
- `extractRecords` applies declarative container and field selectors.
- `configFromEnvironment` and `DEFAULT_LIMITS` provide server configuration.

The `ptc-web` executable connects the same server to stdio. Protocol messages
use stdout; diagnostics use stderr.

## Browser and access boundary

Playwright runs Chromium in a dedicated persistent context. By default its
profile is temporary and removed when the runtime closes. Page handles refer
to live browser pages and are released explicitly with `page_close` or when the
runtime shuts down.

Only HTTP(S) destinations are accepted. URL credentials and non-public network
addresses are denied unless an exact local origin is explicitly configured.
Every redirect and subrequest passes through the same policy. Service workers
are disabled, and request counts and response-body sizes are bounded.

## Snapshots and extraction

`page_capture` copies the current DOM into an immutable snapshot. Snapshots
have stable IDs, content hashes, capture metadata, expiry times, and byte-limit
information. Closing a page does not remove its snapshots; they remain readable
until they expire. Once the bounded store is full, new captures are rejected.

Content operations work from snapshots rather than the changing live DOM:

- `page_read` converts a snapshot to bounded Markdown or text.
- `page_find` returns literal passages from a selected representation.
- `page_extract` maps repeated elements into records using CSS selectors.

Pagination cursors are integrity-protected and bound to the snapshot and the
operation's arguments. A cursor cannot be reused with a different query,
representation, or extraction recipe.

Article conversion uses Mozilla Readability. Document Markdown uses Turndown
with GFM support, and structured record extraction uses Cheerio. The original
bounded HTML remains available so lossy article extraction is never the only
stored representation.

## MCP contract and limits

The server supports MCP revision `2026-07-28` through
`@modelcontextprotocol/server` and rejects legacy initialization. It exposes a
fixed catalog of six tools: `page_open`, `page_capture`, `page_read`,
`page_extract`, `page_find`, and `page_close`.

Separate limits cover navigation time, open pages, requests per page, resource
bytes, capture bytes, stored snapshots, extraction records, find matches, and
serialized results. Errors distinguish invalid input, blocked access,
unavailable resources, expiry, cancellation, and limit exhaustion.

Captured DOM does not include content that the page has not loaded, closed
shadow roots, canvas pixels, or inaccessible cross-origin frames. Tool results
report truncation and blocked-request information so callers can distinguish a
complete snapshot read from complete coverage of a website.
