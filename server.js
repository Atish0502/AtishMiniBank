require('dotenv').config();
const express = require("express");
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require("./db");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'atish1997';
let currentAdminToken = null;

// Connect to PostgreSQL database and start the server
async function start() {
  try {
    await db.initDb();
  } catch (err) {
    console.error('Database connection / initialization failed:', err);
    process.exit(1);
  }

  // Start Scheduled Transfer Execution Interval (runs every 10 seconds)
  setInterval(processScheduledTransfers, 10000);

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log('Server running on port', port);
  });
}

start();

// Audit Logger Helper
async function logAction(userId, username, action, details, req) {
  try {
    const ipAddress = req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress) : '127.0.0.1';
    const id = db.generateId();
    const detailsJson = typeof details === 'object' ? details : { message: details };
    
    await db.query(
      `INSERT INTO "auditLogs" ("_id", "userId", "username", "action", "details", "ipAddress", "timestamp") 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, userId ? String(userId) : 'system', username || 'system', action, JSON.stringify(detailsJson), ipAddress, new Date()]
    );
  } catch (err) {
    console.error('Audit logging failed:', err);
  }
}

// Notification Helper
async function notifyUser(userId, title, message) {
  try {
    const id = db.generateId();
    await db.query(
      `INSERT INTO notifications ("_id", "userId", "title", "message", "read", "timestamp") 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, String(userId), title, message, false, new Date()]
    );
  } catch (err) {
    console.error('Notification creation failed:', err);
  }
}

// Helper to generate a unique 6-digit account number
async function generateAccountNumber() {
  while (true) {
    const num = Math.floor(100000 + Math.random() * 900000);
    const res = await db.query('SELECT 1 FROM accounts WHERE "accountNumber" = $1 LIMIT 1', [num]);
    if (res.rowCount === 0) return num;
  }
}

// Authentication Middleware
async function authenticate(req, res, next) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token && currentAdminToken && token === currentAdminToken) {
      req.isAdmin = true;
      return next();
    }
    const userRes = await db.query('SELECT * FROM users WHERE token = $1 LIMIT 1', [token]);
    if (userRes.rowCount > 0) {
      const user = userRes.rows[0];
      if (user.status === 'suspended') {
        return res.status(403).send('Your account has been suspended by the administrator.');
      }
      req.user = user;
      req.isAdmin = false;
      return next();
    }
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user && !req.isAdmin) {
    return res.status(401).send('Unauthorized: Login required.');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.isAdmin) {
    return res.status(403).send('Forbidden: Admin access required.');
  }
  next();
}

// Authentication Routes

// Signup: Hash password, create user, auto-generate first savings account
app.post('/signup', async (req, res) => {
  const { name, username, email, mobile, password } = req.body;

  if (!name || !username || !email || !mobile || !password) {
    return res.status(400).send('All fields are required.');
  }

  if (password.length < 6) {
    return res.status(400).send('Password must be at least 6 characters long.');
  }

  try {
    const existingRes = await db.query('SELECT 1 FROM users WHERE username = $1 OR email = $2 LIMIT 1', [username, email]);
    if (existingRes.rowCount > 0) {
      return res.status(400).send('Username or Email already registered.');
    }

    const hash = await bcrypt.hash(password, 10);
    const token = uuidv4();
    const userId = db.generateId();
    
    // Default preferences object matching existing schema
    const preferences = {
      otpEnabled: false,
      notifyEmail: true,
      alertTransfer: true,
      alertDeposit: true,
      alertWithdraw: true
    };

    await db.query(
      `INSERT INTO users ("_id", name, username, email, mobile, password, "passwordPlain", role, status, token, preferences, "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [userId, name, username, email, mobile, hash, password, 'user', 'active', token, JSON.stringify(preferences), new Date()]
    );

    // Create the first savings account automatically
    const accountNumber = await generateAccountNumber();
    const accountId = db.generateId();
    await db.query(
      `INSERT INTO accounts ("_id", "ownerId", "accountNumber", type, balance, status, "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [accountId, userId, accountNumber, 'Savings', 0, 'active', new Date()]
    );

    // Logs & Notifications
    await logAction(userId, username, 'signup', { accountNumber }, req);
    await notifyUser(userId, 'Welcome to MiniBank!', `Your first Savings Account (Acct No: ${accountNumber}) has been opened automatically. Welcome aboard!`);

    const userOut = { _id: userId, name, username, email, mobile, role: 'user', status: 'active' };
    return res.json({ success: true, token, user: userOut });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).send('Internal server error during signup.');
  }
});

// User Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send('Username and password are required.');

  try {
    const userRes = await db.query('SELECT * FROM users WHERE username = $1 LIMIT 1', [username]);
    if (userRes.rowCount === 0) {
      await logAction(null, username, 'failed_login', 'Invalid username', req);
      return res.status(401).send('Invalid credentials.');
    }
    const user = userRes.rows[0];

    if (user.status === 'suspended') {
      await logAction(user._id, username, 'failed_login', 'Suspended user tried to log in', req);
      return res.status(403).send('Your account has been suspended by the administrator.');
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await logAction(user._id, username, 'failed_login', 'Incorrect password', req);
      return res.status(401).send('Invalid credentials.');
    }

    const token = uuidv4();
    await db.query('UPDATE users SET token = $1 WHERE "_id" = $2', [token, user._id]);
    
    await logAction(user._id, username, 'login', 'Successfully logged in', req);

    const accountsRes = await db.query('SELECT * FROM accounts WHERE "ownerId" = $1', [user._id]);
    const accounts = accountsRes.rows;
    const userOut = { _id: user._id, name: user.name, username: user.username, email: user.email, mobile: user.mobile, role: user.role, status: user.status, accounts, preferences: user.preferences };
    
    return res.json({ success: true, token, user: userOut });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).send('Internal server error during login.');
  }
});

// Admin Login
app.post('/admin-login', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).send('Admin password required.');

  if (password === ADMIN_PASSWORD) {
    currentAdminToken = uuidv4();
    await logAction(null, 'admin', 'admin_login', 'Admin logged in', req);
    return res.json({ success: true, admin: true, token: currentAdminToken });
  }

  await logAction(null, 'admin', 'failed_admin_login', 'Failed admin login attempt', req);
  return res.status(401).send('Invalid admin password.');
});

// Get profile & accounts
app.get('/me', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) {
    return res.json({ admin: true, user: { name: 'System Administrator', username: 'admin', role: 'admin' } });
  }
  
  try {
    const user = req.user;
    const accountsRes = await db.query('SELECT * FROM accounts WHERE "ownerId" = $1', [user._id]);
    const accounts = accountsRes.rows;
    const userOut = { _id: user._id, name: user.name, username: user.username, email: user.email, mobile: user.mobile, role: user.role, status: user.status, accounts, preferences: user.preferences };
    return res.json({ success: true, user: userOut });
  } catch (err) {
    return res.status(500).send('Error loading profile.');
  }
});

// Update Profile info
app.put('/me', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins cannot modify profile details.');
  
  const { name, email, mobile } = req.body;
  const fields = [];
  const vals = [];
  let count = 1;
  
  if (name) {
    fields.push(`name = $${count}`);
    vals.push(name);
    count++;
  }
  if (email) {
    fields.push(`email = $${count}`);
    vals.push(email);
    count++;
  }
  if (mobile) {
    fields.push(`mobile = $${count}`);
    vals.push(mobile);
    count++;
  }

  if (fields.length === 0) return res.status(400).send('No fields to update.');
  
  vals.push(req.user._id);
  const qStr = `UPDATE users SET ${fields.join(', ')} WHERE "_id" = $${count}`;

  try {
    await db.query(qStr, vals);
    await logAction(req.user._id, req.user.username, 'profile_update', req.body, req);
    
    const updatedUserRes = await db.query('SELECT * FROM users WHERE "_id" = $1 LIMIT 1', [req.user._id]);
    const updatedUser = updatedUserRes.rows[0];
    
    const accountsRes = await db.query('SELECT * FROM accounts WHERE "ownerId" = $1', [req.user._id]);
    const accounts = accountsRes.rows;
    
    const userOut = { _id: updatedUser._id, name: updatedUser.name, username: updatedUser.username, email: updatedUser.email, mobile: updatedUser.mobile, role: updatedUser.role, status: updatedUser.status, accounts, preferences: updatedUser.preferences };
    return res.json({ success: true, user: userOut });
  } catch (err) {
    return res.status(500).send('Error updating profile.');
  }
});

// Banking Operations Routes

// Open a New Account (Authenticated users only)
app.post('/accounts', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins cannot open accounts.');

  const { type } = req.body;
  if (!['Savings', 'Current', 'Salary'].includes(type)) {
    return res.status(400).send('Invalid account type. Choose Savings, Current, or Salary.');
  }

  try {
    const accountNumber = await generateAccountNumber();
    const accountId = db.generateId();
    const newAccount = {
      _id: accountId,
      ownerId: req.user._id,
      accountNumber,
      type,
      balance: 0,
      status: 'active',
      createdAt: new Date()
    };

    await db.query(
      `INSERT INTO accounts ("_id", "ownerId", "accountNumber", type, balance, status, "createdAt") 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [accountId, req.user._id, accountNumber, type, 0, 'active', newAccount.createdAt]
    );

    await logAction(req.user._id, req.user.username, 'open_account', { accountNumber, type }, req);
    await notifyUser(req.user._id, 'New Account Opened', `Your new ${type} Account (Acct No: ${accountNumber}) is now active.`);

    return res.json({ success: true, account: newAccount });
  } catch (err) {
    return res.status(500).send('Error creating new account.');
  }
});

// Close a Specific Account
app.post('/accounts/:accountNumber/close', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins cannot close user accounts directly.');

  const accNum = parseInt(req.params.accountNumber);
  if (isNaN(accNum)) return res.status(400).send('Invalid account number.');

  try {
    const accountRes = await db.query('SELECT * FROM accounts WHERE "accountNumber" = $1 AND "ownerId" = $2 LIMIT 1', [accNum, req.user._id]);
    if (accountRes.rowCount === 0) return res.status(404).send('Account not found or you do not own it.');
    const account = accountRes.rows[0];

    if (account.status === 'closed') {
      return res.status(400).send('Account is already closed.');
    }

    // Rule: Must maintain at least one active account
    const activeCountRes = await db.query('SELECT COUNT(*) FROM accounts WHERE "ownerId" = $1 AND status = $2', [req.user._id, 'active']);
    const activeAccountsCount = parseInt(activeCountRes.rows[0].count, 10);

    if (activeAccountsCount <= 1 && account.status === 'active') {
      return res.status(400).send('Closure denied: You must maintain at least one active account.');
    }

    // Rule: Balance must be 0
    if (parseFloat(account.balance) !== 0) {
      return res.status(400).send('Closure denied: Balance must be exactly ₹0.00.');
    }

    // Rule: No active FD linked
    const activeFdRes = await db.query('SELECT 1 FROM "fixedDeposits" WHERE "accountNumber" = $1 AND status = $2 LIMIT 1', [accNum, 'active']);
    if (activeFdRes.rowCount > 0) {
      return res.status(400).send('Closure denied: There is an active Fixed Deposit linked to this account.');
    }

    // Rule: No active RD linked
    const activeRdRes = await db.query('SELECT 1 FROM "recurringDeposits" WHERE "accountNumber" = $1 AND status = $2 LIMIT 1', [accNum, 'active']);
    if (activeRdRes.rowCount > 0) {
      return res.status(400).send('Closure denied: There is an active Recurring Deposit linked to this account.');
    }

    // Rule: No pending or active loan linked
    const activeLoanRes = await db.query('SELECT 1 FROM loans WHERE "targetAccount" = $1 AND status IN ($2, $3) LIMIT 1', [accNum, 'pending', 'approved']);
    if (activeLoanRes.rowCount > 0) {
      return res.status(400).send('Closure denied: There is a pending or active loan linked to this account.');
    }

    // Proceed to close account
    await db.query('UPDATE accounts SET status = $1 WHERE "accountNumber" = $2', ['closed', accNum]);

    // Audit logs & Notifications
    await logAction(req.user._id, req.user.username, 'close_account', { accountNumber: accNum }, req);
    await notifyUser(req.user._id, 'Account Closed', `Your account ${accNum} has been successfully closed.`);

    return res.json({ success: true, message: `Account ${accNum} has been closed.` });
  } catch (err) {
    console.error('Account closure error:', err);
    return res.status(500).send('Internal server error during account closure.');
  }
});

// Deposit Money
app.post('/deposit', authenticate, requireLogin, async (req, res) => {
  const { accountNumber, amount, description } = req.body;
  const accNum = parseInt(accountNumber);
  const depAmt = parseFloat(amount);

  if (isNaN(accNum) || isNaN(depAmt) || depAmt <= 0) {
    return res.status(400).send('Invalid account number or positive amount required.');
  }

  try {
    const accountRes = await db.query('SELECT * FROM accounts WHERE "accountNumber" = $1 LIMIT 1', [accNum]);
    if (accountRes.rowCount === 0) return res.status(404).send('Account not found.');
    const account = accountRes.rows[0];

    // Users can only deposit into their own accounts, Admins can deposit to any
    if (!req.isAdmin && account.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).send('Not authorized to deposit to this account.');
    }

    await db.query('UPDATE accounts SET balance = balance + $1 WHERE "accountNumber" = $2', [depAmt, accNum]);

    const transactionId = 'TXN-' + uuidv4().slice(0, 8).toUpperCase();
    const txnId = db.generateId();
    const txn = {
      _id: txnId,
      transactionId,
      type: 'deposit',
      accountNumber: accNum,
      amount: depAmt,
      description: description || 'Cash Deposit',
      status: 'success',
      performedBy: req.isAdmin ? 'admin' : req.user.username,
      date: new Date()
    };

    await db.query(
      `INSERT INTO transactions ("_id", "transactionId", type, "accountNumber", amount, description, status, "performedBy", date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [txnId, transactionId, 'deposit', accNum, depAmt, txn.description, 'success', txn.performedBy, txn.date]
    );

    await logAction(req.isAdmin ? null : req.user._id, req.isAdmin ? 'admin' : req.user.username, 'deposit', { accountNumber: accNum, amount: depAmt, transactionId }, req);
    await notifyUser(account.ownerId, 'Deposit Received', `A deposit of ₹${depAmt} was credited to your account ${accNum}. (Ref: ${transactionId})`);

    return res.json({ success: true, message: `Successfully deposited ₹${depAmt} into account ${accNum}.`, transaction: txn });
  } catch (err) {
    return res.status(500).send('Error performing deposit.');
  }
});

// Withdraw Money
app.post('/withdraw', authenticate, requireLogin, async (req, res) => {
  const { accountNumber, amount, description } = req.body;
  const accNum = parseInt(accountNumber);
  const wdrAmt = parseFloat(amount);

  if (isNaN(accNum) || isNaN(wdrAmt) || wdrAmt <= 0) {
    return res.status(400).send('Invalid account number or positive amount required.');
  }

  try {
    const accountRes = await db.query('SELECT * FROM accounts WHERE "accountNumber" = $1 LIMIT 1', [accNum]);
    if (accountRes.rowCount === 0) return res.status(404).send('Account not found.');
    const account = accountRes.rows[0];

    // Only owner can withdraw (Admins can't withdraw from user accounts directly)
    if (req.isAdmin || account.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).send('Not authorized to withdraw from this account.');
    }

    if (account.status === 'frozen') {
      return res.status(403).send('This account is frozen. Withdrawals are not permitted.');
    }

    if (parseFloat(account.balance) < wdrAmt) {
      return res.status(400).send('Insufficient balance.');
    }

    // Atomic withdrawal
    const result = await db.query(
      'UPDATE accounts SET balance = balance - $1 WHERE "accountNumber" = $2 AND balance >= $1 AND status = $3',
      [wdrAmt, accNum, 'active']
    );

    if (result.rowCount === 0) {
      return res.status(400).send('Withdrawal failed. Check balance or account status.');
    }

    const transactionId = 'TXN-' + uuidv4().slice(0, 8).toUpperCase();
    const txnId = db.generateId();
    const txn = {
      _id: txnId,
      transactionId,
      type: 'withdrawal',
      accountNumber: accNum,
      amount: wdrAmt,
      description: description || 'Cash Withdrawal',
      status: 'success',
      performedBy: req.user.username,
      date: new Date()
    };

    await db.query(
      `INSERT INTO transactions ("_id", "transactionId", type, "accountNumber", amount, description, status, "performedBy", date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [txnId, transactionId, 'withdrawal', accNum, wdrAmt, txn.description, 'success', txn.performedBy, txn.date]
    );

    await logAction(req.user._id, req.user.username, 'withdrawal', { accountNumber: accNum, amount: wdrAmt, transactionId }, req);
    await notifyUser(req.user._id, 'Withdrawal Alert', `A withdrawal of ₹${wdrAmt} was made from your account ${accNum}. (Ref: ${transactionId})`);

    return res.json({ success: true, message: `Successfully withdrew ₹${wdrAmt} from account ${accNum}.`, transaction: txn });
  } catch (err) {
    return res.status(500).send('Error performing withdrawal.');
  }
});

// Transfer Money (Step 1: Initiate & Send mock OTP for high values)
app.post('/transfer/initiate', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins cannot perform transfers.');

  const { from, to, amount, description } = req.body;
  const fromAcc = parseInt(from);
  const toAcc = parseInt(to);
  const tfAmt = parseFloat(amount);

  if (isNaN(fromAcc) || isNaN(toAcc) || isNaN(tfAmt) || tfAmt <= 0) {
    return res.status(400).send('All fields are required and amount must be positive.');
  }

  if (fromAcc === toAcc) {
    return res.status(400).send('Cannot transfer to the same account.');
  }

  try {
    const senderRes = await db.query('SELECT * FROM accounts WHERE "accountNumber" = $1 LIMIT 1', [fromAcc]);
    const receiverRes = await db.query('SELECT * FROM accounts WHERE "accountNumber" = $1 LIMIT 1', [toAcc]);

    if (senderRes.rowCount === 0) return res.status(404).send('Sender account not found.');
    if (receiverRes.rowCount === 0) return res.status(404).send('Recipient account not found.');

    const senderAcc = senderRes.rows[0];
    const receiverAcc = receiverRes.rows[0];

    if (senderAcc.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).send('You do not own the sender account.');
    }

    if (senderAcc.status === 'frozen') {
      return res.status(403).send('Transfer failed: Sender account is frozen.');
    }

    if (parseFloat(senderAcc.balance) < tfAmt) {
      return res.status(400).send('Insufficient balance.');
    }

    // High amount requires OTP verification (> $1,000)
    if (tfAmt > 1000) {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      // Invalidate previous OTPs
      await db.query('DELETE FROM otps WHERE "userId" = $1 AND action = $2', [req.user._id, 'transfer']);

      const otpId = db.generateId();
      await db.query(
        `INSERT INTO otps ("_id", "userId", code, action, "actionData", "expiresAt", verified)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [otpId, req.user._id, code, 'transfer', JSON.stringify({ from: fromAcc, to: toAcc, amount: tfAmt, description: description || 'Wire Transfer' }), expiresAt, false]
      );

      // Write a persistent notification record
      await notifyUser(
        req.user._id,
        'ATISH SECURE OTP',
        `Security Alert: Your verification code for the high-value wire transfer of ₹${tfAmt.toFixed(2)} to Account ${toAcc} is: ${code}`
      );

      console.log(`[OTP TRIGGERED] User: ${req.user.username} | Action: Transfer | Code: ${code}`);

      return res.json({
        otpRequired: true,
        message: 'A verification code is required for transfers greater than ₹1,000.',
        mockOtp: code
      });
    }

    // If <= $1,000, perform direct transfer
    return executeTransfer(senderAcc, receiverAcc, tfAmt, description || 'Wire Transfer', req, res);
  } catch (err) {
    console.error('Transfer initiate error:', err);
    return res.status(500).send('Error initiating transfer.');
  }
});

// Transfer Money (Step 2: Verify OTP & Execute)
app.post('/transfer/verify', authenticate, requireLogin, async (req, res) => {
  const { otpCode } = req.body;
  if (!otpCode) return res.status(400).send('Verification OTP code is required.');

  try {
    const otpRes = await db.query(
      'SELECT * FROM otps WHERE "userId" = $1 AND code = $2 AND action = $3 AND "expiresAt" > $4 LIMIT 1',
      [req.user._id, otpCode.trim(), 'transfer', new Date()]
    );

    if (otpRes.rowCount === 0) {
      return res.status(400).send('Invalid or expired verification code.');
    }
    const otpRecord = otpRes.rows[0];

    const { from, to, amount, description } = otpRecord.actionData;
    
    const senderRes = await db.query('SELECT * FROM accounts WHERE "accountNumber" = $1 LIMIT 1', [from]);
    const receiverRes = await db.query('SELECT * FROM accounts WHERE "accountNumber" = $1 LIMIT 1', [to]);

    if (senderRes.rowCount === 0 || receiverRes.rowCount === 0) {
      return res.status(400).send('Accounts involved in this transfer are no longer valid.');
    }

    const senderAcc = senderRes.rows[0];
    const receiverAcc = receiverRes.rows[0];

    if (parseFloat(senderAcc.balance) < amount) {
      return res.status(400).send('Insufficient balance.');
    }

    if (senderAcc.status === 'frozen') {
      return res.status(403).send('Sender account is frozen.');
    }

    // Clean up OTP
    await db.query('DELETE FROM otps WHERE "_id" = $1', [otpRecord._id]);

    // Execute transfer
    return executeTransfer(senderAcc, receiverAcc, amount, description, req, res);
  } catch (err) {
    console.error('Transfer verify error:', err);
    return res.status(500).send('Error verifying transfer.');
  }
});

// Core Transfer Logic with Rollback Check
async function executeTransfer(senderAcc, receiverAcc, amount, description, req, res) {
  const transactionId = 'TXN-' + uuidv4().slice(0, 8).toUpperCase();

  try {
    // 1. Debit sender conditionally
    const debitResult = await db.query(
      'UPDATE accounts SET balance = balance - $1 WHERE "accountNumber" = $2 AND balance >= $1 AND status = $3',
      [amount, senderAcc.accountNumber, 'active']
    );

    if (debitResult.rowCount === 0) {
      return res.status(400).send('Transfer failed: Insufficient balance or frozen account.');
    }

    // 2. Credit receiver
    const creditResult = await db.query(
      'UPDATE accounts SET balance = balance + $1 WHERE "accountNumber" = $2',
      [amount, receiverAcc.accountNumber]
    );

    // Rollback if credit fails
    if (creditResult.rowCount === 0) {
      console.error(`Credit failed for account ${receiverAcc.accountNumber}. Rolling back debit.`);
      await db.query(
        'UPDATE accounts SET balance = balance + $1 WHERE "accountNumber" = $2',
        [amount, senderAcc.accountNumber]
      );
      return res.status(400).send('Transfer failed: Recipient account was invalid.');
    }

    // 3. Save transaction record
    const txnId = db.generateId();
    const txn = {
      _id: txnId,
      transactionId,
      type: 'transfer',
      fromAccount: senderAcc.accountNumber,
      toAccount: receiverAcc.accountNumber,
      amount,
      description,
      status: 'success',
      performedBy: req.user.username,
      date: new Date()
    };

    await db.query(
      `INSERT INTO transactions ("_id", "transactionId", type, "fromAccount", "toAccount", amount, description, status, "performedBy", date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [txnId, transactionId, 'transfer', senderAcc.accountNumber, receiverAcc.accountNumber, amount, description, 'success', req.user.username, txn.date]
    );
    
    // Audit & Notifications
    await logAction(req.user._id, req.user.username, 'transfer', { from: senderAcc.accountNumber, to: receiverAcc.accountNumber, amount, transactionId }, req);
    await notifyUser(senderAcc.ownerId, 'Transfer Sent', `Sent ₹${amount} to account ${receiverAcc.accountNumber}. (Ref: ${transactionId})`);
    await notifyUser(receiverAcc.ownerId, 'Transfer Received', `Received ₹${amount} from account ${senderAcc.accountNumber}. (Ref: ${transactionId})`);

    return res.json({ success: true, message: `Successfully transferred ₹${amount} to account ${receiverAcc.accountNumber}.`, transaction: txn });
  } catch (err) {
    console.error('Fatal execution error on transfer:', err);
    return res.status(500).send('Critical database error during transfer.');
  }
}

// Get user transaction history
app.get('/transactions', authenticate, requireLogin, async (req, res) => {
  try {
    if (req.isAdmin) {
      const txnsRes = await db.query('SELECT * FROM transactions ORDER BY date DESC');
      return res.json(txnsRes.rows);
    }
    
    // User mode: get all user accounts first
    const accountsRes = await db.query('SELECT "accountNumber" FROM accounts WHERE "ownerId" = $1', [req.user._id]);
    const accNums = accountsRes.rows.map(a => a.accountNumber);

    if (accNums.length === 0) {
      return res.json([]);
    }

    const txnsRes = await db.query(
      `SELECT * FROM transactions
       WHERE "accountNumber" = ANY($1)
          OR "fromAccount" = ANY($1)
          OR "toAccount" = ANY($1)
       ORDER BY date DESC`,
      [accNums]
    );

    return res.json(txnsRes.rows);
  } catch (err) {
    return res.status(500).send('Error loading transaction log.');
  }
});

// Beneficiary Directory Management

// Get Beneficiaries
app.get('/beneficiaries', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins do not have beneficiaries.');
  try {
    const listRes = await db.query('SELECT * FROM beneficiaries WHERE "userId" = $1', [req.user._id]);
    return res.json(listRes.rows);
  } catch (err) {
    return res.status(500).send('Error loading beneficiaries.');
  }
});

// Add Beneficiary
app.post('/beneficiaries', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins cannot save beneficiaries.');
  
  const { name, accountNumber, bankName } = req.body;
  const accNum = parseInt(accountNumber);

  if (!name || isNaN(accNum)) {
    return res.status(400).send('Name and valid account number are required.');
  }

  try {
    // If bank is internal, check that account exists
    if (!bankName || bankName === 'MiniBank') {
      const targetRes = await db.query('SELECT 1 FROM accounts WHERE "accountNumber" = $1 LIMIT 1', [accNum]);
      if (targetRes.rowCount === 0) return res.status(400).send('MiniBank recipient account number does not exist.');
    }

    const existsRes = await db.query('SELECT 1 FROM beneficiaries WHERE "userId" = $1 AND "accountNumber" = $2 LIMIT 1', [req.user._id, accNum]);
    if (existsRes.rowCount > 0) return res.status(400).send('Beneficiary already saved.');

    const bId = db.generateId();
    const entry = {
      _id: bId,
      userId: req.user._id,
      name,
      accountNumber: accNum,
      bankName: bankName || 'MiniBank',
      addedDate: new Date()
    };

    await db.query(
      `INSERT INTO beneficiaries ("_id", "userId", name, "accountNumber", "bankName", "addedDate")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [bId, req.user._id, name, accNum, entry.bankName, entry.addedDate]
    );

    await logAction(req.user._id, req.user.username, 'add_beneficiary', { name, accountNumber: accNum }, req);

    return res.json({ success: true, beneficiary: entry });
  } catch (err) {
    return res.status(500).send('Error adding beneficiary.');
  }
});

// Delete Beneficiary
app.delete('/beneficiaries/:id', authenticate, requireLogin, async (req, res) => {
  try {
    const result = await db.query('DELETE FROM beneficiaries WHERE "_id" = $1 AND "userId" = $2', [req.params.id, req.user._id]);
    if (result.rowCount === 0) return res.status(404).send('Beneficiary not found.');
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).send('Error deleting beneficiary.');
  }
});

// Notification Routes
app.get('/notifications', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.json([]);
  try {
    const listRes = await db.query('SELECT * FROM notifications WHERE "userId" = $1 ORDER BY timestamp DESC', [req.user._id]);
    return res.json(listRes.rows);
  } catch (err) {
    return res.status(500).send('Error loading notifications.');
  }
});

app.post('/notifications/read', authenticate, requireLogin, async (req, res) => {
  try {
    await db.query('UPDATE notifications SET read = true WHERE "userId" = $1', [req.user._id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).send('Error marking notifications read.');
  }
});

// Admin Dashboard & System Controls

// Get System Stats Dashboard
app.get('/admin/summary', authenticate, requireLogin, requireAdmin, async (req, res) => {
  try {
    const totalUsersRes = await db.query("SELECT COUNT(*) FROM users WHERE role = 'user'");
    const totalAccountsRes = await db.query("SELECT COUNT(*) FROM accounts");
    const totalTxnsRes = await db.query("SELECT COUNT(*) FROM transactions");
    const sumResultRes = await db.query('SELECT SUM(balance) AS "totalBalance" FROM accounts');

    const totalUsers = parseInt(totalUsersRes.rows[0].count, 10);
    const totalAccounts = parseInt(totalAccountsRes.rows[0].count, 10);
    const totalTxns = parseInt(totalTxnsRes.rows[0].count, 10);
    const totalDepositPool = parseFloat(sumResultRes.rows[0].totalBalance || 0);

    return res.json({
      totalUsers,
      totalAccounts,
      totalTxns,
      totalDepositPool
    });
  } catch (err) {
    console.error('Error in /admin/summary:', err);
    return res.status(500).send('Error fetching admin summary.');
  }
});

// List all users (with their accounts)
app.get('/admin/users', authenticate, requireLogin, requireAdmin, async (req, res) => {
  try {
    const usersRes = await db.query("SELECT * FROM users WHERE role = 'user'");
    const accountsRes = await db.query("SELECT * FROM accounts");

    const users = usersRes.rows;
    const accounts = accountsRes.rows;

    const result = users.map(u => {
      const uAccs = accounts.filter(a => a.ownerId && u._id && a.ownerId.toString() === u._id.toString());
      return {
        _id: u._id,
        name: u.name,
        username: u.username,
        email: u.email,
        mobile: u.mobile,
        password: u.password, // return bcrypt hash for admin inspection
        passwordPlain: u.passwordPlain, // return plaintext password
        status: u.status,
        createdAt: u.createdAt,
        accounts: uAccs
      };
    });

    return res.json(result);
  } catch (err) {
    console.error('Error in /admin/users:', err);
    return res.status(500).send('Error loading user listing.');
  }
});

// List system audit logs
app.get('/admin/audit-logs', authenticate, requireLogin, requireAdmin, async (req, res) => {
  try {
    const logsRes = await db.query('SELECT * FROM "auditLogs" ORDER BY timestamp DESC LIMIT 100');
    return res.json(logsRes.rows);
  } catch (err) {
    console.error('Error in /admin/audit-logs:', err);
    return res.status(500).send('Error loading system audit logs.');
  }
});

// Freeze Account
app.post('/admin/freeze-account', authenticate, requireLogin, requireAdmin, async (req, res) => {
  const { accountNumber } = req.body;
  const accNum = parseInt(accountNumber);
  if (isNaN(accNum)) return res.status(400).send('Invalid account number.');

  try {
    const result = await db.query('UPDATE accounts SET status = $1 WHERE "accountNumber" = $2', ['frozen', accNum]);
    if (result.rowCount === 0) return res.status(404).send('Account not found.');
    
    const accRes = await db.query('SELECT "ownerId" FROM accounts WHERE "accountNumber" = $1 LIMIT 1', [accNum]);
    const acc = accRes.rows[0];
    await logAction(null, 'admin', 'freeze_account', { accountNumber: accNum }, req);
    await notifyUser(acc.ownerId, 'Account Frozen', `Your account ${accNum} has been frozen by the administrator. Contact support.`);

    return res.json({ success: true, message: `Account ${accNum} frozen.` });
  } catch (err) {
    return res.status(500).send('Error freezing account.');
  }
});

// Unfreeze Account
app.post('/admin/unfreeze-account', authenticate, requireLogin, requireAdmin, async (req, res) => {
  const { accountNumber } = req.body;
  const accNum = parseInt(accountNumber);
  if (isNaN(accNum)) return res.status(400).send('Invalid account number.');

  try {
    const result = await db.query('UPDATE accounts SET status = $1 WHERE "accountNumber" = $2', ['active', accNum]);
    if (result.rowCount === 0) return res.status(404).send('Account not found.');
    
    const accRes = await db.query('SELECT "ownerId" FROM accounts WHERE "accountNumber" = $1 LIMIT 1', [accNum]);
    const acc = accRes.rows[0];
    await logAction(null, 'admin', 'unfreeze_account', { accountNumber: accNum }, req);
    await notifyUser(acc.ownerId, 'Account Active', `Your account ${accNum} has been un-frozen and is active.`);

    return res.json({ success: true, message: `Account ${accNum} activated.` });
  } catch (err) {
    return res.status(500).send('Error unfreezing account.');
  }
});

// Suspend User
app.post('/admin/suspend-user', authenticate, requireLogin, requireAdmin, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).send('User ID required.');

  try {
    const result = await db.query('UPDATE users SET status = $1, token = NULL WHERE "_id" = $2', ['suspended', userId]);
    if (result.rowCount === 0) return res.status(404).send('User not found.');

    await logAction(null, 'admin', 'suspend_user', { userId }, req);
    return res.json({ success: true, message: 'User suspended.' });
  } catch (err) {
    return res.status(500).send('Error suspending user.');
  }
});

// Activate User
app.post('/admin/activate-user', authenticate, requireLogin, requireAdmin, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).send('User ID required.');

  try {
    const result = await db.query('UPDATE users SET status = $1 WHERE "_id" = $2', ['active', userId]);
    if (result.rowCount === 0) return res.status(404).send('User not found.');

    await logAction(null, 'admin', 'activate_user', { userId }, req);
    return res.json({ success: true, message: 'User status restored to active.' });
  } catch (err) {
    return res.status(500).send('Error activating user.');
  }
});

// User Change Password
app.post('/change-password', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins cannot change user passwords.');

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).send('Current and new passwords are required.');
  }
  if (newPassword.length < 6) {
    return res.status(400).send('New password must be at least 6 characters long.');
  }

  try {
    const userRes = await db.query('SELECT * FROM users WHERE "_id" = $1 LIMIT 1', [req.user._id]);
    const user = userRes.rows[0];
    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      return res.status(400).send('Incorrect current password.');
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password = $1, "passwordPlain" = $2 WHERE "_id" = $3', [hash, newPassword, req.user._id]);
    await logAction(req.user._id, req.user.username, 'change_password', 'Password updated successfully', req);

    return res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Password change error:', err);
    return res.status(500).send('Error changing password.');
  }
});

// Update Preferences (OTP, Notifications)
app.put('/me/preferences', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins do not have preferences.');

  const { otpEnabled, notifyEmail, alertTransfer, alertDeposit, alertWithdraw } = req.body;
  const update = {
    otpEnabled: !!otpEnabled,
    notifyEmail: !!notifyEmail,
    alertTransfer: !!alertTransfer,
    alertDeposit: !!alertDeposit,
    alertWithdraw: !!alertWithdraw
  };

  try {
    await db.query('UPDATE users SET preferences = $1 WHERE "_id" = $2', [JSON.stringify(update), req.user._id]);
    await logAction(req.user._id, req.user.username, 'update_preferences', update, req);

    const userRes = await db.query('SELECT * FROM users WHERE "_id" = $1 LIMIT 1', [req.user._id]);
    const user = userRes.rows[0];
    
    const accountsRes = await db.query('SELECT * FROM accounts WHERE "ownerId" = $1', [user._id]);
    const accounts = accountsRes.rows;
    
    const userOut = { _id: user._id, name: user.name, username: user.username, email: user.email, mobile: user.mobile, role: user.role, status: user.status, accounts, preferences: user.preferences };

    return res.json({ success: true, user: userOut });
  } catch (err) {
    console.error('Preferences update error:', err);
    return res.status(500).send('Error updating preferences.');
  }
});

// Get all FDs for the user
app.get('/fixed-deposits', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins do not have FDs.');
  try {
    const listRes = await db.query('SELECT * FROM "fixedDeposits" WHERE "userId" = $1', [req.user._id]);
    return res.json(listRes.rows);
  } catch (err) {
    return res.status(500).send('Error loading FDs.');
  }
});

// Create a new FD
app.post('/fixed-deposits', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins cannot open FDs.');
  const { accountNumber, amount, durationMonths, interestRate } = req.body;
  const accNum = parseInt(accountNumber);
  const fdAmt = parseFloat(amount);
  const months = parseInt(durationMonths);
  const rate = parseFloat(interestRate);

  if (isNaN(accNum) || isNaN(fdAmt) || fdAmt <= 0 || isNaN(months) || isNaN(rate)) {
    return res.status(400).send('Invalid input parameters.');
  }

  try {
    const accountRes = await db.query('SELECT * FROM accounts WHERE "accountNumber" = $1 LIMIT 1', [accNum]);
    if (accountRes.rowCount === 0) return res.status(404).send('Source account not found.');
    const account = accountRes.rows[0];

    if (account.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).send('Unauthorized account debit.');
    }
    if (account.status === 'frozen') {
      return res.status(403).send('Source account is frozen.');
    }
    if (parseFloat(account.balance) < fdAmt) {
      return res.status(400).send('Insufficient funds to lock FD.');
    }

    // Deduct principal
    const debitResult = await db.query(
      'UPDATE accounts SET balance = balance - $1 WHERE "accountNumber" = $2 AND balance >= $1 AND status = $3',
      [fdAmt, accNum, 'active']
    );

    if (debitResult.rowCount === 0) {
      return res.status(400).send('FD placement failed.');
    }

    // Calculate Maturity Amount: compound quarterly standard FD calculation
    const t = months / 12;
    const r = rate / 100;
    const maturityAmount = fdAmt * Math.pow(1 + r / 4, 4 * t);

    const transactionId = 'TXN-' + uuidv4().slice(0, 8).toUpperCase();
    const txnId = db.generateId();
    const txnDate = new Date();
    await db.query(
      `INSERT INTO transactions ("_id", "transactionId", type, "accountNumber", amount, description, status, "performedBy", date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [txnId, transactionId, 'withdrawal', accNum, fdAmt, `Locked FD for ${months} Months`, 'success', req.user.username, txnDate]
    );

    const maturesAt = new Date();
    maturesAt.setMonth(maturesAt.getMonth() + months);

    const fdId = db.generateId();
    const newFD = {
      _id: fdId,
      userId: req.user._id,
      accountNumber: accNum,
      principal: fdAmt,
      interestRate: rate,
      durationMonths: months,
      maturityAmount: parseFloat(maturityAmount.toFixed(2)),
      status: 'active',
      createdAt: new Date(),
      maturesAt
    };

    await db.query(
      `INSERT INTO "fixedDeposits" ("_id", "userId", "accountNumber", principal, "interestRate", "durationMonths", "maturityAmount", status, "createdAt", "maturesAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [fdId, req.user._id, accNum, fdAmt, rate, months, newFD.maturityAmount, 'active', newFD.createdAt, maturesAt]
    );

    await logAction(req.user._id, req.user.username, 'create_fd', { principal: fdAmt, durationMonths: months, maturesAt }, req);
    await notifyUser(req.user._id, 'Fixed Deposit Placed', `Your FD of ₹${fdAmt.toFixed(2)} has been successfully created. Maturity: ₹${newFD.maturityAmount.toFixed(2)} on ${maturesAt.toLocaleDateString()}.`);

    return res.json({ success: true, fixedDeposit: newFD });
  } catch (err) {
    console.error('FD creation error:', err);
    return res.status(500).send('Error creating FD.');
  }
});

// Get all RDs for the user
app.get('/recurring-deposits', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins do not have RDs.');
  try {
    const listRes = await db.query('SELECT * FROM "recurringDeposits" WHERE "userId" = $1', [req.user._id]);
    return res.json(listRes.rows);
  } catch (err) {
    return res.status(500).send('Error loading RDs.');
  }
});

// Create a new RD contract
app.post('/recurring-deposits', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins cannot open RDs.');
  const { accountNumber, monthlyDeposit, durationMonths, interestRate } = req.body;
  const accNum = parseInt(accountNumber);
  const deposit = parseFloat(monthlyDeposit);
  const months = parseInt(durationMonths);
  const rate = parseFloat(interestRate);

  if (isNaN(accNum) || isNaN(deposit) || deposit <= 0 || isNaN(months) || isNaN(rate)) {
    return res.status(400).send('Invalid input parameters.');
  }

  try {
    const accountRes = await db.query('SELECT * FROM accounts WHERE "accountNumber" = $1 LIMIT 1', [accNum]);
    if (accountRes.rowCount === 0) return res.status(404).send('Source account not found.');
    const account = accountRes.rows[0];

    if (account.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).send('Unauthorized account access.');
    }
    if (account.status === 'frozen') {
      return res.status(403).send('Source account is frozen.');
    }
    if (parseFloat(account.balance) < deposit) {
      return res.status(400).send('Insufficient funds for the initial RD deposit.');
    }

    // Debit the first month's payment
    const debitResult = await db.query(
      'UPDATE accounts SET balance = balance - $1 WHERE "accountNumber" = $2 AND balance >= $1 AND status = $3',
      [deposit, accNum, 'active']
    );

    if (debitResult.rowCount === 0) {
      return res.status(400).send('Initial RD payment failed.');
    }

    // RD maturity amount estimated using monthly compounding formula
    const i = (rate / 100) / 12;
    let estimatedMaturity = 0;
    for (let m = 1; m <= months; m++) {
      estimatedMaturity += deposit * Math.pow(1 + i, months - m + 1);
    }

    const transactionId = 'TXN-' + uuidv4().slice(0, 8).toUpperCase();
    const txnId = db.generateId();
    const txnDate = new Date();
    await db.query(
      `INSERT INTO transactions ("_id", "transactionId", type, "accountNumber", amount, description, status, "performedBy", date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [txnId, transactionId, 'withdrawal', accNum, deposit, `Initial RD Deposit - Month 1`, 'success', req.user.username, txnDate]
    );

    const rdId = db.generateId();
    const newRD = {
      _id: rdId,
      userId: req.user._id,
      accountNumber: accNum,
      monthlyDeposit: deposit,
      interestRate: rate,
      durationMonths: months,
      totalPaid: deposit,
      monthsPaid: 1,
      estimatedMaturity: parseFloat(estimatedMaturity.toFixed(2)),
      status: 'active',
      createdAt: new Date(),
      lastPaymentDate: new Date()
    };

    await db.query(
      `INSERT INTO "recurringDeposits" ("_id", "userId", "accountNumber", "monthlyDeposit", "interestRate", "durationMonths", "totalPaid", "monthsPaid", "estimatedMaturity", status, "createdAt", "lastPaymentDate")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [rdId, req.user._id, accNum, deposit, rate, months, deposit, 1, newRD.estimatedMaturity, 'active', newRD.createdAt, newRD.lastPaymentDate]
    );

    await logAction(req.user._id, req.user.username, 'create_rd', { monthlyDeposit: deposit, durationMonths: months }, req);
    await notifyUser(req.user._id, 'Recurring Deposit Started', `Your RD of ₹${deposit.toFixed(2)}/month has started. Estimated maturity: ₹${newRD.estimatedMaturity.toFixed(2)}.`);

    return res.json({ success: true, recurringDeposit: newRD });
  } catch (err) {
    console.error('RD creation error:', err);
    return res.status(500).send('Error creating RD.');
  }
});

// Pay monthly installment for RD
app.post('/recurring-deposits/:id/pay', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins cannot make RD payments.');
  
  try {
    const rdRes = await db.query('SELECT * FROM "recurringDeposits" WHERE "_id" = $1 AND "userId" = $2 LIMIT 1', [req.params.id, req.user._id]);
    if (rdRes.rowCount === 0) return res.status(404).send('RD contract not found.');
    const rd = rdRes.rows[0];

    if (rd.status !== 'active') return res.status(400).send('RD is no longer active.');

    const accountRes = await db.query('SELECT * FROM accounts WHERE "accountNumber" = $1 LIMIT 1', [rd.accountNumber]);
    if (accountRes.rowCount === 0) return res.status(404).send('Associated account not found.');
    const account = accountRes.rows[0];

    if (account.status === 'frozen') return res.status(403).send('Associated account is frozen.');
    if (parseFloat(account.balance) < parseFloat(rd.monthlyDeposit)) {
      return res.status(400).send('Insufficient funds for monthly RD payment.');
    }

    const debitResult = await db.query(
      'UPDATE accounts SET balance = balance - $1 WHERE "accountNumber" = $2 AND balance >= $1 AND status = $3',
      [rd.monthlyDeposit, rd.accountNumber, 'active']
    );

    if (debitResult.rowCount === 0) {
      return res.status(400).send('RD payment failed.');
    }

    const nextPaid = rd.monthsPaid + 1;
    const isCompleted = nextPaid >= rd.durationMonths;
    
    let updateText = 'UPDATE "recurringDeposits" SET "totalPaid" = "totalPaid" + $1, "monthsPaid" = "monthsPaid" + 1, "lastPaymentDate" = $2';
    const params = [rd.monthlyDeposit, new Date(), rd._id];
    
    if (isCompleted) {
      updateText += ', status = \'completed\'';
    }
    updateText += ' WHERE "_id" = $3';

    await db.query(updateText, params);

    const transactionId = 'TXN-' + uuidv4().slice(0, 8).toUpperCase();
    const txnId = db.generateId();
    const txnDate = new Date();
    await db.query(
      `INSERT INTO transactions ("_id", "transactionId", type, "accountNumber", amount, description, status, "performedBy", date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [txnId, transactionId, 'withdrawal', rd.accountNumber, rd.monthlyDeposit, `RD Installment - Month ${nextPaid}`, 'success', req.user.username, txnDate]
    );

    await logAction(req.user._id, req.user.username, 'rd_payment', { rdId: rd._id, installment: nextPaid }, req);
    
    if (isCompleted) {
      await db.query('UPDATE accounts SET balance = balance + $1 WHERE "accountNumber" = $2', [rd.estimatedMaturity, rd.accountNumber]);
      const creditTxnId = 'TXN-' + uuidv4().slice(0, 8).toUpperCase();
      const creditId = db.generateId();
      await db.query(
        `INSERT INTO transactions ("_id", "transactionId", type, "accountNumber", amount, description, status, "performedBy", date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [creditId, creditTxnId, 'deposit', rd.accountNumber, rd.estimatedMaturity, `RD Maturity Credit`, 'success', 'system', new Date()]
      );
      await notifyUser(req.user._id, 'Recurring Deposit Matured', `Your RD contract is complete. Maturity funds of ₹${rd.estimatedMaturity.toFixed(2)} credited back to account ${rd.accountNumber}.`);
    } else {
      await notifyUser(req.user._id, 'RD Installment Paid', `RD installment for month ${nextPaid} (₹${rd.monthlyDeposit.toFixed(2)}) processed.`);
    }

    return res.json({ success: true, completed: isCompleted });
  } catch (err) {
    console.error('RD payment error:', err);
    return res.status(500).send('Error processing RD payment.');
  }
});

// Get user loans
app.get('/loans', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins do not have loans.');
  try {
    const listRes = await db.query('SELECT * FROM loans WHERE "userId" = $1', [req.user._id]);
    return res.json(listRes.rows);
  } catch (err) {
    return res.status(500).send('Error loading loans.');
  }
});

// Apply for a loan
app.post('/loans', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins cannot apply for loans.');
  const { amount, durationMonths, interestRate, purpose, targetAccount } = req.body;
  const loanAmt = parseFloat(amount);
  const months = parseInt(durationMonths);
  const rate = parseFloat(interestRate);
  const targetAcc = parseInt(targetAccount);

  if (isNaN(loanAmt) || loanAmt <= 0 || isNaN(months) || months <= 0 || isNaN(rate) || isNaN(targetAcc)) {
    return res.status(400).send('Invalid loan request parameters.');
  }

  try {
    const accountRes = await db.query('SELECT * FROM accounts WHERE "accountNumber" = $1 AND "ownerId" = $2 LIMIT 1', [targetAcc, req.user._id]);
    if (accountRes.rowCount === 0) return res.status(400).send('Invalid target account.');

    const r = (rate / 100) / 12;
    const emi = loanAmt * (r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);

    const loanId = db.generateId();
    const newLoan = {
      _id: loanId,
      userId: req.user._id,
      amount: loanAmt,
      durationMonths: months,
      interestRate: rate,
      monthlyEmi: parseFloat(emi.toFixed(2)),
      purpose,
      targetAccount: targetAcc,
      status: 'pending',
      createdAt: new Date(),
      reviewedAt: null,
      reviewRemarks: ''
    };

    await db.query(
      `INSERT INTO loans ("_id", "userId", amount, "durationMonths", "interestRate", "monthlyEmi", purpose, "targetAccount", status, "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [loanId, req.user._id, loanAmt, months, rate, newLoan.monthlyEmi, purpose, targetAcc, 'pending', newLoan.createdAt]
    );

    await logAction(req.user._id, req.user.username, 'apply_loan', { amount: loanAmt, purpose }, req);
    await notifyUser(req.user._id, 'Loan Application Submitted', `Your loan application of ₹${loanAmt.toFixed(2)} is pending review.`);

    return res.json({ success: true, loan: newLoan });
  } catch (err) {
    return res.status(500).send('Error applying for loan.');
  }
});

// Admin Review a loan
app.post('/admin/loans/:id/review', authenticate, requireLogin, requireAdmin, async (req, res) => {
  const { action, remarks } = req.body;
  if (!['approved', 'rejected'].includes(action)) {
    return res.status(400).send('Invalid loan review action.');
  }

  try {
    const loanRes = await db.query('SELECT * FROM loans WHERE "_id" = $1 LIMIT 1', [req.params.id]);
    if (loanRes.rowCount === 0) return res.status(404).send('Loan application not found.');
    const loan = loanRes.rows[0];

    if (loan.status !== 'pending') return res.status(400).send('Loan is already reviewed.');

    const reviewedAt = new Date();
    await db.query(
      'UPDATE loans SET status = $1, "reviewedAt" = $2, "reviewRemarks" = $3 WHERE "_id" = $4',
      [action, reviewedAt, remarks || '', loan._id]
    );

    if (action === 'approved') {
      await db.query('UPDATE accounts SET balance = balance + $1 WHERE "accountNumber" = $2', [loan.amount, loan.targetAccount]);

      const transactionId = 'TXN-' + uuidv4().slice(0, 8).toUpperCase();
      const txnId = db.generateId();
      await db.query(
        `INSERT INTO transactions ("_id", "transactionId", type, "accountNumber", amount, description, status, "performedBy", date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [txnId, transactionId, 'deposit', loan.targetAccount, loan.amount, `Approved Loan Credit`, 'success', 'admin', new Date()]
      );

      await notifyUser(loan.userId, 'Loan Approved', `Congratulations! Your loan of ₹${loan.amount.toFixed(2)} has been approved and credited. EMI: ₹${loan.monthlyEmi.toFixed(2)}/mo.`);
      await logAction(null, 'admin', 'approve_loan', { loanId: loan._id, amount: loan.amount }, req);
    } else {
      await notifyUser(loan.userId, 'Loan Application Rejected', `Your loan application of ₹${loan.amount.toFixed(2)} was rejected. Remarks: ${remarks || 'None'}`);
      await logAction(null, 'admin', 'reject_loan', { loanId: loan._id, amount: loan.amount }, req);
    }

    return res.json({ success: true, status: action });
  } catch (err) {
    console.error('Error reviewing loan:', err);
    return res.status(500).send('Error reviewing loan.');
  }
});

// Analytics endpoint
app.get('/analytics/summary', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins do not have personal analytics.');

  try {
    const accountsRes = await db.query('SELECT * FROM accounts WHERE "ownerId" = $1', [req.user._id]);
    const accounts = accountsRes.rows;
    const accNums = accounts.map(a => a.accountNumber);

    if (accNums.length === 0) {
      return res.json({ success: true, totalSpending: 0, totalIncome: 0, totalBalance: 0 });
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const transactionsRes = await db.query(
      `SELECT * FROM transactions
       WHERE "accountNumber" = ANY($1)
          OR "fromAccount" = ANY($1)
          OR "toAccount" = ANY($1)`,
      [accNums]
    );
    const transactions = transactionsRes.rows;

    let totalSpending = 0;
    let totalIncome = 0;

    transactions.forEach(t => {
      const isThisMonth = new Date(t.date) >= startOfMonth;
      if (isThisMonth) {
        if (t.type === 'deposit') {
          totalIncome += t.amount;
        } else if (t.type === 'withdrawal') {
          totalSpending += t.amount;
        } else if (t.type === 'transfer') {
          const isSender = accNums.includes(t.fromAccount);
          if (isSender) {
            totalSpending += t.amount;
          } else {
            totalIncome += t.amount;
          }
        }
      }
    });

    return res.json({
      success: true,
      totalSpending,
      totalIncome,
      totalBalance: accounts.reduce((sum, a) => sum + parseFloat(a.balance), 0)
    });
  } catch (err) {
    return res.status(500).send('Error loading analytics.');
  }
});

// Get transactions for selected month/year
app.get('/transactions/monthly', authenticate, requireLogin, async (req, res) => {
  const { month, year, accountNumber } = req.query;
  const targetMonth = parseInt(month);
  const targetYear = parseInt(year);
  const accNum = parseInt(accountNumber);

  if (isNaN(targetMonth) || isNaN(targetYear) || isNaN(accNum)) {
    return res.status(400).send('Invalid query parameters.');
  }

  try {
    const accountRes = await db.query('SELECT * FROM accounts WHERE "accountNumber" = $1 LIMIT 1', [accNum]);
    if (accountRes.rowCount === 0) return res.status(404).send('Account not found.');
    const account = accountRes.rows[0];
    
    if (!req.isAdmin && account.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).send('Unauthorized access to account logs.');
    }

    const startDate = new Date(targetYear, targetMonth, 1);
    const endDate = new Date(targetYear, targetMonth + 1, 1);

    const listRes = await db.query(
      `SELECT * FROM transactions
       WHERE ( "accountNumber" = $1 OR "fromAccount" = $1 OR "toAccount" = $1 )
         AND date >= $2 AND date < $3`,
      [accNum, startDate, endDate]
    );

    return res.json(listRes.rows);
  } catch (err) {
    return res.status(500).send('Error loading monthly transactions.');
  }
});

// Raw Database Viewer for Admin Inspection
app.get('/admin/raw-db', authenticate, requireLogin, requireAdmin, async (req, res) => {
  try {
    const users = (await db.query('SELECT * FROM users')).rows;
    const accounts = (await db.query('SELECT * FROM accounts')).rows;
    const transactions = (await db.query('SELECT * FROM transactions')).rows;
    const beneficiaries = (await db.query('SELECT * FROM beneficiaries')).rows;
    const otps = (await db.query('SELECT * FROM otps')).rows;
    const notifications = (await db.query('SELECT * FROM notifications')).rows;
    const auditLogs = (await db.query('SELECT * FROM "auditLogs"')).rows;
    const fixedDeposits = (await db.query('SELECT * FROM "fixedDeposits"')).rows;
    const recurringDeposits = (await db.query('SELECT * FROM "recurringDeposits"')).rows;
    const loans = (await db.query('SELECT * FROM loans')).rows;
    const scheduledTransfers = (await db.query('SELECT * FROM "scheduledTransfers"')).rows;

    return res.json({
      users,
      accounts,
      transactions,
      beneficiaries,
      otps,
      notifications,
      auditLogs,
      fixedDeposits,
      recurringDeposits,
      loans,
      scheduledTransfers
    });
  } catch (err) {
    console.error('Error in /admin/raw-db:', err);
    return res.status(500).send('Error loading raw database collections.');
  }
});

// Scheduled Transfer Routes

app.post('/transfers/schedule', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins cannot schedule transfers.');

  const { from, to, amount, description, scheduledDate } = req.body;
  const fromAcc = parseInt(from);
  const toAcc = parseInt(to);
  const tfAmt = parseFloat(amount);
  
  if (isNaN(fromAcc) || isNaN(toAcc) || isNaN(tfAmt) || tfAmt <= 0 || !scheduledDate) {
    return res.status(400).send('All fields are required and amount must be positive.');
  }

  const executionDate = new Date(scheduledDate);
  if (isNaN(executionDate.getTime()) || executionDate <= new Date()) {
    return res.status(400).send('Invalid execution date. Must be set in the future.');
  }

  try {
    const senderRes = await db.query('SELECT * FROM accounts WHERE "accountNumber" = $1 AND "ownerId" = $2 LIMIT 1', [fromAcc, req.user._id]);
    const receiverRes = await db.query('SELECT * FROM accounts WHERE "accountNumber" = $1 LIMIT 1', [toAcc]);

    if (senderRes.rowCount === 0) return res.status(400).send('Invalid funding account.');
    if (receiverRes.rowCount === 0) return res.status(400).send('Recipient account not found.');
    
    const senderAcc = senderRes.rows[0];
    const receiverAcc = receiverRes.rows[0];

    if (fromAcc === toAcc) return res.status(400).send('Cannot transfer to the same account.');
    if (senderAcc.status === 'frozen') return res.status(400).send('Funding account is frozen.');

    const schedId = db.generateId();
    const newScheduled = {
      _id: schedId,
      userId: req.user._id,
      fromAccount: fromAcc,
      toAccount: toAcc,
      amount: tfAmt,
      description: description || 'Scheduled Wire',
      scheduledDate: executionDate,
      status: 'pending',
      createdAt: new Date()
    };

    await db.query(
      `INSERT INTO "scheduledTransfers" ("_id", "userId", "fromAccount", "toAccount", amount, description, "scheduledDate", status, "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [schedId, req.user._id, fromAcc, toAcc, tfAmt, newScheduled.description, executionDate, 'pending', newScheduled.createdAt]
    );

    await logAction(req.user._id, req.user.username, 'schedule_transfer', { from: fromAcc, to: toAcc, amount: tfAmt, date: executionDate }, req);
    await notifyUser(req.user._id, 'Transfer Scheduled', `A transfer of ₹${tfAmt.toFixed(2)} to Account ${toAcc} has been scheduled for ${executionDate.toLocaleDateString()}.`);

    return res.json({ success: true, message: `Successfully scheduled transfer for ${executionDate.toLocaleDateString()}.`, transfer: newScheduled });
  } catch (err) {
    console.error('Schedule transfer error:', err);
    return res.status(500).send('Error scheduling transfer.');
  }
});

app.get('/transfers/scheduled', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins do not have personal scheduled transfers.');
  try {
    const listRes = await db.query('SELECT * FROM "scheduledTransfers" WHERE "userId" = $1 ORDER BY "scheduledDate" ASC', [req.user._id]);
    return res.json(listRes.rows);
  } catch (err) {
    return res.status(500).send('Error loading scheduled transfers.');
  }
});

app.delete('/transfers/scheduled/:id', authenticate, requireLogin, async (req, res) => {
  if (req.isAdmin) return res.status(403).send('Admins cannot cancel scheduled transfers directly.');
  try {
    const transferRes = await db.query('SELECT * FROM "scheduledTransfers" WHERE "_id" = $1 AND "userId" = $2 LIMIT 1', [req.params.id, req.user._id]);
    if (transferRes.rowCount === 0) return res.status(404).send('Scheduled transfer not found.');
    const transfer = transferRes.rows[0];

    if (transfer.status !== 'pending') return res.status(400).send('Only pending transfers can be cancelled.');

    await db.query('DELETE FROM "scheduledTransfers" WHERE "_id" = $1', [transfer._id]);
    await logAction(req.user._id, req.user.username, 'cancel_scheduled_transfer', { id: transfer._id }, req);
    await notifyUser(req.user._id, 'Scheduled Transfer Cancelled', `Your scheduled transfer of ₹${transfer.amount.toFixed(2)} to Account ${transfer.toAccount} has been cancelled.`);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).send('Error cancelling scheduled transfer.');
  }
});

app.get('/admin/transfers/scheduled', authenticate, requireLogin, requireAdmin, async (req, res) => {
  try {
    const listRes = await db.query('SELECT * FROM "scheduledTransfers" ORDER BY "scheduledDate" ASC');
    return res.json(listRes.rows);
  } catch (err) {
    return res.status(500).send('Error loading system-wide scheduled transfers.');
  }
});

// Background Scheduled Transfers processing helpers

async function processScheduledTransfers() {
  try {
    const now = new Date();
    const pendingTransfersRes = await db.query(
      'SELECT * FROM "scheduledTransfers" WHERE status = $1 AND "scheduledDate" <= $2',
      ['pending', now]
    );

    for (const transfer of pendingTransfersRes.rows) {
      await executeScheduledTransfer(transfer);
    }
  } catch (err) {
    console.error("Error in scheduled transfer execution thread:", err);
  }
}

async function executeScheduledTransfer(transfer) {
  const { _id, fromAccount, toAccount, amount, description, userId } = transfer;
  const transactionId = 'TXN-' + uuidv4().slice(0, 8).toUpperCase();

  try {
    const senderRes = await db.query('SELECT * FROM accounts WHERE "accountNumber" = $1 LIMIT 1', [fromAccount]);
    const receiverRes = await db.query('SELECT * FROM accounts WHERE "accountNumber" = $1 LIMIT 1', [toAccount]);

    if (senderRes.rowCount === 0) {
      throw new Error('Sender account not found.');
    }
    if (receiverRes.rowCount === 0) {
      throw new Error('Recipient account not found.');
    }
    
    const senderAcc = senderRes.rows[0];
    const receiverAcc = receiverRes.rows[0];

    if (senderAcc.status === 'frozen') {
      throw new Error('Sender account is frozen.');
    }
    if (parseFloat(senderAcc.balance) < parseFloat(amount)) {
      throw new Error('Insufficient balance.');
    }

    const debitResult = await db.query(
      'UPDATE accounts SET balance = balance - $1 WHERE "accountNumber" = $2 AND balance >= $1 AND status = $3',
      [amount, fromAccount, 'active']
    );

    if (debitResult.rowCount === 0) {
      throw new Error('Debit failed (account frozen or insufficient funds).');
    }

    const creditResult = await db.query(
      'UPDATE accounts SET balance = balance + $1 WHERE "accountNumber" = $2',
      [amount, toAccount]
    );

    if (creditResult.rowCount === 0) {
      await db.query(
        'UPDATE accounts SET balance = balance + $1 WHERE "accountNumber" = $2',
        [amount, fromAccount]
      );
      throw new Error('Credit failed (invalid recipient account).');
    }

    const txnId = db.generateId();
    const txnDate = new Date();
    await db.query(
      `INSERT INTO transactions ("_id", "transactionId", type, "fromAccount", "toAccount", amount, description, status, "performedBy", date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [txnId, transactionId, 'transfer', fromAccount, toAccount, amount, `[Scheduled] ${description || 'Future Wire'}`, 'success', 'system', txnDate]
    );

    await db.query(
      'UPDATE "scheduledTransfers" SET status = $1, "transactionId" = $2, "executedAt" = $3 WHERE "_id" = $4',
      ['executed', transactionId, new Date(), _id]
    );

    await notifyUser(senderAcc.ownerId, 'Scheduled Transfer Executed', `Your scheduled transfer of ₹${parseFloat(amount).toFixed(2)} to Account ${toAccount} succeeded. (Ref: ${transactionId})`);
    await notifyUser(receiverAcc.ownerId, 'Scheduled Transfer Received', `You received ₹${parseFloat(amount).toFixed(2)} from Account ${fromAccount} via scheduled transfer. (Ref: ${transactionId})`);
    await logAction(senderAcc.ownerId, 'system', 'execute_scheduled_transfer', { from: fromAccount, to: toAccount, amount, transactionId }, null);

  } catch (err) {
    console.error(`Scheduled transfer ${_id} failed:`, err.message);
    await db.query(
      'UPDATE "scheduledTransfers" SET status = $1, "failureReason" = $2, "failedAt" = $3 WHERE "_id" = $4',
      ['failed', err.message, new Date(), _id]
    );
    await notifyUser(userId, 'Scheduled Transfer Failed', `Your scheduled transfer of ₹${parseFloat(amount).toFixed(2)} to Account ${toAccount} failed. Reason: ${err.message}`);
    await logAction(userId, 'system', 'failed_scheduled_transfer', { from: fromAccount, to: toAccount, amount, reason: err.message }, null);
  }
}
