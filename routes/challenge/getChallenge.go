package challenge

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func MakeGetChallengeHandler(rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		challenge := uuid.New().String()
		ctx := r.Context()

		err := rdb.Set(ctx, "attest_challenge:"+challenge, "valid", 300*time.Second).Err()
		if err != nil {
			log.Printf("Redis error setting challenge: %v", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "Internal Server Error"})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"challenge": challenge,
			"ttl":       300,
		})
	}
}
