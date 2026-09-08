(ns demo.browser "Bounded public-page probing and learned extraction.")

(defn- call-value [response]
  (if (= :ok (get response :status)) (get response :value) (fail response)))

(defn probe [url]
  (let [opened (call-value (tool/web.open {"url" url}))
        handle (get opened "handle_id")
        captured (call-value (tool/web.capture {"handle_id" handle}))
        snapshot (get captured "snapshot_id")
        markdown (call-value (tool/web.read {"snapshot_id" snapshot "max_bytes" 12000}))
        dom (call-value (tool/web.extract {"snapshot_id" snapshot "container" "body"
                                          "fields" [{"name" "html" "source" "html"}] "limit" 1}))
        closed (call-value (tool/web.close {"handle_id" handle}))]
    (return {"url" (get captured "url") "title" (get captured "title")
             "markdown" markdown "dom" dom "closed" (get closed "closed")})))

(defn query [url]
  (let [opened (call-value (tool/web.open {"url" url}))
        captured (call-value (tool/web.capture {"handle_id" (get opened "handle_id")}))
        extracted (site.recipe/extract (get captured "snapshot_id"))
        closed (call-value (tool/web.close {"handle_id" (get opened "handle_id")}))]
    (return {"url" (get captured "url") "title" (get captured "title")
             "extraction" extracted "closed" (get closed "closed")})))
