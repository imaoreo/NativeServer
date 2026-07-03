package db

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"dev.imaoreo/NativeServer/testutils"
)

type mockResult struct {
	sql.Result
	rowsAffected int64
	lastInsertID int64
	err          error
}

func (m *mockResult) LastInsertId() (int64, error) {
	return m.lastInsertID, m.err
}

func (m *mockResult) RowsAffected() (int64, error) {
	return m.rowsAffected, m.err
}

func TestSaveDeviceKey_Success(t *testing.T) {
	mockDB := &testutils.MockDBConnector{
		ExecFunc: func(ctx context.Context, query string, args ...any) (sql.Result, error) {
			if len(args) != 3 {
				t.Errorf("Expected 3 arguments, got %d", len(args))
			}
			if args[1] != "testKeyID" {
				t.Errorf("Expected keyID 'testKeyID', got '%v'", args[1])
			}
			if args[2] != "testPublicKeyPEM" {
				t.Errorf("Expected publicKeyPEM 'testPublicKeyPEM', got '%v'", args[2])
			}
			return &mockResult{rowsAffected: 1}, nil
		},
	}

	err := SaveDeviceKey(mockDB, context.Background(), "testKeyID", "testPublicKeyPEM")
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
}

func TestSaveDeviceKey_Failure(t *testing.T) {
	expectedErr := errors.New("db error")
	mockDB := &testutils.MockDBConnector{
		ExecFunc: func(ctx context.Context, query string, args ...any) (sql.Result, error) {
			return nil, expectedErr
		},
	}

	err := SaveDeviceKey(mockDB, context.Background(), "testKeyID", "testPublicKeyPEM")
	if !errors.Is(err, expectedErr) {
		t.Errorf("Expected error %v, got %v", expectedErr, err)
	}
}
