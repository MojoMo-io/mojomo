# Sprint 12: Forfeiture & End-to-End

**Phase:** 2  
**Duration:** 1 week (2026-10-02 to 2026-10-08)  
**Status:** 🚀 STARTING

## Objectives

Implement conversation end logic, forfeiture calculation, and full end-to-end test suite.

## Key Features

✅ End Conversation
- POST /conversations/:id/end endpoint
- Calculate forfeitures based on vesting status
- Return locked tokens to pool
- Mark conversation as ended

✅ Forfeiture Status Preview
- GET /conversations/:id/forfeiture-status
- Show what would be forfeited if ended now
- Preview per-avatar forfeiture
- Show final payouts

✅ Auto-End Dormant Conversations
- checkAndEndDormantConversations() background job
- 90-day inactivity threshold
- Automatic forfeiture on expiry

✅ Full E2E Test Suite
- Create avatars → Create conversation
- Send messages with ideas
- Specialist joins with dilution
- Vesting over time
- End conversation with forfeiture
- Verify final balances

## Acceptance Criteria

- [ ] End conversation endpoint
- [ ] Forfeiture status preview
- [ ] Auto-end dormant conversations
- [ ] 15+ E2E tests
- [ ] 100+ total tests for Phase 2
- [ ] All Phase 1 tests still passing

## Definition of Done

- ✅ Forfeiture calculation implemented
- ✅ End conversation flow implemented
- ✅ 15+ E2E tests passing
- ✅ No regressions in Phase 1

