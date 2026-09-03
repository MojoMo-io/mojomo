// Loaded by jest before any module imports. dotenv.config() in src/services/db.ts
// does NOT override variables that are already set, so this pins the test suite
// to the dedicated test database instead of production.
process.env.DB_NAME = 'mojomo_test';
process.env.NODE_ENV = 'test';
// Specialist joins are feature-flagged off in production (roadmap item); tests exercise the flow.
process.env.SPECIALISTS_ENABLED = 'true';
