# Sprint 11: Idea Extraction & Repository

**Phase:** 2  
**Duration:** 1 week (2026-09-25 to 2026-10-01)  
**Status:** 🚀 STARTING

## Objectives

Build persistent idea repository with maturity progression and auto-extraction from conversations.

## Key Features

✅ Auto-Extraction from Messages
- Extract from messages with score > 0.65
- IDEA: marker with high confidence (0.9)
- Fallback to full text analysis
- Extract up to 3 ideas per message

✅ Idea Title Generation
- Clean text, trim to 255 characters
- Preserve key phrases
- Remove redundant words

✅ Hypothesis Storage
- Cap at 10k characters
- Preserve context from conversation
- Link to source message

✅ Maturity Stages
- seedling → exploring → refined → mature
- Forward-only progression
- PATCH /ideas/:id endpoint for advancement

✅ Idea Repository
- GET /ideas (list all with filtering)
- GET /ideas/:id (retrieve with full history)
- PATCH /ideas/:id (update maturity only)

## Acceptance Criteria

- [ ] Extract ideas from messages automatically
- [ ] Store in idea_repository table
- [ ] Support maturity progression
- [ ] Auto-score and extract from messaging
- [ ] 18+ idea extraction tests
- [ ] All Phase 1 tests still passing

## Definition of Done

- ✅ Idea extraction service implemented
- ✅ Repository endpoints implemented
- ✅ 18+ tests passing
- ✅ No regressions in Phase 1

