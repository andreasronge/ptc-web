# Inside an LLM repair

This page follows the successful repair run from the
[observed experiment](observed-run.md). It shows what the model received, the
PTC-Lisp programs it generated, and how those programs led to a new extraction
recipe.

The conversation was reconstructed from PTC's private run data with
`ptc transcript`. The transcript contains all 7 turns of the first repair and
all 6 turns of the second, with no missing or ambiguous exchanges. Examples
below are shortened to the parts that explain the decisions.

## What the model sees

At the start, the model receives:

1. A system prompt explaining the PTC-Lisp language, the available functions,
   the turn limit, and the required result shape.
2. A task describing the failed extraction and three PTC run IDs: the failed
   validation, the query that produced the bad result, and a fresh page probe.
3. One capability, `run_ptc_lisp`. Its programs can use the `debug.nav` prelude
   to read evidence from those runs.

It does **not** initially see the page HTML, a diagnosis, the correct selectors,
or the held-out page. It has to find the relevant evidence itself. Page content
and log values are marked as untrusted data, so text found in a page cannot
become new instructions.

Each tool result is bounded and may be shortened for the prompt. The complete
value remains available to the next PTC-Lisp program as `*1`, which lets the
model select a smaller part without requesting the same data again.

The model's task is also narrow. Its final answer must have exactly these keys:

```clojure
{:container "..."
 :text_selector "..."
 :author_selector "..."
 :reason "..."}
```

## First repair: no records

The installed recipe expected `div.quote`, but the layout had changed. The
model found the cause over seven turns.

| Turn | Generated investigation                                                 | Useful observation                                                      |
| ---- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1    | Open the failure run and read the failure, query, and probe collections | The combined result is too large for one prompt preview                 |
| 2    | Select smaller request, response, and error fields from `*1`            | The relevant evidence is in the query and probe provider exchanges      |
| 3    | Reduce the query exchanges to tool name, arguments, and result          | The failed operation is `page_extract`                                  |
| 4    | Isolate that extraction exchange                                        | The old selectors matched zero containers                               |
| 5    | Read and reduce the probe exchanges                                     | One exchange contains the current page body                             |
| 6    | Select only the probe HTML                                              | The repeated records use `article.entry`, `p.words`, and `span.speaker` |
| 7    | Return the required selector map                                        | The repair is ready for validation                                      |

The first investigation program used `debug.nav` rather than asking the host to
prepare the answer:

```clojure
(let [failure (debug.nav/open "<failure-run>")
      errors  (debug.nav/read "<failure-run>"
                              {"collection" "execution_errors"})
      query   (debug.nav/read "<query-run>"
                              {"collection" "provider_exchanges"})
      probe   (debug.nav/read "<probe-run>"
                              {"collection" "provider_exchanges"})]
  {:errors errors :query query :probe probe})
```

The query exchange revealed the previous recipe and its empty result:

```clojure
{:container "div.quote"
 :fields [{:name "text" :selector "span.text"}
          {:name "author" :selector "small.author"}]}

{:matched_containers 0 :records []}
```

After narrowing the probe output, the model saw HTML like this:

```html
<nav>
  <span class="speaker">Navigation editor</span>
</nav>
<main>
  <article class="entry">
    <p class="words">...</p>
    <span class="speaker">Ada North</span>
  </article>
</main>
```

The navigation element matters: selecting `.speaker` globally would capture
the wrong text. Because extraction fields are evaluated inside each repeated
container, the model returned:

```json
{
  "container": "article.entry",
  "text_selector": "p.words",
  "author_selector": "span.speaker",
  "reason": "The previous recipe expected div.quote with span.text and small.author, but the page DOM structure uses article.entry containers enclosing p.words for the quote text and span.speaker for the author."
}
```

## Second repair: missing authors

Later, the container and quotation text still worked, but every author was
`nil`. This investigation took six turns. The model first confirmed that
`article.entry` and `p.words` still produced three records, then compared the
author selector with the probe HTML:

```html
<nav>
  <cite class="byline">Site editor</cite>
</nav>
<article class="entry">
  <p class="words">...</p>
  <footer><cite class="byline">Ada North</cite></footer>
</article>
```

It kept the working selectors and changed only the author selector:

```clojure
{:container "article.entry"
 :text_selector "p.words"
 :author_selector "cite.byline"
 :reason "The previous author selector span.speaker only matched the header navigation editor outside the quote entries, returning nil for all articles. In the current DOM, the author within each article.entry container is marked up inside footer with cite.byline."}
```

Again, the container gives the selector its scope. The unrelated `cite.byline`
in navigation is outside `article.entry` and is therefore ignored.

## What the model generates

There are three different outputs in the repair pipeline:

1. **Investigation programs.** On each turn the model writes a small PTC-Lisp
   program. PTC runs it against the read-only evidence mission and records the
   program together with its result.
2. **A selector proposal.** Once it has enough evidence, the model returns the
   schema-checked map shown above. It does not write arbitrary component code.
3. **A candidate component.** The workflow inserts the selectors into a fixed,
   escaped component template. `ptc materialize` creates the candidate and
   `ptc validate` checks it against the component being replaced.

For example, the second deterministically generated candidate is:

```clojure
(ns site.recipe "Repaired quotation extraction.")
(defn extract
  "Extract up to ten quotation and author records."
  {:signature "(snapshot_id :string) -> :map" :effect :read}
  [snapshot-id]
  (let [response
        (tool/web.extract
          {"snapshot_id" snapshot-id
           "container" "article.entry"
           "fields" [{"name" "text" "selector" "p.words"}
                     {"name" "author" "selector" "cite.byline"}]
           "limit" 10})]
    (if (= :ok (get response :status))
      (get response :value)
      (fail response))))
```

Finally, the workflow—not the model—runs the candidate on both the broken page
and the held-out page. There are no model calls during verification. The new
component becomes active only if its records satisfy the contract and exactly
match the test oracle; otherwise the previous component remains active.

## Debugging boundary

- `debug.nav` exposes selected normalized run collections such as
  `execution_errors` and `provider_exchanges`; it does not expose raw provider
  wire bytes.
- The evidence mission is read-only and limited to the copied failure, query,
  and probe runs.
- The held-out HTML and expected answers are never included in model evidence.
- The workflow audits the model's debug calls and rejects a proposal unless it
  actually read all required evidence.
- Private transcripts, page contents, and generated artifacts remain in ignored
  owner-only experiment directories.

This makes the repair explainable at two levels: the returned `reason` gives a
short account of the selector change, while the recorded PTC-Lisp turns show
the exact evidence path that led to it.
