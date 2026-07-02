package challenge

import (
	"bytes"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"log"
	"net/http"

	"dev.imaoreo/NativeServer/db"
	"github.com/redis/go-redis/v9"
	"github.com/splitsecure/go-app-attest/appattest"
)

type ChallengeRequest struct {
	KeyID       string `json:"keyId"`
	Attestation string `json:"attestation"`
	Challenge   string `json:"challenge"`
}

func MakePostChallengeHandler(
	rdb *redis.Client,
	dbConn *sql.DB,
	attestor *appattest.AttestorImpl,
	appleTeamID string,
	appleBundleID string,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req ChallengeRequest
		err := json.NewDecoder(r.Body).Decode(&req)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{
				"status": "failed",
				"error":  "Invalid JSON payload",
			})
			return
		}

		ctx := r.Context()
		challengeKey := "attest_challenge:" + req.Challenge

		// Verify challenge exists in Redis
		challengeExists, err := rdb.Get(ctx, challengeKey).Result()
		if err == redis.Nil || challengeExists == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{
				"status": "failed",
				"error":  "Invalid or expired challenge",
			})
			return
		} else if err != nil {
			log.Printf("Redis error fetching challenge: %v", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{
				"status": "failed",
				"error":  "Internal Server Error",
			})
			return
		}

		// Verify Apple Attestation
		attestationBytes, err := base64.StdEncoding.DecodeString(req.Attestation)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{
				"status": "failed",
				"error":  "Invalid attestation base64 encoding",
			})
			return
		}

		// ServerChallenge must be the SHA256 of the challenge string as expected by go-app-attest
		challengeHash := sha256.Sum256([]byte(req.Challenge))

		attestorInput := &appattest.VerifyAttestationInput{
			ServerChallenge: challengeHash[:],
			AttestationCBOR: attestationBytes,
		}

		res, err := attestor.VerifyAttestation(attestorInput)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{
				"status": "failed",
				"error":  fmt.Sprintf("Verification Error: %v", err),
			})
			return
		}

		// Verify bundle ID and team ID
		appID := fmt.Sprintf("%s.%s", appleTeamID, appleBundleID)
		expectedBundleDigest := sha256.Sum256([]byte(appID))
		if !bytes.Equal(res.BundleDigest, expectedBundleDigest[:]) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{
				"status": "failed",
				"error":  "Verification Error: Bundle digest mismatch",
			})
			return
		}

		// Verify keyId matches res.KeyID
		var clientKeyIDBytes []byte
		if decoded, err := base64.StdEncoding.DecodeString(req.KeyID); err == nil {
			clientKeyIDBytes = decoded
		} else if decoded, err := base64.URLEncoding.DecodeString(req.KeyID); err == nil {
			clientKeyIDBytes = decoded
		} else if decoded, err := hex.DecodeString(req.KeyID); err == nil {
			clientKeyIDBytes = decoded
		} else {
			clientKeyIDBytes = []byte(req.KeyID)
		}

		if !bytes.Equal(res.KeyID, clientKeyIDBytes) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{
				"status": "failed",
				"error":  "Verification Error: Key ID mismatch",
			})
			return
		}

		// Extract public key in PEM format
		pubKey := res.AttestedPubkey()
		derBytes, err := x509.MarshalPKIXPublicKey(pubKey)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{
				"status": "failed",
				"error":  fmt.Sprintf("Verification Error: Failed to marshal public key: %v", err),
			})
			return
		}

		pemBlock := &pem.Block{
			Type:  "PUBLIC KEY",
			Bytes: derBytes,
		}
		publicKeyPEM := string(pem.EncodeToMemory(pemBlock))

		// Save DeviceKey to Database via DB helper in subpackage
		err = db.SaveDeviceKey(dbConn, ctx, req.KeyID, publicKeyPEM)
		if err != nil {
			log.Printf("DB error saving device key: %v", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{
				"status": "failed",
				"error":  "Verification Error: Database insert failed (keyId may already exist)",
			})
			return
		}

		// Delete challenge from Redis
		rdb.Del(ctx, challengeKey)

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		json.NewEncoder(w).Encode(map[string]string{
			"status": "success",
			"keyId":  req.KeyID,
		})
	}
}
