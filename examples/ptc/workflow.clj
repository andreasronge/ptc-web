(ns web.example "Runs a caller-supplied browser program inside the web mission.")

(defn run [input]
  (return
    (tool/kernel-eval
      {"mission" "default"
       "kind" :source
       "source" (get input "program")})))
