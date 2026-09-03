// Loaded by jest before any module imports. dotenv.config() in src/services/db.ts
// does NOT override variables that are already set, so this pins the test suite
// to the dedicated test database instead of production.
process.env.DB_NAME = 'mojomo_test';
process.env.NODE_ENV = 'test';
