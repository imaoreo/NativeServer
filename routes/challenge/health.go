package challenge

import (
	"encoding/json"
	"net/http"
)

func ChallengeHealthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")

	signed, _ := r.Context().Value("device_signed").(bool)
	if signed {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "success",
			"message": "Signing verified correctly!",
		})
	} else {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "fallback",
			"message": "Request allowed (Device check not supported on this platform/environment)",
		})
	}
}
