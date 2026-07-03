package cache

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
)

func MakeGetCacheHandler(cacheDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fileName := chi.URLParam(r, "*")
		filePath := filepath.Join(cacheDir, fileName)

		absPath, err := filepath.Abs(filePath)
		if err != nil {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		absCacheDir, err := filepath.Abs(cacheDir)
		if err != nil {
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}

		rel, err := filepath.Rel(absCacheDir, absPath)
		if err != nil || strings.HasPrefix(rel, "..") {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		info, err := os.Stat(absPath)
		if err != nil {
			if os.IsNotExist(err) {
				http.Error(w, "Image not found", http.StatusNotFound)
			} else {
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			}
			return
		}
		if info.IsDir() {
			http.Error(w, "Image not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
		w.Header().Set("X-Content-Type-Options", "nosniff")

		http.ServeFile(w, r, absPath)
	}
}
