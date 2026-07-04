# Database & Cache Guide

This guide explains how to work with the PostgreSQL database and Redis cache in the Go server, which uses **Goose** for version-tracked database migrations.

---

## 1. Database Schema migrations via Goose

We use [pressly/goose/v3](https://github.com/pressly/goose) to run database migrations. Migrations are written as plain SQL files and embedded directly into the Go binary using standard `go:embed`.

On server startup, the server automatically reads the embedded migrations, creates a tracking table called `goose_db_version` if it is missing, checks which migrations have already run, and applies any new migrations.

### Migration Files
All migrations are stored under the [db/migrations/](db/migrations/) directory:
- [00001_init.sql](db/migrations/00001_init.sql): Initial schema creation (`ProfileImage` and `DeviceKey` tables).
- [00002_companion_devices.sql](db/migrations/00002_companion_devices.sql): Created the `CompanionDevice` table.
- [00003_companion_triggers.sql](db/migrations/00003_companion_triggers.sql): Added standard triggers.
- [00004_associate_companion_with_device.sql](db/migrations/00004_associate_companion_with_device.sql): Replaced profile association with App Attest primary key bindings.

---

### How to Create & Apply a New Migration

If you need to make schema changes (e.g., adding a table, adding a column, or reverting a change):

1. **Create a new migration file** inside the `db/migrations/` directory using a sequential numbering prefix:
   - For example: `db/migrations/00005_add_some_table.sql`.
2. **Define the UP and DOWN blocks** in the SQL file using Goose annotation headers:
   ```sql
   -- +goose Up
   -- +goose StatementBegin
   CREATE TABLE "User" (
       "id" TEXT NOT NULL PRIMARY KEY,
       "email" TEXT NOT NULL UNIQUE
   );
   -- +goose StatementEnd

   -- +goose Down
   -- +goose StatementBegin
   DROP TABLE IF EXISTS "User";
   -- +goose StatementEnd
   ```
3. **Run/Rebuild the server**. The server will automatically run the new migration on startup.

---

## 2. Using & Updating Redis

We use the official Go Redis client (`github.com/redis/go-redis/v9`).

### Configuration
The Redis client is instantiated in `main.go` using the `REDIS_URL` environment variable, falling back to `redis://localhost:6379` if unset:
```go
redisOpt, err := redis.ParseURL(redisURL)
rdb := redis.NewClient(redisOpt)
```

### Interacting with Redis in Go
Common commands:
```go
// 1. Set a standard key-value pair
err := rdb.Set(ctx, "my-key", "some-value", 0).Err()

// 2. Set a key with an expiration Time-To-Live (TTL) (e.g., 5 minutes)
err := rdb.Set(ctx, "attest_challenge:token_123", "valid", 5*time.Minute).Err()

// 3. Retrieve a value
val, err := rdb.Get(ctx, "attest_challenge:token_123").Result()

// 4. Delete a key
err := rdb.Del(ctx, "my-key").Err()
```

---

## 3. Useful Commands Quick Reference

| Action | Command |
| :--- | :--- |
| **Start DB & Redis Containers** | `docker compose up -d postgres redis` |
| **Stop All Containers** | `docker compose down` |
| **Build & Run Go Server Locally** | `go run .` |
| **Rebuild & Run App Container** | `docker compose up -d --build` |
