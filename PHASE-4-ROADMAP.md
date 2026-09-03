# MOJOMO Phase 4: Idea Lifecycle & Specialist Matching

**Phase Status:** 🚀 STARTING (2026-10-30+)

## Phase 4 Overview

Phase 4 extends the idea ecosystem with specialist matching and idea lifecycle workflows. Ideas progress from conversation seedlings through refinement and eventual implementation by specialists.

**Timeline:** 3 sprints planned (16-18)
**Target Completion:** 2026-11-19

---

## Implementation Sequence

### Sprint 16: Idea Lifecycle Management
**Duration:** 2026-10-30 to 2026-11-05 (1 week)

**Features:**
- [ ] Idea versioning (track changes over time)
- [ ] Idea comments and discussion thread
- [ ] Idea voting/endorsement system
- [ ] Contributor tracking per idea
- [ ] Idea implementation status tracking

**Acceptance Criteria:**
- [ ] 20+ lifecycle tests
- [ ] All Phase 3 tests still passing
- [ ] Idea status workflow: seedling → exploring → refined → implemented

---

### Sprint 17: Specialist Matching
**Duration:** 2026-11-06 to 2026-11-12 (1 week)

**Features:**
- [ ] Specialist skill tagging
- [ ] Idea requirement analysis (extract required skills)
- [ ] Matching algorithm (skill similarity scoring)
- [ ] Match recommendation endpoint
- [ ] Specialist acceptance/rejection flow

**Acceptance Criteria:**
- [ ] 20+ matching tests
- [ ] Match accuracy validation
- [ ] Performance: <500ms match calculation

---

### Sprint 18: End-to-End Implementation
**Duration:** 2026-11-13 to 2026-11-19 (1 week)

**Features:**
- [ ] Idea to specialist assignment
- [ ] Implementation contract creation
- [ ] Milestone tracking
- [ ] Completion verification
- [ ] Reward distribution

**Acceptance Criteria:**
- [ ] 25+ E2E tests
- [ ] Full workflow verification
- [ ] All Phase 4 tests passing (65+ total)

---

## Expected Outcomes

**After Phase 4:**
- 391+ total tests passing (326 + 65)
- Ideas can be matched with specialists
- Full lifecycle: idea → implementation → reward
- Skills-based matching system
- Implementation tracking and verification

---

## Architecture Notes

**Idea Versioning:**
- Store versions in `idea_versions` table
- Track author, timestamp, changes
- Support idea rollback if needed

**Specialist Skills:**
- `specialist_skills` table with skill tags
- Skills associated with avatars, not conversations
- Hierarchical skill taxonomy (optional)

**Matching Algorithm:**
- Cosine similarity on skill vectors
- Weighted by idea requirements
- Score threshold: 0.65 minimum match

**Implementation Contracts:**
- `idea_implementations` table
- Track start date, milestones, status
- Linked to rewards distribution

---

## Success Metrics

- ✅ Ideas can be versioned and discussed
- ✅ Specialists can be matched to ideas (65%+ accuracy)
- ✅ Full lifecycle testable: idea → specialist → implementation → reward
- ✅ No regressions in Phase 1-3
- ✅ Performance: <500ms match calculation

