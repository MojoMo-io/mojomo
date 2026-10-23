-- Sprint 11.4 — MOJO payouts and the wallet that will hold them.
--
-- mojomo.payouts already exists and is in use by the avatar payout flow
-- (conversation_id, avatar_id, token_amount, status). This extends it rather
-- than replacing it: the existing flow keeps working, and the new columns carry
-- what on-chain settlement will need at go-live.
--
-- Until the project moves from MVP to live, nothing moves on-chain. The ledger
-- is the source of truth and the wallet is a staging area.
--
-- The chain is configuration, not code. MOJO is on Polygon today; the same
-- service must point at Ethereum by changing env, not by changing logic.

ALTER TABLE mojomo.payouts ADD COLUMN IF NOT EXISTS chain text;
ALTER TABLE mojomo.payouts ADD COLUMN IF NOT EXISTS token_symbol text NOT NULL DEFAULT 'MOJO';
ALTER TABLE mojomo.payouts ADD COLUMN IF NOT EXISTS recipient_address text;
ALTER TABLE mojomo.payouts ADD COLUMN IF NOT EXISTS tx_hash text;
ALTER TABLE mojomo.payouts ADD COLUMN IF NOT EXISTS settled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_payouts_tx ON mojomo.payouts (tx_hash) WHERE tx_hash IS NOT NULL;

COMMENT ON COLUMN mojomo.payouts.chain IS 'polygon | ethereum. NULL until settlement is attempted.';
COMMENT ON COLUMN mojomo.payouts.tx_hash IS 'Set only when settled on-chain. NULL means ledger-only (MVP).';

-- The float: MOJO held in a wallet the system controls, drawn down by payouts.
CREATE TABLE IF NOT EXISTS mojomo.payout_float (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain          text NOT NULL,
  token_symbol   text NOT NULL DEFAULT 'MOJO',
  wallet_address text NOT NULL,
  balance        numeric(30,8) NOT NULL DEFAULT 0,
  is_test_float  boolean NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_float_chain_valid CHECK (chain IN ('polygon','ethereum')),
  CONSTRAINT payout_float_balance_nonneg CHECK (balance >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_float_chain_addr
  ON mojomo.payout_float (chain, wallet_address);

COMMENT ON TABLE mojomo.payout_float IS
  'MOJO float per chain. is_test_float=true means test tokens, not real value.';
