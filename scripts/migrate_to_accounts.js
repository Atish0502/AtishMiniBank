require('dotenv').config();
const { MongoClient } = require('mongodb');

const url = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";

async function run() {
  const client = new MongoClient(url);
  try {
    await client.connect();
    const db = client.db('bankDB');
    
    // ensure accounts collection exists
    const users = await db.collection('users').find().toArray();
    let migratedCount = 0;
    
    for (const user of users) {
      if (user.accountNumber !== undefined && user.accountNumber !== null) {
        // Check if an account already exists
        const existing = await db.collection('accounts').findOne({ accountNumber: user.accountNumber });
        if (!existing) {
          await db.collection('accounts').insertOne({
            ownerId: user._id,
            accountNumber: user.accountNumber,
            type: "Savings",
            balance: typeof user.balance === 'number' ? user.balance : 0
          });
          migratedCount++;
        }
      }
    }
    console.log(`Migrated ${migratedCount} accounts from users collection.`);
    
    // Optionally remove accountNumber and balance from users collection
    /*
    await db.collection('users').updateMany({}, {
      $unset: { accountNumber: "", balance: "" }
    });
    */
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

run();
