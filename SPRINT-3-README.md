# MOJOMO Sprint 3: Vesting, Payouts & Token Withdrawal

**Status:** ✅ COMPLETE (2026-09-02)
**Tests:** 62/62 passing (44 from Sprints 1-2 + 18 new vesting/payout tests)

## Completed Tasks

### Task 3.1: Vesting Calculation ✅

**Enhanced calculateAvatarOwnershipAtTime():**
- Takes optional timestamp parameter (default NOW())
- Calculates linear 30-day vesting from conversation creation
- Returns: vested_pct, available_tokens, locked_tokens, vesting_end_date

**Vesting Timeline:**
- Day 0: 0% vested, 0% available, 100% locked
- Day 15: 50% vested, 50% available, 50% locked
- Day 30: 100% vested, 100% available, 0% locked
- Day 30+: 100% vested, 100% available, 0% locked

**Endpoint:**
- `GET /conversations/:id/avatars/:avatar_id/vesting` - Get vesting status
  - Returns: total_tokens, vested_pct, available_tokens, locked_tokens
  - Shows vesting_end_date and days_remaining
  - Works for genesis tokens and specialist tokens equally

**Test Coverage (8 tests):**
- ✅ 0% vested at day 0
- ✅ 50% vested at day 15
- ✅ 100% vested at day 30+
- ✅ Linear progression (day 10: 33.33%, day 20: 66.67%)
- ✅ Scales proportionally with token amount (1 to 1M tokens)
- ✅ Preserves total tokens (available + locked = total)

### Task 3.2: Payout Validation ✅

**validatePayoutRequest():**
- Checks: requested_amount > 0
- Checks: requested_amount ≤ available_tokens
- Returns: { valid: boolean, error?: string }
- Error message includes: available, locked, vesting_end_date

**Validation Rules:**
- Cannot withdraw 0 or negative
- Cannot withdraw more than available (locked tokens protected)
- Cannot withdraw locked tokens
- Clear error messages for debugging

**Test Coverage (8 tests):**
- ✅ Rejects 0 or negative amounts
- ✅ Rejects locked tokens at day 0 (all locked)
- ✅ Allows vested tokens at day 15 (50% available)
- ✅ Rejects amounts exceeding available
- ✅ Allows full withdrawal at day 30
- ✅ Allows partial withdrawal within available
- ✅ Error messages include available, locked, dates
- ✅ Works for specialist tokens (diluted amounts)

### Task 3.3: Payout Initiation Endpoint ✅

**Endpoint:**
- `POST /payouts/initiate` - Initiate payout
  - Request: { avatar_id, conversation_id, token_amount, payment_method? }
  - Validates ownership (avatar exists)
  - Calls validatePayoutRequest()
  - Returns 400 if invalid, 201 if success
  - Returns: { payout_id, status: 'pending', avatar_id, amount }

**Payout Flow:**
1. Validate amount (positive)
2. Get current vesting status
3. Verify available tokens ≥ requested
4. Create payout record (status: 'pending')
5. Log to token_ledger with event_type: 'payout_initiated'
6. Log to conversation_events for audit trail
7. Return payout_id

**Race Condition Protection:**
- Re-validates within transaction before creating payout
- Detects if vesting changed between validation and execution
- Returns 400 if tokens changed (race condition)

**Additional Endpoints:**
- `GET /payouts/:id` - Get payout details
- `GET /conversations/:id/payouts` - List payouts with pagination

**Test Coverage (2 specialist scenarios):**
- ✅ S1 (15% allocation) vesting: available at day 15
- ✅ S5 (smaller allocation) vesting: correctly scaled

## Architecture

**Service: src/services/payouts.ts**
- `validatePayoutRequest()` - Validation logic
- `getVestingStatus()` - Get vesting at NOW()
- `initiatePayout()` - Create payout with transaction
- `getPayout()` - Retrieve payout
- `listPayouts()` - List with pagination

**Routes: src/routes/payouts.ts**
- `GET /api/conversations/:id/avatars/:avatar_id/vesting`
- `POST /api/payouts/initiate`
- `GET /api/payouts/:id`
- `GET /api/conversations/:id/payouts`

## Database Impact

**No New Tables** (uses existing payouts table)

**Updates:**
- `payouts` table: new rows for initiated payouts (status: 'pending')
- `token_ledger`: new 'payout_initiated' events with vesting details
- `conversation_events`: new 'payout_initiated' events for audit

**Transactions:**
- `initiatePayout()` uses transaction wrapper
- Re-validates vesting before commit
- Atomic: either full success or full rollback

## Build & Test

```bash
npm run build          # Compiles without errors
npm test               # 62 tests pass (18 new vesting/payout tests)
```

## Vesting Logic (Proven)

**All tokens vest linearly over 30 days:**
```
Genesis tokens (A: 500): Vest from day 0 to day 30
Specialist tokens (S1: 150): Vest from day 0 to day 30

Day 0:  A vested=0, S1 vested=0 → available_A=0, available_S1=0
Day 15: A vested=250, S1 vested=75 → available_A=250, available_S1=75
Day 30: A vested=500, S1 vested=150 → available_A=500, available_S1=150
```

**Properties:**
- Linear interpolation between day 0 and day 30
- No special cases (same logic for all avatar types)
- Protected: locked tokens cannot be withdrawn
- Validated at transaction boundary

## What Works

✅ Vesting calculation (30-day linear)
✅ Available vs locked token distinction
✅ Payout validation (checks available)
✅ Prevents withdrawal of locked tokens
✅ Payout initiation with atomicity
✅ Event logging for audit trail
✅ All 62 tests passing
✅ No TypeScript errors
✅ Builds successfully

## What's Next (Sprint 4)

Messaging & Telegram Notifications:
- Message storage with idea_score
- AI response processing
- Telegram notifications to verified chats
- Conversation message history with pagination

## Key Insights

**Vesting applies to all tokens equally:**
- Genesis tokens and specialist tokens vest together
- Same 30-day period from conversation creation
- Same vesting percentage for both types
- This creates fairness: later joiners don't get different terms

**Locked tokens are permanently unwithdrawable:**
- No recovery if conversation ends early
- Incentivizes commitment
- Clear forfeiture rules (defined in later sprints)

## Git Commit

```
d028699 Sprint 2: Specialist join with dilution
[NEW]   Sprint 3: Vesting, payouts & withdrawal
```

