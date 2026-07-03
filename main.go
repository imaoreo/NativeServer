package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"dev.imaoreo/NativeServer/db"
	"dev.imaoreo/NativeServer/routes/cache"
	"dev.imaoreo/NativeServer/routes/challenge"
	"dev.imaoreo/NativeServer/routes/health"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/redis/go-redis/v9"
	"github.com/splitsecure/go-app-attest/appattest"
)

var (
	port          int
	cacheDir      string
	appleTeamID   string
	appleBundleID string
	databaseURL   string
	redisURL      string
	dbConn        *sql.DB
	rdb           *redis.Client
)

func initEnv() {
	var err error

	portStr := os.Getenv("PORT")
	if portStr == "" {
		port = 3000
	} else {
		port, err = strconv.Atoi(portStr)
		if err != nil {
			log.Fatalf("Invalid PORT env variable: %v", err)
		}
	}

	cacheDir = os.Getenv("CACHE_DIR")
	if cacheDir == "" {
		cacheDir = "./public/cache"
	}

	appleTeamID = os.Getenv("APPLE_TEAM_ID")
	if appleTeamID == "" {
		appleTeamID = "TEAM123456"
	}

	appleBundleID = os.Getenv("APPLE_BUNDLE_ID")
	if appleBundleID == "" {
		appleBundleID = "dev.imaoreo.NativeGrind"
	}

	databaseURL = os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgresql://grind_user:secure_password123@localhost:5432/grind_db?sslmode=disable"
	}

	redisURL = os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379"
	}
}

func main() {
	initEnv()

	log.Printf("Starting Native Server on port %d...", port)

	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		log.Fatalf("Failed to create cache directory %s: %v", cacheDir, err)
	}

	var err error

	// Postgres connection
	dbConn, err = db.InitDB(databaseURL)
	if err != nil {
		log.Fatalf("Database initialization failed: %v", err)
	}
	defer dbConn.Close()

	log.Println("Database connection and tables initialized.")

	// redis connection
	redisOpt, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatalf("Failed to parse Redis URL: %v", err)
	}
	rdb = redis.NewClient(redisOpt)
	defer rdb.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("Failed to ping Redis: %v", err)
	}
	log.Println("Redis connection established.")

	// App Attest initialization
	attestor, err := appattest.New()
	if err != nil {
		log.Fatalf("Failed to initialize App Attest: %v", err)
	}
	log.Println("Apple App Attest attestor initialized.")

	// HTTP Router
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(customRecoverer)

	// Routes
	r.Get("/health", health.GetHealthHandler)
	r.Get("/public/cache/*", cache.MakeGetCacheHandler(cacheDir))

	r.Get("/api/v1/challenge", challenge.MakeGetChallengeHandler(rdb))
	r.Post("/api/v1/challenge", challenge.MakePostChallengeHandler(rdb, dbConn, attestor, appleTeamID, appleBundleID))

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("Not Found"))
	})

	serverAddr := fmt.Sprintf(":%d", port)
	if err := http.ListenAndServe(serverAddr, r); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func customRecoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rvr := recover(); rvr != nil {
				log.Printf("Server error: %v", rvr)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}
