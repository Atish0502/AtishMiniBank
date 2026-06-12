require('dotenv').config();
const express = require("express");
const { MongoClient } = require("mongodb");
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
// Serve frontend static files from public/
app.use(express.static("public"));

// Support MongoDB Atlas via MONGODB_URI env var, otherwise use local
const url = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'atish1997';
let client;
let db;
let currentAdminToken = null;

// 🔗 Connect to MongoDB with fallback to directConnection when needed
async function start() {
  try {
    client = new MongoClient(url);
    await client.connect();
  } catch (err) {
    console.error('Initial MongoDB connect failed:', err.message || err);
    // Fallback: try direct connection to single-node server
    try {
      console.log('Retrying MongoDB connection with directConnection=true');
      client = new MongoClient(url, { directConnection: true });
      await client.connect();
    } catch (err2) {
      console.error('Direct MongoDB connect failed:', err2.message || err2);
      process.exit(1);
    }
  }

  db = client.db('bankDB');
  console.log('Connected to MongoDB:', process.env.MONGODB_URI ? 'Atlas (MONGODB_URI)' : 'local');

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log('Server running on port', port);
  });
}

start();


// 🟢 1. Create Account
app.post("/create-account", async (req, res) => {
  const { name, accountNumber } = req.body;

  if (!name || !accountNumber) {
    return res.send("Invalid input");
  }

  const existing = await db.collection("users").findOne({ accountNumber });
  if (existing) {
    return res.send("Account already exists");
  }

  await db.collection("users").insertOne({
    name,
    accountNumber,
    balance: 0
  });

  res.send("Account created");
});


// 💰 2. Deposit Money
app.post("/deposit", authenticate, async (req, res) => {
  const { accountNumber, amount } = req.body;
  if (!accountNumber || amount <= 0) return res.send("Invalid input");
  // only admin or owner can deposit
  if(!req.isAdmin && (!req.user || req.user.accountNumber !== accountNumber)) return res.send('Not authorized');
  const result = await db.collection("users").updateOne(
    { accountNumber },
    { $inc: { balance: amount } }
  );
  if (result.matchedCount === 0) return res.send("Account not found");
  await db.collection('transactions').insertOne({ type: 'deposit', account: accountNumber, amount, date: new Date() });
  res.send("Money deposited");
});


// 🔍 3. Check Balance
app.get("/balance/:acc", async (req, res) => {
  const user = await db.collection("users").findOne({
    accountNumber: parseInt(req.params.acc)
  });

  if (!user) {
    return res.send("Account not found");
  }

  res.json({
    name: user.name,
    accountNumber: user.accountNumber,
    balance: user.balance
  });
});


// 💸 4. Withdraw Money
app.post("/withdraw", async (req, res) => {
  const { accountNumber, amount } = req.body;
  if (!accountNumber || amount <= 0) return res.send("Invalid input");
  // only admin or owner can withdraw
  if(!req.isAdmin && (!req.user || req.user.accountNumber !== accountNumber)) return res.send('Not authorized');
  const user = await db.collection("users").findOne({ accountNumber });
  if (!user) return res.send("Account not found");
  if (user.balance < amount) return res.send("Insufficient balance");
  await db.collection("users").updateOne(
    { accountNumber },
    { $inc: { balance: -amount } }
  );
  // record withdrawal
  await db.collection('transactions').insertOne({ type: 'withdraw', account: accountNumber, amount, date: new Date() });
  res.send("Money withdrawn");
});


// 🔄 5. Transfer Money
app.post("/transfer", async (req, res) => {
  const { from, to, amount } = req.body;

  if (!from || !to || amount <= 0) {
    return res.send("Invalid input");
  }

  // Try to use transactions when available (replica set). If not available
  // (common on single-node local MongoDB), fall back to a safe non-transactional
  // flow that uses a conditional update to avoid overdrafts.
  try {
    // ensure authenticated and authorized (owner or admin)
    // Note: we don't have req here because this route wasn't using authenticate; perform a quick token check
    // For simplicity, require a token header
    // (if no token provided, deny)
    // This route will perform an owner check below based on a user lookup from token
    
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        const sender = await db.collection("users").findOne(
          { accountNumber: from },
          { session }
        );

        const receiver = await db.collection("users").findOne(
          { accountNumber: to },
          { session }
        );

        if (!sender || !receiver) {
          throw new Error("Invalid account");
        }

        // authorization: check token from headers
        // admin token check
        const auth = (req && req.headers && req.headers.authorization) ? req.headers.authorization : '';
        let isAdminLoc = false;
        let userFromToken = null;
        if(auth && auth.startsWith('Bearer ')){
          const token = auth.slice(7).trim();
          if(token && currentAdminToken && token === currentAdminToken){ isAdminLoc = true; }
          else {
            const u = await db.collection('users').findOne({ token });
            if(u) userFromToken = u;
          }
        }

        if(!isAdminLoc){
          if(!userFromToken || userFromToken.accountNumber !== from){
            throw new Error('Not authorized');
          }
        }

        if (sender.balance < amount) {
          throw new Error("Insufficient balance");
        }

        await db.collection("users").updateOne(
          { accountNumber: from },
          { $inc: { balance: -amount } },
          { session }
        );

        await db.collection("users").updateOne(
          { accountNumber: to },
          { $inc: { balance: amount } },
          { session }
        );

        await db.collection("transactions").insertOne(
          { from, to, amount, date: new Date() },
          { session }
        );
      });

      return res.send("Transfer successful");
    } finally {
      await session.endSession();
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    // If transactions are not supported (single-node MongoDB), fall back
    // to a non-transactional but safer approach using a conditional update.
    if (
      msg.includes("replica set") ||
      msg.includes("Transaction numbers are only allowed") ||
      msg.includes("transactions are not supported")
    ) {
      try {
        const sender = await db.collection("users").findOne({ accountNumber: from });
        const receiver = await db.collection("users").findOne({ accountNumber: to });

        if (!sender || !receiver) {
          return res.send("Invalid account");
        }

        // perform authorization for non-transactional fallback
        const auth = (req && req.headers && req.headers.authorization) ? req.headers.authorization : '';
        let isAdminLoc = false;
        let userFromToken = null;
        if(auth && auth.startsWith('Bearer ')){
          const token = auth.slice(7).trim();
          if(token && currentAdminToken && token === currentAdminToken){ isAdminLoc = true; }
          else { userFromToken = await db.collection('users').findOne({ token }); }
        }
        if(!isAdminLoc){ if(!userFromToken || userFromToken.accountNumber !== from) return res.send('Not authorized'); }

        if (sender.balance < amount) {
          return res.send("Insufficient balance");
        }

        // Deduct from sender only if they have enough balance (atomic check)
        const r = await db.collection("users").updateOne(
          { accountNumber: from, balance: { $gte: amount } },
          { $inc: { balance: -amount } }
        );

        if (r.matchedCount === 0 || r.modifiedCount === 0) {
          return res.send("Insufficient balance");
        }

        // Credit receiver
        await db.collection("users").updateOne(
          { accountNumber: to },
          { $inc: { balance: amount } }
        );

        // Record transaction
        await db.collection("transactions").insertOne({ from, to, amount, date: new Date() });

        return res.send("Transfer successful (no transaction)");
      } catch (e2) {
        return res.send(e2.message || String(e2));
      }
    }

    return res.send(msg);
  }
});


// 📜 6. View Transactions (protected)
app.get("/transactions", authenticate, async (req, res) => {
  if(req.isAdmin){
    const data = await db.collection("transactions").find().toArray();
    return res.json(data);
  }
  if(req.user){
    const acc = req.user.accountNumber;
    const data = await db.collection("transactions").find({ $or: [ { from: acc }, { to: acc }, { account: acc } ] }).toArray();
    return res.json(data);
  }
  return res.send('Not authorized');
});

// --- Authentication / Signup / Admin ---
// Signup: hash password, create token
app.post('/signup', async (req, res) => {
  const { name, username, password, accountNumber } = req.body;
  if (!username || !password || !accountNumber) return res.send('Invalid input');
  const existing = await db.collection('users').findOne({ $or: [{ username }, { accountNumber }] });
  if (existing) return res.send('User or account already exists');
  const hash = await bcrypt.hash(password, 10);
  const token = uuidv4();
  await db.collection('users').insertOne({ name: name||username, username, password: hash, accountNumber, balance: 0, token });
  res.json({ success: true, token, user: { name: name||username, username, accountNumber } });
});

// Login (user)
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.send('Invalid input');
  const user = await db.collection('users').findOne({ username });
  if (!user) return res.send('Invalid credentials');
  const ok = await bcrypt.compare(password, user.password);
  if(!ok) return res.send('Invalid credentials');
  if(!user.token){ const t = uuidv4(); await db.collection('users').updateOne({ _id: user._id }, { $set: { token: t } }); user.token = t; }
  const safe = { name: user.name, username: user.username, accountNumber: user.accountNumber, balance: user.balance };
  res.json({ success: true, user: safe, token: user.token });
});

// Admin login (single password)
app.post('/admin-login', async (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD){
    currentAdminToken = uuidv4();
    return res.json({ admin: true, token: currentAdminToken });
  }
  return res.send('Invalid admin password');
});

// User-specific transactions (protected)
app.get('/my-transactions/:acc', authenticate, async (req, res) => {
  const acc = isNaN(Number(req.params.acc)) ? req.params.acc : Number(req.params.acc);
  if(!req.isAdmin && (!req.user || req.user.accountNumber !== acc)) return res.send('Not authorized');
  const data = await db.collection('transactions').find({ $or: [ { from: acc }, { to: acc }, { account: acc } ] }).toArray();
  res.json(data);
});

// Auth middleware
async function authenticate(req, res, next){
  const auth = req.headers.authorization || '';
  if(auth.startsWith('Bearer ')){
    const token = auth.slice(7).trim();
    if(token && currentAdminToken && token === currentAdminToken){
      req.isAdmin = true;
      return next();
    }
    const user = await db.collection('users').findOne({ token });
    if(user){ req.user = user; return next(); }
  }
  // no auth, continue but without user/admin
  return next();
}
