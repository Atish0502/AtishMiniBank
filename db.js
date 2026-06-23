const { Pool, types } = require('pg');
const crypto = require('crypto');

// Configure NUMERIC (OID 1700) to be parsed as float in JS
types.setTypeParser(1700, function(val) {
  return parseFloat(val);
});

// Configure BIGINT (OID 20) and INTEGER (OID 23) to be parsed as integer in JS
types.setTypeParser(20, function(val) {
  return parseInt(val, 10);
});

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("FATAL ERROR: DATABASE_URL is not set in environmental variables.");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('sslmode=require') || connectionString.includes('neon.tech') 
    ? { rejectUnauthorized: false } 
    : false
});

// Helper to run a SQL query
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    // console.log('executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (err) {
    console.error('Database query error:', err.message, '\nQuery:', text, '\nParams:', params);
    throw err;
  }
}

// Helper to generate a 24-character hexadecimal ID (MongoDB ObjectId equivalent)
function generateId() {
  return crypto.randomBytes(12).toString('hex');
}

// Schema DDL execution on startup
async function initDb() {
  console.log("Initializing PostgreSQL database tables...");
  try {
    // 1. users
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        "_id" VARCHAR(24) PRIMARY KEY,
        "name" VARCHAR(255) NOT NULL,
        "username" VARCHAR(255) UNIQUE NOT NULL,
        "email" VARCHAR(255) UNIQUE NOT NULL,
        "mobile" VARCHAR(50),
        "password" VARCHAR(255) NOT NULL,
        "passwordPlain" VARCHAR(255),
        "role" VARCHAR(50) DEFAULT 'user',
        "status" VARCHAR(50) DEFAULT 'active',
        "token" VARCHAR(255),
        "preferences" JSONB,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users("username");`);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users("email");`);

    // 2. accounts
    await query(`
      CREATE TABLE IF NOT EXISTS accounts (
        "_id" VARCHAR(24) PRIMARY KEY,
        "ownerId" VARCHAR(24) REFERENCES users("_id") ON DELETE CASCADE,
        "accountNumber" INTEGER UNIQUE NOT NULL,
        "type" VARCHAR(50) NOT NULL,
        "balance" NUMERIC(15, 2) DEFAULT 0.00,
        "status" VARCHAR(50) DEFAULT 'active',
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_accounts_number ON accounts("accountNumber");`);

    // 3. transactions
    await query(`
      CREATE TABLE IF NOT EXISTS transactions (
        "_id" VARCHAR(24) PRIMARY KEY,
        "transactionId" VARCHAR(50) UNIQUE NOT NULL,
        "type" VARCHAR(50) NOT NULL,
        "accountNumber" INTEGER,
        "fromAccount" INTEGER,
        "toAccount" INTEGER,
        "amount" NUMERIC(15, 2) NOT NULL,
        "description" TEXT,
        "status" VARCHAR(50) DEFAULT 'success',
        "performedBy" VARCHAR(255),
        "date" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_transactions_txn_id ON transactions("transactionId");`);

    // 4. beneficiaries
    await query(`
      CREATE TABLE IF NOT EXISTS beneficiaries (
        "_id" VARCHAR(24) PRIMARY KEY,
        "userId" VARCHAR(24) REFERENCES users("_id") ON DELETE CASCADE,
        "name" VARCHAR(255) NOT NULL,
        "accountNumber" INTEGER NOT NULL,
        "bankName" VARCHAR(255) DEFAULT 'MiniBank',
        "addedDate" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 5. otps
    await query(`
      CREATE TABLE IF NOT EXISTS otps (
        "_id" VARCHAR(24) PRIMARY KEY,
        "userId" VARCHAR(24) REFERENCES users("_id") ON DELETE CASCADE,
        "code" VARCHAR(10) NOT NULL,
        "action" VARCHAR(50) NOT NULL,
        "actionData" JSONB,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "verified" BOOLEAN DEFAULT FALSE
      );
    `);

    // 6. notifications
    await query(`
      CREATE TABLE IF NOT EXISTS notifications (
        "_id" VARCHAR(24) PRIMARY KEY,
        "userId" VARCHAR(24) REFERENCES users("_id") ON DELETE CASCADE,
        "title" VARCHAR(255) NOT NULL,
        "message" TEXT NOT NULL,
        "read" BOOLEAN DEFAULT FALSE,
        "timestamp" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 7. auditLogs
    await query(`
      CREATE TABLE IF NOT EXISTS "auditLogs" (
        "_id" VARCHAR(24) PRIMARY KEY,
        "userId" VARCHAR(24),
        "username" VARCHAR(255),
        "action" VARCHAR(255) NOT NULL,
        "details" JSONB,
        "ipAddress" VARCHAR(50),
        "timestamp" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 8. fixedDeposits
    await query(`
      CREATE TABLE IF NOT EXISTS "fixedDeposits" (
        "_id" VARCHAR(24) PRIMARY KEY,
        "userId" VARCHAR(24) REFERENCES users("_id") ON DELETE CASCADE,
        "accountNumber" INTEGER NOT NULL,
        "principal" NUMERIC(15, 2) NOT NULL,
        "interestRate" NUMERIC(5, 2) NOT NULL,
        "durationMonths" INTEGER NOT NULL,
        "maturityAmount" NUMERIC(15, 2) NOT NULL,
        "status" VARCHAR(50) DEFAULT 'active',
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        "maturesAt" TIMESTAMP WITH TIME ZONE NOT NULL
      );
    `);

    // 9. recurringDeposits
    await query(`
      CREATE TABLE IF NOT EXISTS "recurringDeposits" (
        "_id" VARCHAR(24) PRIMARY KEY,
        "userId" VARCHAR(24) REFERENCES users("_id") ON DELETE CASCADE,
        "accountNumber" INTEGER NOT NULL,
        "monthlyDeposit" NUMERIC(15, 2) NOT NULL,
        "interestRate" NUMERIC(5, 2) NOT NULL,
        "durationMonths" INTEGER NOT NULL,
        "totalPaid" NUMERIC(15, 2) NOT NULL,
        "monthsPaid" INTEGER DEFAULT 1,
        "estimatedMaturity" NUMERIC(15, 2) NOT NULL,
        "status" VARCHAR(50) DEFAULT 'active',
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        "lastPaymentDate" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 10. loans
    await query(`
      CREATE TABLE IF NOT EXISTS loans (
        "_id" VARCHAR(24) PRIMARY KEY,
        "userId" VARCHAR(24) REFERENCES users("_id") ON DELETE CASCADE,
        "amount" NUMERIC(15, 2) NOT NULL,
        "durationMonths" INTEGER NOT NULL,
        "interestRate" NUMERIC(5, 2) NOT NULL,
        "monthlyEmi" NUMERIC(15, 2) NOT NULL,
        "purpose" TEXT,
        "targetAccount" INTEGER NOT NULL,
        "status" VARCHAR(50) DEFAULT 'pending',
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        "reviewedAt" TIMESTAMP WITH TIME ZONE,
        "reviewRemarks" TEXT
      );
    `);

    // 11. scheduledTransfers
    await query(`
      CREATE TABLE IF NOT EXISTS "scheduledTransfers" (
        "_id" VARCHAR(24) PRIMARY KEY,
        "userId" VARCHAR(24) REFERENCES users("_id") ON DELETE CASCADE,
        "fromAccount" INTEGER NOT NULL,
        "toAccount" INTEGER NOT NULL,
        "amount" NUMERIC(15, 2) NOT NULL,
        "description" TEXT,
        "scheduledDate" TIMESTAMP WITH TIME ZONE NOT NULL,
        "status" VARCHAR(50) DEFAULT 'pending',
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        "transactionId" VARCHAR(50),
        "executedAt" TIMESTAMP WITH TIME ZONE,
        "failureReason" TEXT,
        "failedAt" TIMESTAMP WITH TIME ZONE
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_scheduled_transfers_date ON "scheduledTransfers"("scheduledDate");`);

    console.log("All tables successfully initialized in Neon PostgreSQL!");
  } catch (err) {
    console.error("Failed to initialize database tables:", err);
    process.exit(1);
  }
}

module.exports = {
  query,
  generateId,
  initDb,
  pool
};
