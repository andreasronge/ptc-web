(ns repair.query "Browser-only workflow: no model capability is granted.")
(defn run [input]
  (if (= "failure" (get input "phase"))
    (fail {"kind" "extraction_contract_failed" "query_run" (get input "query_run")
           "errors" (get input "errors") "observed" (get input "observed")})
  (let [result (kernel/eval-source-with
                 "browser"
                 (if (= "probe" (get input "phase"))
                   "(return (demo.browser/probe (get data/params \"url\")))"
                   "(return (demo.browser/query (get data/params \"url\")))") input)]
    (if (= :returned (get result :outcome)) (return (get result :value)) (fail result)))))
