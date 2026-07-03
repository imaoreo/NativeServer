package db

import (
	"context"
	"database/sql"
	"embed"
	"fmt"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var embedMigrations embed.FS

type DBConnector interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func InitDB(databaseURL string) (*sql.DB, error) {
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	// Set goose to use embedded migrations
	goose.SetBaseFS(embedMigrations)

	if err := goose.SetDialect("postgres"); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to set goose dialect: %w", err)
	}

	// Run up migrations
	if err := goose.Up(db, "migrations"); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to run goose migrations up: %w", err)
	}

	return db, nil
}

func SaveDeviceKey(db DBConnector, ctx context.Context, keyID string, publicKeyPEM string) error {
	deviceID := uuid.New().String()
	_, err := db.ExecContext(ctx, `
		INSERT INTO "DeviceKey" ("id", "keyId", "publicKey", "counter", "createdAt", "updatedAt")
		VALUES ($1, $2, $3, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`, deviceID, keyID, publicKeyPEM)
	return err
}

type DBQueryConnector interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func GetDeviceKey(db DBQueryConnector, ctx context.Context, keyID string) (string, error) {
	var publicKeyPEM string
	err := db.QueryRowContext(ctx, `
		SELECT "publicKey" FROM "DeviceKey" WHERE "keyId" = $1
	`, keyID).Scan(&publicKeyPEM)
	return publicKeyPEM, err
}
