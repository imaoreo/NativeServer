package routes

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"dev.imaoreo/NativeServer/testutils"
)

func TestVerifyAssertionMiddlewareFallback(t *testing.T) {
	mockRedis := &testutils.MockRedisCmdable{}
	mockDB := &testutils.MockDBConnector{}

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("passed"))
	})

	middleware := VerifyAssertionMiddleware(mockRedis, mockDB, "TEAM123", "com.example.app")
	handler := middleware(nextHandler)

	t.Run("Headers Missing - Fallback Allowed (Default)", func(t *testing.T) {
		os.Setenv("ALLOW_UNSUPPORTED_DEVICES", "true")
		defer os.Unsetenv("ALLOW_UNSUPPORTED_DEVICES")

		req, err := http.NewRequest("POST", "/api/v1/some-secure-endpoint", nil)
		if err != nil {
			t.Fatal(err)
		}

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("Expected status 200, got %d", rr.Code)
		}
		if rr.Body.String() != "passed" {
			t.Errorf("Expected body 'passed', got '%s'", rr.Body.String())
		}
	})

	t.Run("Headers Missing - Fallback Disallowed", func(t *testing.T) {
		os.Setenv("ALLOW_UNSUPPORTED_DEVICES", "false")
		defer os.Unsetenv("ALLOW_UNSUPPORTED_DEVICES")

		req, err := http.NewRequest("POST", "/api/v1/some-secure-endpoint", nil)
		if err != nil {
			t.Fatal(err)
		}

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusUnauthorized {
			t.Errorf("Expected status 401, got %d", rr.Code)
		}
	})
}
