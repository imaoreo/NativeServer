package Event

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"time"

	"dev.imaoreo/NativeServer/db"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/splitsecure/go-app-attest/appattest"
)

// HandleGetChallenge issues a new App Attest challenge UUID.
func HandleGetChallenge(c Client, rdb redis.Cmdable, ctx context.Context) {
	challengeVal := uuid.New().String()
	err := rdb.Set(ctx, "attest_challenge:"+challengeVal, "valid", 300*time.Second).Err()
	if err != nil {
		c.SendError("get_challenge", "Failed to generate challenge")
		return
	}
	c.SendSuccess("challenge", map[string]interface{}{
		"challenge": challengeVal,
		"ttl":       300,
	})
}

// HandleVerifyAttestation verifies initial Apple App Attest attestation.
func HandleVerifyAttestation(
	c Client,
	rawPayload json.RawMessage,
	rdb redis.Cmdable,
	dbConn db.DBConnector,
	attestor appattest.Attestor,
	appleTeamID, appleBundleID string,
	ctx context.Context,
) {
	var payload struct {
		KeyID       string `json:"keyId"`
		Attestation string `json:"attestation"`
		Challenge   string `json:"challenge"`
	}
	if err := json.Unmarshal(rawPayload, &payload); err != nil {
		log.Printf("[ERROR] HandleVerifyAttestation unmarshal payload failed: %v", err)
		c.SendError("attestation_verified", "Invalid payload format")
		return
	}

	// 1. Verify challenge exists in Redis
	challengeKey := "attest_challenge:" + payload.Challenge
	challengeExists, err := rdb.Get(ctx, challengeKey).Result()
	if err == redis.Nil || challengeExists == "" {
		log.Printf("[ERROR] HandleVerifyAttestation challenge not found or expired: %s", payload.Challenge)
		c.SendError("attestation_verified", "Invalid or expired challenge")
		return
	}
	rdb.Del(ctx, challengeKey)

	// 2. Decode Attestation from Base64
	attestationBytes, err := base64.StdEncoding.DecodeString(payload.Attestation)
	if err != nil {
		log.Printf("[ERROR] HandleVerifyAttestation base64 decode attestation failed: %v", err)
		c.SendError("attestation_verified", "Invalid attestation encoding")
		return
	}

	// 3. Verify App Attest Attestation
	challengeHash := sha256.Sum256([]byte(payload.Challenge))
	attestorInput := &appattest.VerifyAttestationInput{
		ServerChallenge: challengeHash[:],
		AttestationCBOR: attestationBytes,
	}

	res, err := attestor.VerifyAttestation(attestorInput)
	if err != nil {
		log.Printf("[ERROR] HandleVerifyAttestation VerifyAttestation failed: %v", err)
		c.SendError("attestation_verified", fmt.Sprintf("Attestation verification failed: %v", err))
		return
	}

	// Verify bundle ID and team ID match
	appID := fmt.Sprintf("%s.%s", appleTeamID, appleBundleID)
	expectedBundleDigest := sha256.Sum256([]byte(appID))
	if !bytes.Equal(res.BundleDigest, expectedBundleDigest[:]) {
		log.Printf("[ERROR] HandleVerifyAttestation bundle digest mismatch: res.BundleDigest=%x, expected=%x", res.BundleDigest, expectedBundleDigest)
		c.SendError("attestation_verified", "Bundle digest mismatch")
		return
	}

	// Verify client keyId matches res.KeyID
	var clientKeyIDBytes []byte
	if decoded, err := base64.StdEncoding.DecodeString(payload.KeyID); err == nil {
		clientKeyIDBytes = decoded
	} else if decoded, err := base64.URLEncoding.DecodeString(payload.KeyID); err == nil {
		clientKeyIDBytes = decoded
	} else if decoded, err := hex.DecodeString(payload.KeyID); err == nil {
		clientKeyIDBytes = decoded
	} else {
		clientKeyIDBytes = []byte(payload.KeyID)
	}

	if !bytes.Equal(res.KeyID, clientKeyIDBytes) {
		log.Printf("[ERROR] HandleVerifyAttestation Key ID mismatch: res.KeyID=%x, clientKeyIDBytes=%x", res.KeyID, clientKeyIDBytes)
		c.SendError("attestation_verified", "Key ID mismatch")
		return
	}

	// 4. Save device public key
	pubKey := res.AttestedPubkey()
	derBytes, err := x509.MarshalPKIXPublicKey(pubKey)
	if err != nil {
		log.Printf("[ERROR] HandleVerifyAttestation MarshalPKIXPublicKey failed: %v", err)
		c.SendError("attestation_verified", "Failed to marshal public key")
		return
	}
	pemBlock := &pem.Block{Type: "PUBLIC KEY", Bytes: derBytes}
	publicKeyPEM := string(pem.EncodeToMemory(pemBlock))

	err = db.SaveDeviceKey(dbConn, ctx, payload.KeyID, publicKeyPEM)
	if err != nil {
		log.Printf("[ERROR] HandleVerifyAttestation SaveDeviceKey failed: %v", err)
		c.SendError("attestation_verified", "Database error saving device key")
		return
	}

	log.Printf("[SUCCESS] HandleVerifyAttestation registered device successfully. keyId: %s", payload.KeyID)
	c.Authenticate("device_checked", payload.KeyID)
	c.SendSuccess("attestation_verified", map[string]string{"status": "success"})
}

// HandleAssertIdentity verifies App Attest assertions for subsequent connects.
func HandleAssertIdentity(
	c Client,
	rawPayload json.RawMessage,
	rdb redis.Cmdable,
	dbQueryConn db.DBQueryConnector,
	appleTeamID, appleBundleID string,
	ctx context.Context,
) {
	var payload struct {
		KeyID     string `json:"keyId"`
		Assertion string `json:"assertion"`
		Challenge string `json:"challenge"`
	}
	if err := json.Unmarshal(rawPayload, &payload); err != nil {
		log.Printf("[ERROR] HandleAssertIdentity unmarshal payload failed: %v", err)
		c.SendError("identity_verified", "Invalid payload format")
		return
	}

	err := VerifyAssertionSignature(ctx, rdb, dbQueryConn, nil, appleTeamID, appleBundleID, payload.KeyID, payload.Assertion, payload.Challenge)
	if err != nil {
		log.Printf("[ERROR] HandleAssertIdentity VerifyAssertionSignature failed: %v", err)
		c.SendError("identity_verified", fmt.Sprintf("Assertion verification failed: %v", err))
		return
	}

	log.Printf("[SUCCESS] HandleAssertIdentity verified successfully. keyId: %s", payload.KeyID)
	c.Authenticate("device_checked", payload.KeyID)
	c.SendSuccess("identity_verified", map[string]string{"status": "success"})
}
