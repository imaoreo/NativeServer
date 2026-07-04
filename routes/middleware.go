package routes

import (
	"context"
	"bytes"
	"crypto/ecdsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"dev.imaoreo/NativeServer/db"
	"github.com/redis/go-redis/v9"
	"github.com/splitsecure/go-app-attest/appattest"
)

func VerifyAssertionMiddleware(
	rdb redis.Cmdable,
	dbConn db.DBQueryConnector,
	appleTeamID string,
	appleBundleID string,
) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// 1. Check for manual Companion API Key (either X-Companion-API-Key or Bearer token)
			apiKey := r.Header.Get("X-Companion-API-Key")
			if apiKey == "" {
				authHeader := r.Header.Get("Authorization")
				if strings.HasPrefix(authHeader, "Bearer ") {
					apiKey = strings.TrimPrefix(authHeader, "Bearer ")
				}
			}

			// If it's a companion API key, validate it via database
			if apiKey != "" && (strings.HasPrefix(apiKey, "ng_mac_") || strings.HasPrefix(apiKey, "ng_mac_force_")) {
				ctx := r.Context()
				valid, err := db.ValidateCompanionAPIKey(dbConn, ctx, apiKey)
				if err != nil {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusInternalServerError)
					w.Write([]byte(`{"status":"failed","error":"Database error validating API key"}`))
					return
				}

				if !valid {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusUnauthorized)
					w.Write([]byte(`{"status":"failed","error":"Invalid companion API key"}`))
					return
				}

				// Key is valid! Pass verification and mark as device_signed = true
				ctx = context.WithValue(ctx, "device_signed", true)
				ctx = context.WithValue(ctx, "is_companion_key", true)
				r = r.WithContext(ctx)
				next.ServeHTTP(w, r)
				return
			}

			keyID := r.Header.Get("X-Device-Key-ID")
			assertionB64 := r.Header.Get("X-Device-Assertion")
			challenge := r.Header.Get("X-Device-Challenge")

			if keyID == "" || assertionB64 == "" || challenge == "" {
				// Manual override to allow unsupported devices
				if os.Getenv("ALLOW_UNSUPPORTED_DEVICES") != "false" {
					next.ServeHTTP(w, r)
					return
				}

				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				w.Write([]byte(`{"status":"failed","error":"Device attestation assertion headers missing"}`))
				return
			}

			ctx := r.Context()
			challengeKey := "attest_challenge:" + challenge

			challengeExists, err := rdb.Get(ctx, challengeKey).Result()
			if err == redis.Nil || challengeExists == "" {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				w.Write([]byte(`{"status":"failed","error":"Invalid or expired challenge"}`))
				return
			} else if err != nil {
				log.Printf("Redis error fetching challenge: %v", err)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte(`{"status":"failed","error":"Internal Server Error"}`))
				return
			}

			rdb.Del(ctx, challengeKey)

			publicKeyPEM, err := db.GetDeviceKey(dbConn, ctx, keyID)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				w.Write([]byte(`{"status":"failed","error":"Device key not registered"}`))
				return
			}

			var bodyBytes []byte
			if r.Body != nil {
				bodyBytes, err = io.ReadAll(r.Body)
				if err != nil {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusBadRequest)
					w.Write([]byte(`{"status":"failed","error":"Failed to read request body"}`))
					return
				}

				r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
			}

			scheme := "https"
			if r.TLS == nil {
				scheme = "http"
			}
			fullURL := fmt.Sprintf("%s://%s%s", scheme, r.Host, r.URL.RequestURI())

			var clientData []byte
			clientData = append(clientData, bodyBytes...)
			clientData = append(clientData, []byte(fullURL)...)
			clientData = append(clientData, []byte(challenge)...)
			clientDataHash := sha256.Sum256(clientData)

			assertionBytes, err := base64.StdEncoding.DecodeString(assertionB64)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				w.Write([]byte(`{"status":"failed","error":"Invalid assertion encoding"}`))
				return
			}

			block, _ := pem.Decode([]byte(publicKeyPEM))
			if block == nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte(`{"status":"failed","error":"Invalid public key format"}`))
				return
			}

			pubKey, err := x509.ParsePKIXPublicKey(block.Bytes)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte(`{"status":"failed","error":"Failed to parse public key"}`))
				return
			}

			ecdsaPubKey, ok := pubKey.(*ecdsa.PublicKey)
			if !ok {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte(`{"status":"failed","error":"Key is not an ECDSA public key"}`))
				return
			}

			assertionInput := &appattest.VerifyAssertionInput{
				Pubkey:           ecdsaPubKey,
				Assertion:        assertionBytes,
				ClientDataSHA256: clientDataHash[:],
			}

			output, err := appattest.VerifyAssertion(assertionInput)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				w.Write([]byte(fmt.Sprintf(`{"status":"failed","error":"Assertion verification failed: %v"}`, err)))
				return
			}

			appID := fmt.Sprintf("%s.%s", appleTeamID, appleBundleID)
			expectedBundleDigest := sha256.Sum256([]byte(appID))
			if !bytes.Equal(output.BundleHash, expectedBundleDigest[:]) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				w.Write([]byte(`{"status":"failed","error":"Bundle digest mismatch"}`))
				return
			}

			ctx = context.WithValue(ctx, "device_signed", true)
			r = r.WithContext(ctx)
			
			next.ServeHTTP(w, r)
		})
	}
}
