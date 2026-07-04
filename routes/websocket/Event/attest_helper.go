package Event

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"log"

	"dev.imaoreo/NativeServer/db"
	"github.com/redis/go-redis/v9"
	"github.com/splitsecure/go-app-attest/appattest"
)

// VerifyAssertionSignature verifies an App Attest assertion signature of a challenge.
func VerifyAssertionSignature(
	ctx context.Context,
	rdb redis.Cmdable,
	dbQueryConn db.DBQueryConnector,
	attestor appattest.Attestor,
	appleTeamID, appleBundleID string,
	keyID, assertionB64, challenge string,
) error {
	// 1. Verify challenge exists in Redis
	challengeKey := "attest_challenge:" + challenge
	challengeExists, err := rdb.Get(ctx, challengeKey).Result()
	if err == redis.Nil || challengeExists == "" {
		log.Printf("[ERROR] VerifyAssertionSignature challenge not found: %s", challenge)
		return fmt.Errorf("invalid or expired challenge")
	}
	rdb.Del(ctx, challengeKey)

	// 2. Fetch public key from DB
	publicKeyPEM, err := db.GetDeviceKey(dbQueryConn, ctx, keyID)
	if err != nil {
		log.Printf("[ERROR] VerifyAssertionSignature keyID %s not registered in DB: %v", keyID, err)
		return fmt.Errorf("device key not registered")
	}

	assertionBytes, err := base64.StdEncoding.DecodeString(assertionB64)
	if err != nil {
		return fmt.Errorf("invalid assertion encoding")
	}

	block, _ := pem.Decode([]byte(publicKeyPEM))
	if block == nil {
		return fmt.Errorf("invalid public key format")
	}

	pubKey, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return fmt.Errorf("failed to parse public key")
	}

	ecdsaPubKey, ok := pubKey.(*ecdsa.PublicKey)
	if !ok {
		return fmt.Errorf("key is not an ECDSA public key")
	}

	// 3. Verify assertion signature
	clientDataHash := sha256.Sum256([]byte(challenge))
	assertionInput := &appattest.VerifyAssertionInput{
		Pubkey:           ecdsaPubKey,
		Assertion:        assertionBytes,
		ClientDataSHA256: clientDataHash[:],
	}

	output, err := appattest.VerifyAssertion(assertionInput)
	if err != nil {
		return err
	}

	// Verify bundle ID and team ID match
	appID := fmt.Sprintf("%s.%s", appleTeamID, appleBundleID)
	expectedBundleDigest := sha256.Sum256([]byte(appID))
	if !bytes.Equal(output.BundleHash, expectedBundleDigest[:]) {
		return fmt.Errorf("bundle digest mismatch")
	}

	return nil
}
