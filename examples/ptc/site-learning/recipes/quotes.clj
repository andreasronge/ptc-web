(ns site.recipe "Learned public-site extraction recipe.")
(defn extract
  "Extract up to ten content records from one captured page."
  {:signature "(snapshot_id :string) -> :map" :effect :read}
  [snapshot-id]
  (let [response (tool/web.extract {"snapshot_id" snapshot-id "container" "div.quote" "fields" [{"name" "text" "selector" "span.text"} {"name" "author" "selector" "small.author"}] "limit" 10})]
    (if (= :ok (get response :status)) (get response :value) (fail response))))
