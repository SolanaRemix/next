CREATE TABLE "evm_swap_orders" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(36) NOT NULL,
  "chain_id" INTEGER NOT NULL,
  "taker" VARCHAR(42) NOT NULL,
  "sell_token" VARCHAR(42) NOT NULL,
  "buy_token" VARCHAR(42) NOT NULL,
  "sell_amount" VARCHAR(78) NOT NULL,
  "buy_amount" VARCHAR(78) NOT NULL,
  "minimum_buy_amount" VARCHAR(78) NOT NULL,
  "allowance_spender" VARCHAR(42) NOT NULL,
  "transaction_to" VARCHAR(42) NOT NULL,
  "transaction_data" TEXT NOT NULL,
  "transaction_value" VARCHAR(78) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "execution_status" VARCHAR(12) NOT NULL DEFAULT 'ORDERED',
  "transaction_hash" CHAR(66),
  "execution_result" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "evm_swap_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "evm_swap_orders_execution_status_check"
    CHECK ("execution_status" IN ('ORDERED', 'SUBMITTED', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT "evm_swap_orders_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "evm_swap_orders_user_id_idempotency_key_key"
  ON "evm_swap_orders"("user_id", "idempotency_key");
CREATE INDEX "evm_swap_orders_user_id_created_at_idx"
  ON "evm_swap_orders"("user_id", "created_at");
CREATE INDEX "evm_swap_orders_execution_status_expires_at_idx"
  ON "evm_swap_orders"("execution_status", "expires_at");
