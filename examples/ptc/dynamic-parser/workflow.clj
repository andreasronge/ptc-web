(ns dynamic.workflow "Replace program text during one workflow; persist only tested code.")

(defn- evaluate [mission source params]
  (let [result (kernel/eval-source-with mission source params)]
    (if (= :returned (get result :outcome)) (get result :value) (fail result))))

(defn- capture [url]
  (evaluate "browser"
    "(let [o (get (tool/web.open {\"url\" (get data/params \"url\")}) :value) c (get (tool/web.capture {\"handle_id\" (get o \"handle_id\")}) :value)] (return c))"
    {"url" url}))

(defn- close-page [captured]
  (evaluate "browser"
    "(return (get (tool/web.close {\"handle_id\" (get data/params \"handle_id\")}) :value))"
    {"handle_id" (get captured "source_handle_id")}))

(defn- parse [source captured]
  (let [checked (kernel/check-source "browser" source)]
    (if (= :valid (get checked :outcome))
      (evaluate "browser" source {"snapshot_id" (get captured "snapshot_id")})
      (fail checked))))

(defn- load-parser []
  (let [page (evaluate "reader"
               "(let [r (tool/fs.read {\"path\" \"parser-v2.clj\"})] (if (= :ok (get r :status)) (return (get r :value)) (fail r)))" {})]
    (if (get page "next_cursor") (fail "Saved parser exceeds one bounded read")
      (join "" (map (fn [item] (get item "text")) (get page "items"))))))

(defn run [input]
  (let [captured (capture (get input "url"))]
    (if (= "reload" (get input "mode"))
      (let [source (load-parser)
            result (parse source captured)
            closed (close-page captured)]
        (return {"mode" "reload" "result" result "closed" closed "loaded_source" source}))
      (let [old (parse (get input "old_source") captured)
            source (get input "new_source")
            repaired (parse source captured)
            held (capture (get input "held_url"))
            held-result (parse source held)]
        (if (and (empty? (get old "records"))
                 (= (get repaired "records") (get input "expected"))
                 (= (get held-result "records") (get input "held_expected")))
          (let [saved (evaluate "writer"
                        "(let [r (tool/fs.write {\"path\" \"parser-v2.clj\" \"content\" (get data/params \"source\")})] (if (= :ok (get r :status)) (return (get r :value)) (fail r)))"
                        {"source" source})
                loaded (load-parser)
                reused (parse loaded captured)
                closed (close-page captured)
                held-closed (close-page held)
                denied (kernel/check-source "browser" "(return (tool/fs.write {\"path\" \"bad.clj\" \"content\" \"bad\"}))")]
            (return {"mode" "replace" "old" old "repaired" repaired "held_out" held-result
                     "reused_from_disk" reused "saved" saved "loaded_source" loaded
                     "closed" closed "held_closed" held-closed "write_denied" denied}))
          (fail "Candidate did not pass both fixture checks; nothing saved"))))))
