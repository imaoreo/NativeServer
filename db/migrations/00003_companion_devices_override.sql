-- +goose Up
-- +goose StatementBegin
ALTER TABLE "CompanionDevice" ADD COLUMN "isOverride" BOOLEAN NOT NULL DEFAULT FALSE;

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

-- +goose Down
-- +goose StatementBegin
ALTER TABLE "CompanionDevice" DROP COLUMN IF EXISTS "isOverride";

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
-- +goose StatementEnd
