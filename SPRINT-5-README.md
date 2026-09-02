# MOJOMO Sprint 5: Idea Extraction & Repository

**Status:** ✅ COMPLETE (2026-09-02)
**Tests:** 115/115 passing (86 from Sprints 1-4 + 29 new idea tests)

## Completed Tasks

### Task 5.1: Idea Extraction on Message Store ✅

**Automatic Extraction:**
- `extractIdeaFromMessage()` - Extract from high-scoring messages
  - Only called if idea_score > 0.65 (threshold)
  - Looks for "IDEA:" marker in message
  - Falls back to full message text if no marker
  - Caps hypothesis at 10,000 chars
  - Creates title (first line, max 255 chars)

**Extraction Process:**
1. Message stored with idea_score
2. If idea_score > 0.65, trigger extraction (async)
3. Extract hypothesis and title
4. Insert to idea_repository (ON CONFLICT prevents duplicates)
5. Store maturity_stage = 'seedling'
6. Set confidence_score = idea_score

**Duplicate Prevention:**
- ON CONFLICT (extracted_from_message_id) DO NOTHING
- Only one idea per message
- Extraction failure logged, doesn't fail message

**Test Coverage (8 tests):**
- ✅ Extract if score > 0.65
- ✅ Skip if score ≤ 0.65
- ✅ "IDEA:" marker detection
- ✅ Fallback to full text
- ✅ Title extraction (first line)
- ✅ Hypothesis capping (10k chars)
- ✅ Duplicate prevention
- ✅ Extraction failure graceful

### Task 5.2: Idea Repository API ✅

**Endpoints:**
- `GET /conversations/:id/ideas` - List ideas
  - Pagination: limit (default 50, max 100), offset
  - Ordered by confidence_score DESC
  - Returns: id, title, maturity_stage, confidence_score, extracted_by_avatar_id

- `GET /conversations/:id/ideas/:idea_id` - Get full idea
  - Returns: full_hypothesis, extracted_from_message_id, message_content
  - Links back to original message

- `PATCH /conversations/:id/ideas/:idea_id` - Update maturity
  - Validates forward-only progression
  - seedling → exploring → refined → mature
  - Cannot move backward
  - Returns updated idea

- `GET /conversations/:id/ideas-by-maturity/:stage` - Filter by stage
  - List all ideas at specific maturity
  - Ordered by confidence DESC
  - Limits 50, max 100

**Test Coverage (8 tests):**
- ✅ List ideas from conversation
- ✅ Order by confidence descending
- ✅ Get single idea with message
- ✅ Update maturity stage
- ✅ Prevent backward progression
- ✅ Allow forward progression
- ✅ Filter by maturity stage
- ✅ Store extracted_by_avatar_id

### Task 5.3: Integration Ready ✅

**Idea Progression Pipeline:**
1. Message stored with idea_score
2. If score > 0.65: auto-extract
3. Idea starts at 'seedling' stage
4. User can view ideas via GET /ideas
5. User can promote via PATCH to exploring/refined/mature
6. Ideas ordered by confidence for discovery

**Extraction Semantics:**
- Threshold: >0.65 (empirically validated from Sprint 4 scoring)
- Source: extracted_from_message_id (links to original message)
- Confidence: idea_score (0-100 from message scoring)
- Maturity: starts at seedling, user-updatable

**Test Coverage (13 tests):**
- ✅ Threshold validation (0.65 boundary)
- ✅ Hypothesis extraction methods
- ✅ Title extraction (first line)
- ✅ Maturity progression rules
- ✅ Ordering by confidence
- ✅ Duplicate handling
- ✅ Edge cases (empty text, multiple markers, etc.)

## Architecture

**Service: src/services/ideas.ts**
- `extractIdeaFromMessage()` - Auto-extract on high score
- `getIdea()` - Retrieve by ID
- `listIdeas()` - List with pagination
- `listIdeasByMaturity()` - Filter by stage
- `updateIdeaMaturity()` - Promote/demote with validation
- `getIdeaWithMessage()` - Get with message content

**Routes: src/routes/ideas.ts**
- `GET /api/conversations/:id/ideas`
- `GET /api/conversations/:id/ideas/:idea_id`
- `PATCH /api/conversations/:id/ideas/:idea_id`
- `GET /api/conversations/:id/ideas-by-maturity/:stage`

**Extraction Hook:**
- Called after message stored (if idea_score > 0.65)
- Async, non-blocking
- Failure logged only

## Database Impact

**New Data:**
- `idea_repository` table entries
- Linked to conversation, message, avatar

**Schema:**
- idea_repository table (already exists from Sprint 0)
- ON CONFLICT (extracted_from_message_id) for deduplication

## Build & Test

```bash
npm run build          # Compiles without errors
npm test               # 115 tests pass (29 new idea tests)
```

## Idea Lifecycle

**Creation:**
- Extracted from high-confidence message (>0.65 score)
- Stored as 'seedling' stage
- Linked to message and avatar

**Evolution:**
- seedling (new, unvetted)
- exploring (being explored)
- refined (refined hypothesis)
- mature (validated/final)

**Properties:**
- Immutable: conversation_id, extracted_from_message_id, created_at
- Mutable: maturity_stage, updated_at (can update once per stage)

## What Works

✅ Automatic idea extraction from high-scoring messages
✅ Hypothesis and title extraction
✅ Idea repository storage
✅ Pagination and filtering
✅ Maturity stage progression (forward-only)
✅ Linking ideas to original messages
✅ Duplicate prevention
✅ All 115 tests passing
✅ No TypeScript errors
✅ Builds successfully

## What's Next (Sprint 6)

Forfeiture, Edge Cases & End-to-End Testing:
- Conversation end with forfeiture logic
- Dormancy check (90-day auto-end)
- Edge case testing
- End-to-end workflow scenarios

## Key Insights

**Extraction is Non-Critical:**
- Failures logged but don't block messages
- Threshold (>0.65) validated from Sprint 4 scoring
- Deduplication automatic via ON CONFLICT

**Maturity is One-Way:**
- Ideas progress but never regress
- Validates stage order (seedling < exploring < refined < mature)
- Future: add timestamps for when stage changed

**Confidence = Idea Score:**
- Immutable: set when extracted
- Ordered by this for discovery
- Guides user on quality of hypothesis

## Git Commit

```
52a60a1 Sprint 4: Telegram notifications and messaging
[NEW]   Sprint 5: Idea extraction and repository
```

