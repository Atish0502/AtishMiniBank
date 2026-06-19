const { MongoClient } = require('mongodb');
(async()=>{
  const url = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
  const client = new MongoClient(url);
  try{
    await client.connect();
    const db = client.db('bankDB');
    const users = await db.collection('users').find().toArray();
    const accounts = await db.collection('accounts').find().toArray();
    console.log("=== USERS ===");
    console.log(JSON.stringify(users, null, 2));
    console.log("=== ACCOUNTS ===");
    console.log(JSON.stringify(accounts, null, 2));
  }catch(e){ console.error(e); process.exit(1); }
  await client.close();
  process.exit(0);
})();