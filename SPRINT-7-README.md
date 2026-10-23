# Sprint 7: Conversation Creation & Genesis Allocation

**Phase:** 2  
**Duration:** 3-4 days  
**Start Date:** 2026-09-03  
**Status:** ✅ COMPLETE (verified live 2026-10-23)

---

## Objectives

Implement the foundational conversation endpoint and genesis token allocation logic. This sprint establishes the 50/50 token split mechanism that all future conversation dynamics depend on.

**User Story:** As an avatar owner, I can initiate a conversation with another avatar, defining a shared token pool with 50/50 genesis ownership.

---

## Acceptance Criteria

✅ **Endpoint Implementation**
- [x] POST /conversations endpoint accepts and validates input
- [x] Creates conversation record with genesis ownership ledger
- [x] Generates conversation_id and timestamps
- [ ] Returns full conversation object with ownership breakdown

✅ **Genesis Allocation**
- [x] allocateGenesisTokens() splits tokens 50/50
- [x] Ownership ledger structure validates
- [ ] Token counts sum exactly to total_tokens

✅ **Data Retrieval**
- [ ] GET /conversations/:id returns conversation with current ownership
- [ ] GET /conversations (list all for avatar)
- [ ] Properly formats ownership ledger for client

✅ **Ownership Calculations**
- [ ] calculateAvatarOwnershipAtTime() works for genesis (day 0)
- [ ] Handles vesting state (all 0% on day 0)
- [ ] Prepared for future vesting logic

✅ **Testing**
- [ ] Unit tests for allocateGenesisTokens()
- [ ] Integration tests for createConversation()
- [ ] Ownership sum validation (must equal 100% ±0.1%)
- [ ] Edge cases: zero tokens, invalid avatars, same avatar
- [ ] Database transaction rollback scenarios

---

## Key Implementation Points

### Database Model
- Table: `mojomo.conversations`
  - Columns: id, initiator_avatar_id, target_avatar_id, title, description, total_tokens, ownership_ledger (JSONB), created_at, ended_at
  - Ownership ledger is JSONB with avatar_id → { ownership_pct, token_balance, vested_pct, buy_in_amount, join_round }

- Table: `mojomo.conversation_events`
  - Audit trail: event_type, conversation_id, actor_id, payload, created_at

### Tokenomics
- **Genesis Formula:** 50% tokens to initiator, 50% to target
- **Ownership %:** Same as token %, always sums to 100%
- **Vesting:** 0% on day 0, increases linearly to 100% by day 30
- **Constraint:** `sum(ownership_pct) === 100.0` (within ±0.1% tolerance)

### Transaction Safety
- Use `db.withTransaction()` wrapper
- Advisory lock for conversation creation if concurrent initiations possible
- Rollback both conversation + events if error occurs

### Event Logging
- Log conversation_created to conversation_events
- Payload: { initiator_id, target_id, total_tokens }
- Enables audit + replay

---

## Files Modified This Sprint

### Routes
- `src/routes/conversations.ts`
  - Complete POST /conversations
  - Add GET /conversations/:id
  - Add GET /conversations (with filtering)

### Services
- `src/services/conversations.ts`
  - Complete createConversation()
  - Implement calculateAvatarOwnershipAtTime()
  - Add getConversation(), listConversations()

### Tests
- `tests/unit/sprint7.test.ts` (new)
  - allocateGenesisTokens() edge cases
  - createConversation() validation
  - Ownership invariants
  - Transaction rollback

---

## Definition of Done

- [ ] All Sprint 7 tests passing (32+ tests)
- [ ] Code review: no security issues, proper error handling
- [ ] Database migrations applied
- [ ] Endpoint documentation updated in docs/
- [ ] Tested with Postman or curl (manual smoke test)
- [ ] Branch pushed and ready for review
- [ ] Ready for merge to master

---

**Sprint Owner:** MOJOMO
**Last Updated:** 2026-09-03
