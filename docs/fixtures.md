# Fixtures and tests

The deterministic test suite uses authored HTML under `test/fixtures/`. It
covers articles, documentation, repeated listings, discussions, dynamic
rendering, and a held-out article layout without storing third-party pages or
personal browser data.

Saved fixtures exercise parsing and extraction directly. Local fixture servers
exercise Chromium rendering, redirects, subrequests, response limits, delayed
content, cancellation, and cleanup through the real browser boundary.

Tests assert content and relationships rather than only checking for nonempty
text. They cover associated listing fields, comment identity and parentage,
missing fields, UTF-8 pagination, cursor scope, truncation, snapshot expiry,
blocked private destinations, and bounded result sizes.

The integration suite also starts the compiled CLI and performs MCP discovery
and a complete open, capture, read, extract, find, and close lifecycle over
stdio. PtcRunner compatibility checks are separate from the core browser and
protocol tests and run only when the required checkout or executable is
available.

Worked examples under `examples/ptc/` demonstrate site-recipe reuse, guarded
repair after a layout change, and loading updated parser code without restarting
the runtime. These examples extend the library without adding site-specific
behavior or model calls to the core extraction path.
