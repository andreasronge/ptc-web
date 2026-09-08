(let [parse (fn [snapshot-id]
              (let [response (tool/web.extract
                               {"snapshot_id" snapshot-id "container" "article.entry"
                                "fields" [{"name" "text" "selector" "p.words"}
                                          {"name" "author" "selector" "span.speaker"}] "limit" 10})]
                (if (= :ok (get response :status)) (get response :value) (fail response))))]
  (return (parse (get data/params "snapshot_id"))))
