CREATE TYPE "AccountStatus" AS ENUM ('Active', 'Restricted');

ALTER TABLE "users"
ADD COLUMN "account_status" "AccountStatus" NOT NULL DEFAULT 'Active';

CREATE INDEX "users_account_status_idx" ON "users"("account_status");
