-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS "ProfileImage" (
    "id" TEXT NOT NULL,
    "mediaHash" TEXT NOT NULL,
    "imageLocation" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProfileImage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProfileImage_mediaHash_key" ON "ProfileImage"("mediaHash");

CREATE TABLE IF NOT EXISTS "DeviceKey" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeviceKey_keyId_key" ON "DeviceKey"("keyId");
CREATE INDEX IF NOT EXISTS "DeviceKey_keyId_idx" ON "DeviceKey"("keyId");
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS "DeviceKey_keyId_idx";
DROP INDEX IF EXISTS "DeviceKey_keyId_key";
DROP TABLE IF EXISTS "DeviceKey";

DROP INDEX IF EXISTS "ProfileImage_mediaHash_key";
DROP TABLE IF EXISTS "ProfileImage";
-- +goose StatementEnd
