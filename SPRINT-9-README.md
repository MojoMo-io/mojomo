# Sprint 9: Message Enhancement & Routing

**Phase:** 2  
**Duration:** 1 week (2026-09-11 to 2026-09-17)  
**Status:** ✅ COMPLETE (verified live 2026-10-23)

---

## Objectives

Route messages through the model for automatic reasoning, idea scoring, and response generation. Enhance message endpoint to integrate with Sprint 8's reasoning infrastructure.

**User Story:** When I send a message in a conversation, the model automatically analyses it, scores ideas, and suggests next steps - all asynchronously without blocking the user.

---

## Acceptance Criteria

✅ **Message Enhancement**
- [ ] POST /conversations/:id/messages routes to model reasoning
- [ ] Message classification (user_message vs ai_response)
- [ ] Automatic idea scoring (model-based, not just heuristic)
- [ ] Context window management (summarize old messages if >4k tokens)
- [ ] Prompt injection prevention (sanitize user input)

✅ **Async Processing**
- [ ] Queue message for model processing
- [ ] Return immediately (non-blocking)
- [ ] Background worker processes messages
- [ ] Retry failed message processing
- [ ] Update message with model response

✅ **Idea Extraction**
- [ ] Extract ideas from model responses
- [ ] Store extracted ideas in idea_repository
- [ ] Score ideas (0.0-1.0 confidence)
- [ ] Link ideas to conversation

✅ **Testing**
- [ ] Unit: Message routing logic
- [ ] Unit: Idea extraction
- [ ] Integration: Full message → the model → idea flow
- [ ] Integration: Async job processing
- [ ] Load: 100 concurrent messages

---

## Implementation Plan

### Part 1: Message Enhancement (Day 1-2)

**Modify POST /conversations/:id/messages:**


### Part 2: the model Integration (Day 2-3)

**Background Worker Enhancement:**
- Process message queues
- Build prompt with message context
- Call the model for analysis
- Extract ideas from response
- Store results

### Part 3: Testing (Day 4-5)

**Test Coverage:**
- Message validation
- Idea extraction accuracy
- Concurrent message processing
- Error recovery
- Performance under load

---

## Files to Create/Modify

### Modified
-  - Add the model routing
-  - Add idea extraction
-  - Add message processing

### New
-  - Unit tests
-  - Integration tests

---

## Database Changes

Add to message_queue processing:
- message_id references
- result storage (the model response + ideas)
- retry logic

---

## Tokenomics Impact

This sprint doesn't change tokenomics - it enhances the messaging layer to feed data into Sprint 10 (quality validation) and beyond.

---

## Success Criteria

- ✅ 25+ new tests passing
- ✅ Zero Phase 1 regressions
- ✅ Message processing latency <100ms
- ✅ the model reasoning triggered automatically
- ✅ Ideas extracted and scored
- ✅ No data loss on errors

---

**Sprint Owner:** the model Haiku 4.5  
**Start Date:** 2026-09-11  
**Target Completion:** 2026-09-17
