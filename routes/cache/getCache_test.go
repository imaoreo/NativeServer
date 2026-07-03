package cache

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestMakeGetCacheHandler(t *testing.T) {
	// Create a temp directory for cache
	tempDir, err := os.MkdirTemp("", "cache_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Write a dummy cached file
	fileName := "test_image.png"
	fileContent := []byte("fake-image-bytes")
	err = os.WriteFile(filepath.Join(tempDir, fileName), fileContent, 0644)
	if err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	handler := MakeGetCacheHandler(tempDir)

	t.Run("Serve existing file", func(t *testing.T) {
		req, err := http.NewRequest("GET", "/public/cache/"+fileName, nil)
		if err != nil {
			t.Fatal(err)
		}

		// Inject route parameter since chi does it when matching path
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("*", fileName)
		req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("Expected status 200, got %d", rr.Code)
		}

		if rr.Header().Get("Cache-Control") != "public, max-age=604800, immutable" {
			t.Errorf("Expected Cache-Control header, got %s", rr.Header().Get("Cache-Control"))
		}

		if rr.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("Expected X-Content-Type-Options nosniff, got %s", rr.Header().Get("X-Content-Type-Options"))
		}

		if rr.Body.String() != string(fileContent) {
			t.Errorf("Expected body %q, got %q", string(fileContent), rr.Body.String())
		}
	})

	t.Run("Serve non-existing file", func(t *testing.T) {
		req, err := http.NewRequest("GET", "/public/cache/missing.png", nil)
		if err != nil {
			t.Fatal(err)
		}

		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("*", "missing.png")
		req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusNotFound {
			t.Errorf("Expected status 404, got %d", rr.Code)
		}
	})

	t.Run("Directory traversal attempt", func(t *testing.T) {
		req, err := http.NewRequest("GET", "/public/cache/../outside.png", nil)
		if err != nil {
			t.Fatal(err)
		}

		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("*", "../outside.png")
		req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		// Directory traversal should be caught and return 403 Forbidden
		if rr.Code != http.StatusForbidden {
			t.Errorf("Expected status 403, got %d", rr.Code)
		}
	})
}
