-- +goose Up
-- +goose StatementBegin
ALTER TABLE "CompanionDevice" ADD COLUMN "deviceKeyId" TEXT;
ALTER TABLE "CompanionDevice" DROP COLUMN IF EXISTS "profileId";

CREATE OR REPLACE FUNCTION enforce_max_companion_devices()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."deviceKeyId" IS NOT NULL AND NEW."isOverride" = FALSE AND (TG_OP = 'INSERT' OR OLD."deviceKeyId" IS NULL OR OLD."deviceKeyId" <> NEW."deviceKeyId" OR OLD."isOverride" <> NEW."isOverride") THEN
        IF (SELECT COUNT(*) FROM "CompanionDevice" WHERE "deviceKeyId" = NEW."deviceKeyId" AND "isOverride" = FALSE) >= 4 THEN
            RAISE EXCEPTION 'This primary device has reached the maximum of 4 companion devices';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE "CompanionDevice" ADD COLUMN "profileId" TEXT;
ALTER TABLE "CompanionDevice" DROP COLUMN IF EXISTS "deviceKeyId";

CREATE OR REPLACE FUNCTION enforce_max_companion_devices()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."profileId" IS NOT NULL AND NEW."isOverride" = FALSE AND (TG_OP = 'INSERT' OR OLD."profileId" IS NULL OR OLD."profileId" <> NEW."profileId" OR OLD."isOverride" <> NEW."isOverride") THEN
        IF (SELECT COUNT(*) FROM "CompanionDevice" WHERE "profileId" = NEW."profileId" AND "isOverride" = FALSE) >= 4 THEN
            RAISE EXCEPTION 'User profile has reached the maximum of 4 companion devices';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
