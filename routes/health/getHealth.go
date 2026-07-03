package health

import "net/http"

func GetHealthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Write([]byte(`{"status":"healthy","runtime":"Native Grind"}`))
}
