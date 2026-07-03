-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS "CompanionDevice" (
    "id" TEXT NOT NULL,
    "profileId" TEXT,
    "discordId" TEXT,
    "apiKey" TEXT,
    "registrationSource" TEXT NOT NULL, -- 'ios_anchor_link' or 'discord_manual_key'
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanionDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CompanionDevice_apiKey_key" ON "CompanionDevice"("apiKey") WHERE "apiKey" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "CompanionDevice_profileId_idx" ON "CompanionDevice"("profileId");

CREATE OR REPLACE FUNCTION enforce_max_companion_devices()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."profileId" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."profileId" IS NULL OR OLD."profileId" <> NEW."profileId") THEN
        IF (SELECT COUNT(*) FROM "CompanionDevice" WHERE "profileId" = NEW."profileId") >= 4 THEN
            RAISE EXCEPTION 'User profile has reached the maximum of 4 companion devices';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_max_companion_devices
BEFORE INSERT OR UPDATE ON "CompanionDevice"
FOR EACH ROW
EXECUTE FUNCTION enforce_max_companion_devices();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TRIGGER IF EXISTS check_max_companion_devices ON "CompanionDevice";
DROP FUNCTION IF EXISTS enforce_max_companion_devices();
DROP INDEX IF EXISTS "CompanionDevice_profileId_idx";
DROP INDEX IF EXISTS "CompanionDevice_apiKey_key";
DROP TABLE IF EXISTS "CompanionDevice";
-- +goose StatementEnd
