# Sprint 14: High-Volume Messaging

**Phase:** 3  
**Duration:** 1 week (2026-10-16 to 2026-10-22)  
**Status:** 🚀 STARTING

## Objectives

Optimize message handling for high-concurrency scenarios with batch processing and rate limiting.

## Key Features

✅ Batch Message Processing
- Collect messages in temporal batches (100ms window)
- Batch insert to reduce transaction overhead
- Parallel idea extraction across batch
- Idea deduplication at batch level

✅ Rate Limiting
- Per-avatar rate limit (50 msg/min)
- Per-conversation capacity (1000 msg/day)
- Sliding window algorithm (60-second)
- Graceful rejection with 429 status

✅ Message Queue Optimization
- Async idea extraction in background
- Priority queue for urgent reasoning jobs
- Circuit breaker for Claude API failures
- Exponential backoff with jitter

✅ Performance Metrics
- <100ms p95 message insert latency
- Batch throughput: 1000+ msg/sec
- Rate limiter overhead <5ms per request
- Zero message loss under load

## Acceptance Criteria

- [ ] Batch message processing endpoint
- [ ] Rate limiting with sliding window
- [ ] Background idea extraction queue
- [ ] Circuit breaker for API failures
- [ ] 20+ high-volume tests
- [ ] All Phase 3 tests still passing

## Definition of Done

- ✅ Batch processing service implemented
- ✅ Rate limiter implemented
- ✅ 20+ tests passing
- ✅ No regressions in Phase 1-3

