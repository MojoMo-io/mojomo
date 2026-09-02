# MOJOMO Sprint 0: Foundation & Schema

## Status
Foundation setup in progress. Core files created, database setup next.

## Completed Tasks

### 0.1: Database Migrations
- ✅ schema.sql created with full MOJOMO schema
  - avatars table with Telegram integration
  - conversations with ownership_ledger (JSONB)
  - conversation_messages with idea_score
  - token_ledger for audit trail
  - conversation_events for lifecycle
  - idea_repository for extracted ideas
  - payouts table
  - All constraints and indexes defined
  - Ownership sum constraint enforced

### 0.2: Avatar API - Telegram Integration
- ✅ Express server setup (src/server.ts)
- ✅ Avatar routes created
  - POST /avatars - Create avatar with optional Telegram
  - GET /avatars/:id - Get single avatar
  - GET /avatars - List user's avatars
  - PATCH /avatars/:id/telegram - Update Telegram chat
- ✅ Telegram service (verifyTelegramChat)
- ✅ Validation schemas (Zod)
- ✅ Database utilities (connection pooling, transactions)

### 0.3: Unit Tests & Utilities
- ✅ Jest configuration
- ✅ Basic unit tests for avatar creation
- ✅ Telegram verification mocking
- ✅ Validation logic tests

## Next Steps

1. **Install dependencies**: `npm install`
2. **Set up database**: Create mojomo database in PostgreSQL
3. **Run migrations**: `npm run db:migrate`
4. **Start dev server**: `npm run dev`
5. **Run tests**: `npm test`

## Project Structure
```
/opt/mojomo/
├── src/
│   ├── types/          # TypeScript type definitions
│   ├── services/       # Database, Telegram, etc.
│   ├── routes/         # API endpoints
│   ├── scripts/        # Database migrations
│   └── server.ts       # Main Express server
├── tests/
│   ├── unit/           # Unit tests
│   └── integration/    # Integration tests (coming later)
├── schema.sql          # Database schema
├── package.json        # Dependencies
└── tsconfig.json       # TypeScript config
```

## Database Schema

Core tables:
- `avatars`: User profiles with Telegram integration
- `conversations`: Shared token pools (ownership_ledger in JSONB)
- `conversation_messages`: Messages with idea_score
- `token_ledger`: Append-only token movement log
- `conversation_events`: Conversation lifecycle events
- `idea_repository`: Extracted ideas from conversations
- `payouts`: Token withdrawal records

All tables have proper indexes and constraints.

## Endpoints (Sprint 0 Complete)

### Avatar Management
- `POST /api/avatars` - Create avatar
- `GET /api/avatars/:id` - Get avatar
- `GET /api/avatars` - List avatars
- `PATCH /api/avatars/:id/telegram` - Update Telegram

### Health Check
- `GET /health` - Server health

## Environment Variables

See `.env.example`. Key variables:
- `DATABASE_URL`: PostgreSQL connection
- `TELEGRAM_BOT_TOKEN`: Telegram bot token for verification
- `PORT`: Server port (default 8002)

## Notes

- Telegram verification is graceful: if verification fails, avatar is created anyway
- Validation uses Zod schemas
- Database includes ownership sum constraint (must = 100% ±0.1%)
- Tests use mocks to avoid external Telegram API calls

