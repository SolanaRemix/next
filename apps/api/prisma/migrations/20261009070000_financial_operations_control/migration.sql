CREATE TABLE "financial_operations_controls" (
  "id" VARCHAR(32) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "updated_by" UUID,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "financial_operations_controls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "financial_operations_controls_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "financial_operations_controls" ("id", "enabled", "updated_at")
VALUES ('global_execution', FALSE, CURRENT_TIMESTAMP);
