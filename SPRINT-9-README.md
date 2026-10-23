# Sprint 9: Message Enhancement & Routing
> **Historical record.** This sprint was completed against the Anthropic/Claude API.
> Anthropic was retired on 2026-10-21; all model calls now route through DeepSeek via
> `src/services/llm.ts`. References to Claude below describe what was built at the time,
> not current architecture.


**Phase:** 2  
**Duration:** 1 week (2026-09-11 to 2026-09-17)  
**Status:** ✅ COMPLETE (verified live 2026-10-23)

---

## Objectives

Route messages through Claude for automatic reasoning, idea scoring, and response generation. Enhance message endpoint to integrate with Sprint 8's reasoning infrastructure.

**User Story:** When I send a message in a conversation, Claude automatically analyzes it, scores ideas, and suggests next steps - all asynchronously without blocking the user.

---

## Acceptance Criteria

✅ **Message Enhancement**
- [ ] POST /conversations/:id/messages routes to Claude reasoning
- [ ] Message classification (user_message vs ai_response)
- [ ] Automatic idea scoring (Claude-based, not just heuristic)
- [ ] Context window management (summarize old messages if >4k tokens)
- [ ] Prompt injection prevention (sanitize user input)

✅ **Async Processing**
- [ ] Queue message for Claude processing
- [ ] Return immediately (non-blocking)
- [ ] Background worker processes messages
- [ ] Retry failed message processing
- [ ] Update message with Claude response

✅ **Idea Extraction**
- [ ] Extract ideas from Claude responses
- [ ] Store extracted ideas in idea_repository
- [ ] Score ideas (0.0-1.0 confidence)
- [ ] Link ideas to conversation

✅ **Testing**
- [ ] Unit: Message routing logic
- [ ] Unit: Idea extraction
- [ ] Integration: Full message → Claude → idea flow
- [ ] Integration: Async job processing
- [ ] Load: 100 concurrent messages

---

## Implementation Plan

### Part 1: Message Enhancement (Day 1-2)

**Modify POST /conversations/:id/messages:**


### Part 2: Claude Integration (Day 2-3)

**Background Worker Enhancement:**
- Process message queues
- Build prompt with message context
- Call Claude for analysis
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
-  - Add Claude routing
-  - Add idea extraction
-  - Add message processing

### New
-  - Unit tests
-  - Integration tests

---

## Database Changes

Add to message_queue processing:
- message_id references
- result storage (Claude response + ideas)
- retry logic

---

## Tokenomics Impact

This sprint doesn't change tokenomics - it enhances the messaging layer to feed data into Sprint 10 (quality validation) and beyond.

---

## Success Criteria

- ✅ 25+ new tests passing
- ✅ Zero Phase 1 regressions
- ✅ Message processing latency <100ms
- ✅ Claude reasoning triggered automatically
- ✅ Ideas extracted and scored
- ✅ No data loss on errors

---

**Sprint Owner:** Claude Haiku 4.5  
**Start Date:** 2026-09-11  
**Target Completion:** 2026-09-17
