(ns aurora.util.core)



(defrecord FailedCheck [message line file trace])

(defn map! [f xs]
  (doall (map f xs)))