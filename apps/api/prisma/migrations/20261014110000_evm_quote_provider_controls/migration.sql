CREATE TABLE "evm_quote_provider_controls" (
    "id" VARCHAR(32) NOT NULL,
    "enabled_providers" TEXT[] NOT NULL DEFAULT ARRAY['0x', '1inch', 'paraswap']::TEXT[],
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "evm_quote_provider_controls_pkey" PRIMARY KEY ("id")
);

INSERT INTO "evm_quote_provider_controls" ("id", "updated_at")
VALUES ('evm_quote_providers', CURRENT_TIMESTAMP);

ALTER TABLE "evm_quote_provider_controls"
ADD CONSTRAINT "evm_quote_provider_controls_updated_by_fkey"
FOREIGN KEY ("updated_by") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
