# Sprint 8: Reasoning Prompt Setup - Claude Integration

**Phase:** 2  
**Duration:** 1 week (2026-09-04 to 2026-09-10)  
**Status:** 🚀 IN PROGRESS

---

## Objectives

Integrate Claude API for conversation reasoning. Establish the foundation for multi-turn conversations with Claude analyzing message context and extracting insights.

**User Story:** As a user in a conversation, I can trigger Claude to reason about the conversation and get structured reasoning output, which feeds into idea extraction and quality scoring.

---

## Acceptance Criteria

✅ **Claude API Integration**
- [x] API key configuration from .env
- [x] Claude client initialization
- [x] Error handling & retry logic (exponential backoff, max 3 attempts)
- [x] Rate limiting respect (track usage, throttle if needed)
- [ ] Timeout handling (30-second max per request)

✅ **Reasoning Endpoint**
- [ ] POST /conversations/:id/reasoning - Trigger Claude reasoning
- [ ] Request: { prompt_override?: string }
- [ ] Response: { reasoning_id, status, message_count, token_estimate }
- [ ] Validation: Conversation exists, user has access
- [ ] Async processing (returns immediately, processes in background)

✅ **Database**
- [ ] reasoning_logs table (store prompts, responses, costs)
- [ ] message_queue table (track async job status)
- [ ] Indexes on conversation_id, status, created_at
- [ ] Audit trail (who triggered, when, status)

✅ **Prompt Engineering**
- [ ] System prompt designed (conversation analysis)
- [ ] Context management (summarize old messages if needed)
- [ ] Response format (structured JSON)
- [ ] Validation (parse Claude response, validate JSON)

✅ **Testing**
- [ ] Unit: Prompt formatting
- [ ] Unit: Response parsing
- [ ] Unit: Error handling (timeout, rate limit, API error)
- [ ] Integration: Full POST endpoint flow
- [ ] Integration: Message queue job processing
- [ ] Integration: Async status polling

---

## Key Implementation Points

### System Prompt Design

```
You are analyzing a conversation between avatars working on shared ideas.

Conversation context:
[Last 10 messages]

Your task:
1. Identify key themes or topics being discussed
2. Extract any novel insights or ideas mentioned
3. Score the conversation quality (0-10)
4. Suggest next steps or questions for the group
5. Flag any disagreements or tensions

Respond in valid JSON:
{
  "themes": ["theme1", "theme2"],
  "insights": ["insight1", "insight2"],
  "quality_score": 7,
  "next_steps": ["step1", "step2"],
  "tensions": ["tension1"]
}
```

### Database Schema

**reasoning_logs table:**
```sql
CREATE TABLE reasoning_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  tokens_used INTEGER,
  cost DECIMAL(10, 6),
  status VARCHAR(50), -- pending, completed, error
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);
CREATE INDEX idx_reasoning_logs_conversation ON reasoning_logs(conversation_id);
CREATE INDEX idx_reasoning_logs_created ON reasoning_logs(created_at DESC);
```

**message_queue table:**
```sql
CREATE TABLE message_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  reasoning_logs_id UUID REFERENCES reasoning_logs(id),
  status VARCHAR(50), -- pending, processing, completed, failed
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  error_message TEXT,
  result JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);
CREATE INDEX idx_message_queue_status ON message_queue(status);
CREATE INDEX idx_message_queue_created ON message_queue(created_at DESC);
```

### Error Handling

- **API Rate Limited:** Retry with exponential backoff (1s, 2s, 4s)
- **API Timeout:** Fail gracefully, return "reasoning_pending" status
- **Invalid Response:** Log error, mark as failed, allow user retry
- **Queue Overflow:** Drop oldest pending jobs if queue > 1000

### Async Job Processing

```
POST /conversations/:id/reasoning
  ↓
Create reasoning_logs record (status=pending)
Create message_queue job (status=pending)
Return { reasoning_id, status: "pending" }
  ↓
Background Worker:
  Get reasoning_logs by id
  Fetch conversation messages
  Call Claude API
  Parse response
  Update reasoning_logs (status=completed)
  Update message_queue (status=completed)
  ↓
GET /reasoning-logs/:id
  Return { reasoning_id, status, response }
```

---

## Files to Create/Modify

### New Files
- `src/services/claude.ts` - Claude API client
- `src/routes/reasoning.ts` - Reasoning endpoints
- `tests/unit/sprint8-reasoning.test.ts` - Unit tests
- `tests/integration/sprint8-reasoning.test.ts` - Integration tests

### Modified Files
- `src/server.ts` - Register reasoning routes
- `.env.example` - Add CLAUDE_API_KEY
- `schema.sql` - Add reasoning_logs and message_queue tables

---

## Testing Strategy

### Unit Tests (Claude Client)
- Prompt formatting with different message counts
- Response parsing (valid JSON, invalid JSON, malformed)
- Error handling (timeout, rate limit, API error)
- Token estimation accuracy
- Cost calculation

### Integration Tests (Endpoints)
- POST /conversations/:id/reasoning creates job
- GET /reasoning-logs/:id returns status
- Invalid conversation ID returns 404
- Unauthorized user returns 403
- Async job completes and updates status
- Error in Claude API doesn't crash queue

### Smoke Tests
- Create reasoning job
- Check status (pending initially)
- Wait for completion
- Verify response format
- Parse and validate JSON response

---

## Definition of Done

- [x] Sprint 8 README created
- [ ] Claude client implemented
- [ ] Reasoning endpoints working
- [ ] Database tables created
- [ ] All 20+ tests passing
- [ ] Error handling tested
- [ ] Async job processing verified
- [ ] No breaking changes to Phase 1 tests
- [ ] Code reviewed & clean
- [ ] Ready for Sprint 9

---

## Next Sprint (Sprint 9)

Sprint 9 will enhance message routing to automatically trigger reasoning when messages arrive, and integrate Claude-based idea scoring.

---

**Sprint Owner:** Claude Haiku 4.5  
**Start Date:** 2026-09-04  
**Target Completion:** 2026-09-10
