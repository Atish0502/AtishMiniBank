const { MongoClient } = require('mongodb');
(async()=>{
  const url = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
  const client = new MongoClient(url);
  try{
    await client.connect();
    const db = client.db('bankDB');
    const filter = { $or: [ { email: { $exists: false } }, { mobile: { $exists: false } } ] };
    const update = { $set: { email: null, mobile: null } };
    const res = await db.collection('users').updateMany(filter, update);
    console.log('Matched:', res.matchedCount, 'Modified:', res.modifiedCount);
    const sample = await db.collection('users').findOne({ username: 'testuser2' });
    console.log('testuser2:', JSON.stringify(sample, null, 2));
  }catch(e){ console.error(e); process.exit(1); }
  await client.close();
  process.exit(0);
})();