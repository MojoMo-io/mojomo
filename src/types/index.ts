// Type definitions for MOJOMO

export interface PersonalityProfile {
  interests: string[];
  specialisms: string[];
  values: string[];
  communication_style: string;
  /** Compact paragraph usable directly as (part of) the avatar's system prompt. */
  summary: string;
}

export interface Avatar {
  id: string;
  user_id: string;
  name: string;
  bio?: string;
  avatar_type: 'individual' | 'specialist' | 'collective';
  telegram_chat_id?: number;
  telegram_verified_at?: Date;
  is_npc: boolean;
  is_support: boolean;
  system_prompt?: string;
  personality_profile?: PersonalityProfile;
  created_at: Date;
  updated_at: Date;
}

export interface AvatarDirectMessage {
  id: string;
  avatar_id: string;
  role: 'human' | 'avatar';
  content: string;
  source: 'web' | 'telegram';
  created_at: Date;
}

export interface AvatarHint {
  id: string;
  avatar_id: string;
  suggested_avatar_id: string;
  reason: string;
  status: 'pending' | 'accepted' | 'dismissed';
  created_at: Date;
}

export interface OwnershipEntry {
  ownership_pct: number;
  token_balance: number;
  vested_pct: number;
  buy_in_amount: number;
  join_round?: number;
}

export interface OwnershipLedger {
  [avatar_id: string]: OwnershipEntry;
}

export interface Conversation {
  id: string;
  initiator_avatar_id: string;
  target_avatar_id: string;
  title: string;
  description?: string;
  total_tokens: number;
  ownership_ledger: OwnershipLedger;
  participant_avatar_ids: string[];
  status: 'active' | 'ended';
  created_at: Date;
  updated_at: Date;
  last_message_at?: Date;
  ended_at?: Date;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  avatar_id: string;
  message_content: string;
  message_type: 'user_message' | 'ai_response' | 'avatar_message';
  reasoning_trace?: Record<string, any>;
  idea_score?: number;
  created_at: Date;
}

export interface TokenLedgerEvent {
  id: string;
  conversation_id: string;
  avatar_id: string;
  event_type: string;
  token_amount?: number;
  previous_ownership_pct?: number;
  new_ownership_pct?: number;
  join_round?: number;
  event_data?: Record<string, any>;
  created_at: Date;
}

export interface ConversationEvent {
  id: string;
  conversation_id: string;
  event_type: string;
  event_data?: Record<string, any>;
  created_at: Date;
}

export interface IdeaRepository {
  id: string;
  conversation_id: string;
  title: string;
  full_hypothesis: string;
  extracted_by_avatar_id: string;
  extracted_from_message_id?: string;
  maturity_stage: 'seedling' | 'exploring' | 'refined' | 'mature';
  confidence_score?: number;
  refinement_count: number;
  surfaced_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface IdeaRefinement {
  id: string;
  idea_id: string;
  avatar_id: string;
  previous_hypothesis: string;
  new_hypothesis: string;
  note?: string;
  confidence_score?: number;
  created_at: Date;
}

export interface Payout {
  id: string;
  conversation_id: string;
  avatar_id: string;
  token_amount: number;
  payment_method?: string;
  status: 'pending' | 'completed' | 'failed';
  created_at: Date;
  updated_at: Date;
  completed_at?: Date;
}

export interface AvatarOwnershipAtTime {
  avatar_id: string;
  total_token_amount: number;
  genesis_or_bought: 'genesis' | 'bought';
  allocated_at: Date;
  vesting_start_date: Date;
  vesting_end_date: Date;
  days_elapsed: number;
  vested_pct: number;
  available_tokens: number;
  locked_tokens: number;
  ownership_pct: number;
  total_buy_in_tokens: number;
  /** Sum of pending/completed payouts already taken; available_tokens is net of this */
  paid_out_tokens?: number;
}

export interface CreateAvatarPayload {
  name: string;
  bio?: string;
  avatar_type?: 'individual' | 'specialist' | 'collective';
  telegram_chat_id?: string;
}

export interface UpdateAvatarTelegramPayload {
  telegram_chat_id: string;
}

export interface CreateConversationPayload {
  initiator_avatar_id: string;
  target_avatar_id: string;
  title: string;
  description?: string;
  total_tokens: number;
}

export interface ValidatePayoutResult {
  valid: boolean;
  error?: string;
}

export interface SpecialistJoinResult {
  specialist_avatar_id: string;
  allocated_tokens: number;
  allocated_pct: number;
  join_round: number;
  new_ownership_ledger: OwnershipLedger;
}
