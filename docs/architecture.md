# Architecture

Design recorded 2026-09-07. The stdio, managed-browser, snapshot, Markdown,
selector-extraction, and deterministic-fixture foundation is now implemented.
It was compatibility-tested against PtcRunner commit
`d98c4ba33de0eab99d7460dd298f0c794c5cbf42`.

## Boundaries

```text
MCP client (PtcRunner or another client)
  -> MCP server: schemas, handles, bounds, lifecycle
    -> browser adapter: Playwright initially
    -> snapshot store: bounded, expiring, immutable captures
    -> extraction: article selection, Markdown, declarative records
```

The MCP server owns rendering, DOM parsing, resource/access limits, readiness,
snapshots, and formatting. PTC-Lisp owns task-specific selection, site recipes,
pagination policy, normalization, deduplication, validation, and repair proposals.
Do not implement an HTML parser in PTC-Lisp or require generated JavaScript for
operations expressible as bounded selectors and field mappings.

## Content representations

Return Markdown by default for reading, but retain a bounded source snapshot
for structured extraction and diagnosis. Article selection is lossy and must
not destroy the only representation of a discussion or listing.

Use an object output schema and MCP structuredContent. Include the appropriate
text representation required by the client/wire contract. PtcRunner validates
structured results and exposes them as data to Lisp.

Proposed application-level result (not the complete MCP envelope):

```json
{
  "snapshot_id": "s_123",
  "url": "https://example.org/article",
  "title": "Example",
  "format": "markdown",
  "content": "# Example\n\n...",
  "extraction": "article",
  "coverage": {
    "scope": "captured_dom",
    "truncated": false,
    "unloaded_content": "unknown"
  },
  "next_cursor": null
}
```

Specify capture time, extractor version, source identity, expiry, byte limits,
and cursor semantics before implementing the final schema. Cursors must address
an immutable snapshot; live DOM mutations cannot shift an existing read.
Capture limits and response limits are separate. Never equate a complete read
of a snapshot with having loaded an entire website discussion or dataset.

## Tools

| Tool           | Purpose                                                          |
| -------------- | ---------------------------------------------------------------- |
| `page_open`    | Open a URL with a bounded readiness condition; return a handle   |
| `page_capture` | Capture current content; return metadata and a small preview     |
| `page_read`    | Read bounded Markdown/text from a snapshot using a cursor        |
| `page_extract` | Extract records using a declarative selector/field specification |
| `page_find`    | Find passages in a snapshot                                      |
| `page_close`   | Release owned browser resources                                  |

Scoped click/scroll operations remain deferred. Avoid
automatic full-page dumps after each operation. Expired handles, unavailable
browser connections, blocked access, and incomplete capture need distinct
outcomes. Cancellation must stop owned work and release resources within bounds.

DOM snapshots do not automatically preserve computed visibility, closed shadow
roots, canvas content, cross-origin frames, or unloaded virtualized rows. Define
what is captured and report unsupported or partial cases explicitly.

## MCP

Support the released `2026-07-28` revision only. Use the official TypeScript SDK
v2 (`@modelcontextprotocol/server`) and pin an exact tested package version.
Reject older protocol revisions; do not introduce fallback handshakes.

Start with stdio, discovery, and tools with input/output schemas. Keep the
catalog deterministic and implement the revision's cache/result metadata.
Avoid dependencies on optional tasks, sampling, elicitation, or image results
in the first PtcRunner integration. Use explicit handles for application state;
do not depend on transport-level sessions.

Contract-test both the upstream protocol and PtcRunner's narrower supported
profile. Check discovery, declared schemas, structured/text result handling,
size limits, cancellation, and version refusal through a real client boundary.

## Data sources and browser access

Prefer a configured supported API/feed or publisher-provided Markdown when it
fits the task. JSON-LD can provide metadata, but is not evidence that the full
page is represented. Use rendered DOM extraction when necessary. Record which
source/backend produced the result; do not silently substitute authenticated
browser content with an anonymous HTTP response.

Keep search separate from reading a selected URL. A configured search API and
a browser search recipe can return the same result contract. Do not make Google
or Reddit mandatory dependencies of the core.

Start with a dedicated Playwright profile. The existing Playwright extension
supports user-selected tabs, but its documented integration is through
Playwright MCP; a stable standalone bridge API has not been established here.
Investigate that seam before choosing reuse versus a custom extension/native
messaging bridge. Do not build on private APIs without evaluating maintenance.

Enforce allowed tabs/origins and resource limits in the server. Credentials and
browser profiles remain host-owned. Treat page content as untrusted data and
do not expose it to an external extraction service without explicit host
configuration. Network destinations and redirects require an access policy,
including local/private destinations when a URL-fetching backend is offered.

## Optional alternatives

- Crawl4AI: Python browser crawling, filtered Markdown, CSS/XPath extraction;
  useful comparator and alternative stack.
- Trafilatura: article extraction and fallback algorithms; benchmark on the
  same fixtures before adding a Python dependency.
- Jina Reader / Firecrawl: hosted URL-to-content alternatives for public pages;
  optional backends rather than required services. Check costs, licensing,
  retention, and operational constraints if adopting or embedding them.

No hidden LLM call in the default extraction path. Model-assisted recipe repair
belongs in an explicit workflow with independent regression validation.

## Implementation sequence

1. Create a TypeScript package, pinned dependencies, and minimal latest-only
   MCP discovery/tool round trip verified against PtcRunner.
2. Implement a managed-browser adapter and bounded capture/read lifecycle.
3. Add article Markdown and generic selector extraction with deterministic tests.
4. Add fixture coverage, held-out evaluation, and explicit partial/blocked states.
5. Demonstrate an optional PTC prelude and a validated layout-change repair.
6. Evaluate existing-Chrome integration and live probes after the core works.

## Research sources

- [MCP release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Playwright MCP](https://github.com/microsoft/playwright-mcp)
- [Playwright Chrome extension](https://github.com/microsoft/playwright/tree/main/packages/extension)
- [Readability](https://github.com/mozilla/readability)
- [Turndown](https://github.com/mixmark-io/turndown)
- [Cheerio](https://github.com/cheeriojs/cheerio)
- [Crawl4AI extraction](https://docs.crawl4ai.com/extraction/no-llm-strategies/)
- [Crawl4AI Markdown](https://docs.crawl4ai.com/core/markdown-generation/)
- [Trafilatura extraction](https://trafilatura.readthedocs.io/en/latest/extraction-overview.html)
- [Jina Reader architecture](https://github.com/jina-ai/reader/blob/main/architecture.md)
- [Firecrawl scraping](https://docs.firecrawl.dev/features/scrape)
- [Publisher Markdown negotiation](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/)
- [Brave Search API](https://api-dashboard.search.brave.com/api-reference/web/search/get)
