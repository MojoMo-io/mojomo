-- MOJOMO Database Schema
-- Avatar platform with shared token conversations, vesting, and idea extraction

BEGIN;

CREATE SCHEMA IF NOT EXISTS mojomo;
SET search_path TO mojomo;

-- Avatars: user profiles/identities
CREATE TABLE avatars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  bio TEXT,
  avatar_type VARCHAR(50) NOT NULL DEFAULT 'individual', -- individual, specialist, collective
  telegram_chat_id BIGINT UNIQUE,
  telegram_verified_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_avatars_user_id ON avatars(user_id);
CREATE INDEX idx_avatars_telegram_chat_id ON avatars(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

-- Conversations: shared token pools between avatars
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_avatar_id UUID NOT NULL REFERENCES avatars(id) ON DELETE CASCADE,
  target_avatar_id UUID NOT NULL REFERENCES avatars(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  total_tokens NUMERIC(20, 2) NOT NULL,
  ownership_ledger JSONB NOT NULL, -- {"avatar_id": {"ownership_pct": 50.0, "token_balance": 500, "vested_pct": 0, "buy_in_amount": 0, "join_round": 0}}
  participant_avatar_ids UUID[] NOT NULL DEFAULT '{}',
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, ended
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMP,
  ended_at TIMESTAMP
);

CREATE INDEX idx_conversations_initiator ON conversations(initiator_avatar_id);
CREATE INDEX idx_conversations_target ON conversations(target_avatar_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_created ON conversations(created_at DESC);

-- Note: ownership_ledger validation is enforced at application level
-- (PostgreSQL check constraints cannot use subqueries)

-- Conversation messages: all messages in a conversation
CREATE TABLE conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  avatar_id UUID NOT NULL REFERENCES avatars(id) ON DELETE CASCADE,
  message_content TEXT NOT NULL,
  message_type VARCHAR(50) NOT NULL, -- user_message, ai_response
  reasoning_trace JSONB, -- for AI responses, stores reasoning
  idea_score NUMERIC(5, 2), -- 0-100, confidence that message contains an idea
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversation_messages_conversation ON conversation_messages(conversation_id);
CREATE INDEX idx_conversation_messages_avatar ON conversation_messages(avatar_id);
CREATE INDEX idx_conversation_messages_created ON conversation_messages(created_at DESC);

-- Token ledger: append-only log of all token movements
CREATE TABLE token_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  avatar_id UUID NOT NULL REFERENCES avatars(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL, -- genesis, join_redistribution, payout_initiated, forfeiture, etc.
  token_amount NUMERIC(20, 2),
  previous_ownership_pct NUMERIC(6, 2),
  new_ownership_pct NUMERIC(6, 2),
  join_round INTEGER,
  event_data JSONB, -- flexible field for event-specific data
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_token_ledger_conversation ON token_ledger(conversation_id);
CREATE INDEX idx_token_ledger_avatar ON token_ledger(avatar_id);
CREATE INDEX idx_token_ledger_event_type ON token_ledger(event_type);
CREATE INDEX idx_token_ledger_created ON token_ledger(created_at DESC);

-- Conversation events: audit trail of conversation lifecycle events
CREATE TABLE conversation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL, -- created, specialist_joined, message_added, conversation_ended, conversation_forfeited, etc.
  event_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversation_events_conversation ON conversation_events(conversation_id);
CREATE INDEX idx_conversation_events_type ON conversation_events(event_type);
CREATE INDEX idx_conversation_events_created ON conversation_events(created_at DESC);

-- Idea repository: ideas extracted from conversations
CREATE TABLE idea_repository (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  full_hypothesis TEXT NOT NULL,
  extracted_by_avatar_id UUID NOT NULL REFERENCES avatars(id) ON DELETE CASCADE,
  extracted_from_message_id UUID REFERENCES conversation_messages(id) ON DELETE SET NULL,
  maturity_stage VARCHAR(50) NOT NULL DEFAULT 'seedling', -- seedling, exploring, refined, mature
  confidence_score NUMERIC(5, 2), -- 0-100
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_idea_repository_conversation ON idea_repository(conversation_id);
CREATE INDEX idx_idea_repository_extracted_by ON idea_repository(extracted_by_avatar_id);
CREATE INDEX idx_idea_repository_message ON idea_repository(extracted_from_message_id);
CREATE UNIQUE INDEX idx_idea_repository_message_unique ON idea_repository(extracted_from_message_id) WHERE extracted_from_message_id IS NOT NULL;
CREATE INDEX idx_idea_repository_maturity ON idea_repository(maturity_stage);

-- Payouts: record of token withdrawals
CREATE TABLE payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  avatar_id UUID NOT NULL REFERENCES avatars(id) ON DELETE CASCADE,
  token_amount NUMERIC(20, 2) NOT NULL,
  payment_method VARCHAR(100), -- later: crypto wallet, bank transfer, etc.
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, completed, failed
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX idx_payouts_conversation ON payouts(conversation_id);
CREATE INDEX idx_payouts_avatar ON payouts(avatar_id);
CREATE INDEX idx_payouts_status ON payouts(status);

COMMIT;
