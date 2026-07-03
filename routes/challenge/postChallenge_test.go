package challenge

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"dev.imaoreo/NativeServer/testutils"
	"github.com/redis/go-redis/v9"
	"github.com/splitsecure/go-app-attest/appattest"
)

func TestMakePostChallengeHandler(t *testing.T) {
	privKey := testutils.GenerateTestECDSAKey(t)

	appleTeamID := "TEAM123"
	appleBundleID := "com.example.app"
	appID := fmt.Sprintf("%s.%s", appleTeamID, appleBundleID)
	expectedDigest := sha256.Sum256([]byte(appID))

	testKeyID := "test-key-id"
	testChallenge := "test-challenge-uuid"
	validAttestationBase64 := base64.StdEncoding.EncodeToString([]byte("fake-cbor-attestation"))

	t.Run("Success", func(t *testing.T) {
		mockRedis := &testutils.MockRedisCmdable{
			GetFunc: func(ctx context.Context, key string) *redis.StringCmd {
				if key == "attest_challenge:"+testChallenge {
					return redis.NewStringResult("valid", nil)
				}
				return redis.NewStringResult("", redis.Nil)
			},
			DelFunc: func(ctx context.Context, keys ...string) *redis.IntCmd {
				return redis.NewIntResult(1, nil)
			},
		}

		mockDB := &testutils.MockDBConnector{
			ExecFunc: func(ctx context.Context, query string, args ...any) (sql.Result, error) {
				return nil, nil
			},
		}

		mockAttestorObj := &testutils.MockAttestor{
			VerifyFunc: func(in *appattest.VerifyAttestationInput) (appattest.VerifyAttestationOutput, error) {
				return appattest.VerifyAttestationOutput{
					BundleDigest: expectedDigest[:],
					KeyID:        []byte(testKeyID),
					LeafCert: &x509.Certificate{
						PublicKey: &privKey.PublicKey,
					},
				}, nil
			},
		}

		handler := MakePostChallengeHandler(mockRedis, mockDB, mockAttestorObj, appleTeamID, appleBundleID)

		reqBody, _ := json.Marshal(ChallengeRequest{
			KeyID:       testKeyID,
			Attestation: validAttestationBase64,
			Challenge:   testChallenge,
		})

		req, err := http.NewRequest("POST", "/v1/challenge", bytes.NewBuffer(reqBody))
		if err != nil {
			t.Fatal(err)
		}

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("Expected status 200, got %d. Body: %s", rr.Code, rr.Body.String())
		}

		var response map[string]string
		if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
			t.Fatalf("Failed to unmarshal response: %v", err)
		}

		if response["status"] != "success" {
			t.Errorf("Expected status 'success', got '%s'", response["status"])
		}
		if response["keyId"] != testKeyID {
			t.Errorf("Expected keyId '%s', got '%s'", testKeyID, response["keyId"])
		}
	})

	t.Run("Invalid JSON", func(t *testing.T) {
		mockRedis := &testutils.MockRedisCmdable{}
		mockDB := &testutils.MockDBConnector{}
		mockAttestorObj := &testutils.MockAttestor{}

		handler := MakePostChallengeHandler(mockRedis, mockDB, mockAttestorObj, appleTeamID, appleBundleID)

		req, err := http.NewRequest("POST", "/v1/challenge", bytes.NewBufferString("{invalid json}"))
		if err != nil {
			t.Fatal(err)
		}

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Errorf("Expected status 400, got %d", rr.Code)
		}
	})

	t.Run("Challenge Expired or Missing", func(t *testing.T) {
		mockRedis := &testutils.MockRedisCmdable{
			GetFunc: func(ctx context.Context, key string) *redis.StringCmd {
				return redis.NewStringResult("", redis.Nil)
			},
		}
		mockDB := &testutils.MockDBConnector{}
		mockAttestorObj := &testutils.MockAttestor{}

		handler := MakePostChallengeHandler(mockRedis, mockDB, mockAttestorObj, appleTeamID, appleBundleID)

		reqBody, _ := json.Marshal(ChallengeRequest{
			KeyID:       testKeyID,
			Attestation: validAttestationBase64,
			Challenge:   "expired-challenge",
		})

		req, err := http.NewRequest("POST", "/v1/challenge", bytes.NewBuffer(reqBody))
		if err != nil {
			t.Fatal(err)
		}

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Errorf("Expected status 400, got %d", rr.Code)
		}
	})

	t.Run("Attestor Verification Failure", func(t *testing.T) {
		mockRedis := &testutils.MockRedisCmdable{
			GetFunc: func(ctx context.Context, key string) *redis.StringCmd {
				return redis.NewStringResult("valid", nil)
			},
		}
		mockDB := &testutils.MockDBConnector{}
		mockAttestorObj := &testutils.MockAttestor{
			VerifyFunc: func(in *appattest.VerifyAttestationInput) (appattest.VerifyAttestationOutput, error) {
				return appattest.VerifyAttestationOutput{}, errors.New("signature mismatch")
			},
		}

		handler := MakePostChallengeHandler(mockRedis, mockDB, mockAttestorObj, appleTeamID, appleBundleID)

		reqBody, _ := json.Marshal(ChallengeRequest{
			KeyID:       testKeyID,
			Attestation: validAttestationBase64,
			Challenge:   testChallenge,
		})

		req, err := http.NewRequest("POST", "/v1/challenge", bytes.NewBuffer(reqBody))
		if err != nil {
			t.Fatal(err)
		}

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Errorf("Expected status 400, got %d", rr.Code)
		}
	})

	t.Run("Bundle Digest Mismatch", func(t *testing.T) {
		mockRedis := &testutils.MockRedisCmdable{
			GetFunc: func(ctx context.Context, key string) *redis.StringCmd {
				return redis.NewStringResult("valid", nil)
			},
		}
		mockDB := &testutils.MockDBConnector{}
		mockAttestorObj := &testutils.MockAttestor{
			VerifyFunc: func(in *appattest.VerifyAttestationInput) (appattest.VerifyAttestationOutput, error) {
				return appattest.VerifyAttestationOutput{
					BundleDigest: []byte("different-bundle-digest"),
					KeyID:        []byte(testKeyID),
					LeafCert: &x509.Certificate{
						PublicKey: &privKey.PublicKey,
					},
				}, nil
			},
		}

		handler := MakePostChallengeHandler(mockRedis, mockDB, mockAttestorObj, appleTeamID, appleBundleID)

		reqBody, _ := json.Marshal(ChallengeRequest{
			KeyID:       testKeyID,
			Attestation: validAttestationBase64,
			Challenge:   testChallenge,
		})

		req, err := http.NewRequest("POST", "/v1/challenge", bytes.NewBuffer(reqBody))
		if err != nil {
			t.Fatal(err)
		}

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Errorf("Expected status 400, got %d", rr.Code)
		}
	})

	t.Run("Database Error", func(t *testing.T) {
		mockRedis := &testutils.MockRedisCmdable{
			GetFunc: func(ctx context.Context, key string) *redis.StringCmd {
				return redis.NewStringResult("valid", nil)
			},
		}

		mockDB := &testutils.MockDBConnector{
			ExecFunc: func(ctx context.Context, query string, args ...any) (sql.Result, error) {
				return nil, errors.New("duplicate key")
			},
		}

		mockAttestorObj := &testutils.MockAttestor{
			VerifyFunc: func(in *appattest.VerifyAttestationInput) (appattest.VerifyAttestationOutput, error) {
				return appattest.VerifyAttestationOutput{
					BundleDigest: expectedDigest[:],
					KeyID:        []byte(testKeyID),
					LeafCert: &x509.Certificate{
						PublicKey: &privKey.PublicKey,
					},
				}, nil
			},
		}

		handler := MakePostChallengeHandler(mockRedis, mockDB, mockAttestorObj, appleTeamID, appleBundleID)

		reqBody, _ := json.Marshal(ChallengeRequest{
			KeyID:       testKeyID,
			Attestation: validAttestationBase64,
			Challenge:   testChallenge,
		})

		req, err := http.NewRequest("POST", "/v1/challenge", bytes.NewBuffer(reqBody))
		if err != nil {
			t.Fatal(err)
		}

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Errorf("Expected status 400, got %d", rr.Code)
		}
	})
}
