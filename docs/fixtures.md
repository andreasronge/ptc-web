# Fixture and evaluation plan

Choose fixtures by page structure, using familiar sites as examples. No
site-specific branches in the core extractor initially. Put site semantics in
versioned declarative recipes or optional PTC-Lisp preludes.

| Category            | Example                      | Expected behavior                                         |
| ------------------- | ---------------------------- | --------------------------------------------------------- |
| Repeated listing    | Hacker News front page       | Titles, destinations, scores remain associated            |
| Discussion          | Hacker News thread           | Preserve comment IDs, parents, and deleted-comment cases  |
| Rich discussion     | Reddit thread                | Separate post/comments; disclose partially loaded content |
| Article             | Accessible newspaper article | Main text, author/date, captions; preserve source links   |
| Search results      | Google results               | Keep result groups; distinguish ads and other modules     |
| Documentation       | Technical reference page     | Preserve headings, code, tables, and internal links       |
| Dynamic application | Controlled local page        | Delayed rendering, load-more behavior, virtualized rows   |

The first deterministic set uses authored fixtures under `test/fixtures/` for
article, listing, discussion, documentation, and dynamic rendering. The
`held-out/article-card-layout.html` structure is reserved as the first generic
article check. No personal session data or third-party page captures are stored.

## Deterministic tests

Saved HTML fixtures test parsing/extraction. Local browser pages test rendering
and interaction with explicitly controlled loading behavior. Use expected
records and relationships, not only exact Markdown snapshots or nonempty text.

Include layout variants, missing fields, duplicate navigation text, login and
challenge pages, collapsed content, and changed URLs. Distinguish empty data
from failed extraction and unavailable access. Assert truncation and scope.

## Held-out evaluation

Reserve at least one site not used to tune extraction. Develop article
extraction against one publication and assess a second. Evaluate discussion
rules on a different discussion layout. Freeze held-out cases before a repair
trial; a candidate must not invent its own expected answers.

## Live probes

Run small opt-in probes separately from deterministic tests. They identify
site changes and access failures, and must not turn routine CI into a crawler.
Observe the source's access requirements. A paywall preview or challenge is a
partial/blocked outcome rather than proof that the extractor lost content.

## Metrics

- Correct fields and relationships retained, with explicit expected values.
- Relevant content omitted and unrelated content included.
- Returned bytes, bounded capture size, latency, and tool-call count.
- Correct incomplete/blocked/expired outcomes.
- Regression behavior after a recipe repair.

Compare article extractors on the same fixtures. Smaller Markdown alone is not
success: losing comments, captions, links, or table relationships can make a
short result worse.

## Repair demonstration

Run a recipe against a changed layout, capture evidence of a contract failure,
propose a new recipe/prelude, and validate it against the changed case plus
previous and held-out cases. Keep browser authority unchanged. Compile a new
immutable PTC component if using PtcRunner; adoption is a host policy decision,
not mutation of a running bundle.
