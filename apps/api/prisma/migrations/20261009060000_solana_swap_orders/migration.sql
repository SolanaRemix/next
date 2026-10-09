CREATE TABLE "solana_swap_orders" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(36) NOT NULL,
  "request_id" VARCHAR(128) NOT NULL,
  "taker" VARCHAR(44) NOT NULL,
  "input_mint" VARCHAR(44) NOT NULL,
  "output_mint" VARCHAR(44) NOT NULL,
  "input_amount" VARCHAR(20) NOT NULL,
  "order_payload" JSONB NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "execution_key" VARCHAR(36),
  "execution_status" VARCHAR(12) NOT NULL DEFAULT 'ORDERED',
  "transaction_signature" VARCHAR(88),
  "execution_result" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "solana_swap_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "solana_swap_orders_execution_status_check"
    CHECK ("execution_status" IN ('ORDERED', 'EXECUTING', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT "solana_swap_orders_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "solana_swap_orders_request_id_key" ON "solana_swap_orders"("request_id");
CREATE UNIQUE INDEX "solana_swap_orders_user_id_idempotency_key_key"
  ON "solana_swap_orders"("user_id", "idempotency_key");
CREATE UNIQUE INDEX "solana_swap_orders_user_id_execution_key_key"
  ON "solana_swap_orders"("user_id", "execution_key");
CREATE INDEX "solana_swap_orders_user_id_created_at_idx"
  ON "solana_swap_orders"("user_id", "created_at");
CREATE INDEX "solana_swap_orders_expires_at_idx" ON "solana_swap_orders"("expires_at");
