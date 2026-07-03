package challenge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestChallengeHealthHandler(t *testing.T) {
	t.Run("Signed Device", func(t *testing.T) {
		req, err := http.NewRequest("POST", "/api/v1/challenge/health", nil)
		if err != nil {
			t.Fatal(err)
		}

		ctx := context.WithValue(req.Context(), "device_signed", true)
		req = req.WithContext(ctx)

		rr := httptest.NewRecorder()
		handler := http.HandlerFunc(ChallengeHealthHandler)

		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("Expected status 200, got %d", rr.Code)
		}

		var response map[string]string
		if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
			t.Fatalf("Failed to decode response: %v", err)
		}

		if response["status"] != "success" {
			t.Errorf("Expected status 'success', got '%s'", response["status"])
		}
		if response["message"] != "Signing verified correctly!" {
			t.Errorf("Unexpected message: '%s'", response["message"])
		}
	})

	t.Run("Fallback Device", func(t *testing.T) {
		req, err := http.NewRequest("POST", "/api/v1/challenge/health", nil)
		if err != nil {
			t.Fatal(err)
		}

		// device_signed not set or false
		rr := httptest.NewRecorder()
		handler := http.HandlerFunc(ChallengeHealthHandler)

		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("Expected status 200, got %d", rr.Code)
		}

		var response map[string]string
		if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
			t.Fatalf("Failed to decode response: %v", err)
		}

		if response["status"] != "fallback" {
			t.Errorf("Expected status 'fallback', got '%s'", response["status"])
		}
		if response["message"] != "Request allowed (Device check not supported on this platform/environment)" {
			t.Errorf("Unexpected message: '%s'", response["message"])
		}
	})
}
