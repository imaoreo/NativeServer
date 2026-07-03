package testutils

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"database/sql"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/splitsecure/go-app-attest/appattest"
)

type MockRedisCmdable struct {
	redis.Cmdable
	SetFunc func(ctx context.Context, key string, value interface{}, expiration time.Duration) *redis.StatusCmd
	GetFunc func(ctx context.Context, key string) *redis.StringCmd
	DelFunc func(ctx context.Context, keys ...string) *redis.IntCmd
}

func (m *MockRedisCmdable) Set(ctx context.Context, key string, value interface{}, expiration time.Duration) *redis.StatusCmd {
	if m.SetFunc != nil {
		return m.SetFunc(ctx, key, value, expiration)
	}
	return nil
}

func (m *MockRedisCmdable) Get(ctx context.Context, key string) *redis.StringCmd {
	if m.GetFunc != nil {
		return m.GetFunc(ctx, key)
	}
	return nil
}

func (m *MockRedisCmdable) Del(ctx context.Context, keys ...string) *redis.IntCmd {
	if m.DelFunc != nil {
		return m.DelFunc(ctx, keys...)
	}
	return nil
}

type MockDBConnector struct {
	ExecFunc func(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryRowFunc func(ctx context.Context, query string, args ...any) *sql.Row
}

func (m *MockDBConnector) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	if m.ExecFunc != nil {
		return m.ExecFunc(ctx, query, args...)
	}
	return nil, nil
}

func (m *MockDBConnector) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	if m.QueryRowFunc != nil {
		return m.QueryRowFunc(ctx, query, args...)
	}
	return nil
}

type MockAttestor struct {
	VerifyFunc func(in *appattest.VerifyAttestationInput) (appattest.VerifyAttestationOutput, error)
}

func (m *MockAttestor) VerifyAttestation(in *appattest.VerifyAttestationInput) (appattest.VerifyAttestationOutput, error) {
	if m.VerifyFunc != nil {
		return m.VerifyFunc(in)
	}
	return appattest.VerifyAttestationOutput{}, nil
}

func GenerateTestECDSAKey(t *testing.T) *ecdsa.PrivateKey {
	t.Helper()
	privKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("Failed to generate test ECDSA key: %v", err)
	}
	return privKey
}
