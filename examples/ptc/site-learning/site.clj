(ns site.recipe "Placeholder replaced with a validated learned recipe.")

(defn extract
  "Extract up to ten content records from one captured page."
  {:signature "(snapshot_id :string) -> :map" :effect :read}
  [snapshot-id]
  (let [response (tool/web.extract {"snapshot_id" snapshot-id "container" "body"
                                   "fields" [{"name" "text"}] "limit" 10})]
    (if (= :ok (get response :status)) (get response :value) (fail response))))
