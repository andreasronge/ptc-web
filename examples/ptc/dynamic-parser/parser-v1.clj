(let [parse (fn [snapshot-id]
              (let [response (tool/web.extract
                               {"snapshot_id" snapshot-id "container" "div.quote"
                                "fields" [{"name" "text" "selector" "span.text"}
                                          {"name" "author" "selector" "small.author"}] "limit" 10})]
                (if (= :ok (get response :status)) (get response :value) (fail response))))]
  (return (parse (get data/params "snapshot_id"))))
