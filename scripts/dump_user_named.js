const { MongoClient } = require('mongodb');
(async()=>{
  const username = process.argv[2] || 'testuser2';
  const url = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
  const client = new MongoClient(url);
  try{
    await client.connect();
    const db = client.db('bankDB');
    const user = await db.collection('users').findOne({ username });
    if(!user){ console.log('NOT FOUND'); process.exit(0); }
    console.log(JSON.stringify(user, null, 2));
  }catch(e){ console.error(e); process.exit(1); }
  await client.close();
  process.exit(0);
})();