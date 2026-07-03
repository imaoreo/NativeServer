package challenge

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"dev.imaoreo/NativeServer/testutils"
	"github.com/redis/go-redis/v9"
)

func TestMakeGetChallengeHandler_Success(t *testing.T) {
	mockRedis := &testutils.MockRedisCmdable{
		SetFunc: func(ctx context.Context, key string, value interface{}, expiration time.Duration) *redis.StatusCmd {
			return redis.NewStatusResult("OK", nil)
		},
	}

	handler := MakeGetChallengeHandler(mockRedis)

	req, err := http.NewRequest("GET", "/v1/challenge", nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rr.Code)
	}

	if rr.Header().Get("Content-Type") != "application/json" {
		t.Errorf("Expected Content-Type application/json, got %s", rr.Header().Get("Content-Type"))
	}

	var response map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("Failed to unmarshal response: %v", err)
	}

	challengeVal, ok := response["challenge"].(string)
	if !ok || challengeVal == "" {
		t.Errorf("Expected a non-empty challenge string, got %v", response["challenge"])
	}

	ttlVal, ok := response["ttl"].(float64) // JSON numbers decode to float64
	if !ok || ttlVal != 300 {
		t.Errorf("Expected ttl 300, got %v", response["ttl"])
	}
}

func TestMakeGetChallengeHandler_RedisError(t *testing.T) {
	mockRedis := &testutils.MockRedisCmdable{
		SetFunc: func(ctx context.Context, key string, value interface{}, expiration time.Duration) *redis.StatusCmd {
			return redis.NewStatusResult("", errors.New("redis connection refused"))
		},
	}

	handler := MakeGetChallengeHandler(mockRedis)

	req, err := http.NewRequest("GET", "/v1/challenge", nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("Expected status 500, got %d", rr.Code)
	}
}
