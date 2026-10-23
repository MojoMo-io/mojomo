-- Sprint 10 — user wallet addresses.
--
-- The gap this closes: mojomo.payouts.recipient_address exists, but nothing in the
-- schema records where a *user* wants to be paid. Settlement had no way to resolve
-- an avatar to an address, so on-chain payouts could never be addressed.
--
-- Design notes:
--
--   1. One address per user, per chain. A user may want to be paid on Polygon today
--      and Ethereum later, so this is a table rather than a column on users.
--   2. Addresses are stored lowercased. EIP-55 checksums are a display concern; storing
--      mixed case invites duplicate rows that differ only by case.
--   3. A user may have at most one *default* address per chain. Enforced by a partial
--      unique index rather than application logic.
--   4. Nothing here moves money. This is a record of intent, editable by the user.

CREATE TABLE IF NOT EXISTS mojomo.user_wallets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES mojomo.users(id) ON DELETE CASCADE,
  chain       text NOT NULL,
  address     text NOT NULL,
  label       text,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_wallets_chain_valid CHECK (chain IN ('polygon','ethereum')),
  CONSTRAINT user_wallets_address_lower CHECK (address = lower(address)),
  CONSTRAINT user_wallets_address_shape CHECK (address ~ '^0x[0-9a-f]{40}$')
);

-- One row per (user, chain, address).
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_wallets_unique
  ON mojomo.user_wallets (user_id, chain, address);

-- At most one default per (user, chain).
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_wallets_one_default
  ON mojomo.user_wallets (user_id, chain) WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_user_wallets_user ON mojomo.user_wallets (user_id);

COMMENT ON TABLE mojomo.user_wallets IS
  'Where a user wants to be paid. Record of intent only; settlement reads is_default.';
COMMENT ON COLUMN mojomo.user_wallets.address IS
  'Lowercased 0x-prefixed EVM address. Checksum casing is a display concern.';
