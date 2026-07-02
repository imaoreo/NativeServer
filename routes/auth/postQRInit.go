package auth

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type QRInitRequest struct {
	PlaceholderDeviceID string `json:"placeholderDeviceId"`
}

func MakePostQRInitHandler(rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req QRInitRequest
		err := json.NewDecoder(r.Body).Decode(&req)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid JSON payload"})
			return
		}

		if req.PlaceholderDeviceID == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "Missing deviceId"})
			return
		}

		handshakeToken := uuid.New().String()
		ctx := r.Context()

		err = rdb.Set(ctx, "handshake:"+handshakeToken, req.PlaceholderDeviceID, 300*time.Second).Err()
		if err != nil {
			log.Printf("Redis error setting handshake: %v", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Internal Server Error"})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"token":        handshakeToken,
			"expiresIn":    300,
			"instructions": "Render this token as a QR code or numeric string on the client app.",
		})
	}
}
