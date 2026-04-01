const express = require("express");
const { MongoClient } = require("mongodb");

const app = express();
app.use(express.json());
// Serve frontend static files from public/
app.use(express.static("public"));

const url = "mongodb://127.0.0.1:27017";
const client = new MongoClient(url);

let db;

// 🔗 Connect to MongoDB
async function start() {
  await client.connect();
  db = client.db("bankDB");

  app.listen(3000, () => {
    console.log("Server running on port 3000");
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
app.post("/deposit", async (req, res) => {
  const { accountNumber, amount } = req.body;

  if (!accountNumber || amount <= 0) {
    return res.send("Invalid input");
  }

  const result = await db.collection("users").updateOne(
    { accountNumber },
    { $inc: { balance: amount } }
  );

  if (result.matchedCount === 0) {
    return res.send("Account not found");
  }

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

  if (!accountNumber || amount <= 0) {
    return res.send("Invalid input");
  }

  const user = await db.collection("users").findOne({ accountNumber });

  if (!user) {
    return res.send("Account not found");
  }

  if (user.balance < amount) {
    return res.send("Insufficient balance");
  }

  await db.collection("users").updateOne(
    { accountNumber },
    { $inc: { balance: -amount } }
  );

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


// 📜 6. View Transactions
app.get("/transactions", async (req, res) => {
  const data = await db.collection("transactions").find().toArray();
  res.json(data);
});