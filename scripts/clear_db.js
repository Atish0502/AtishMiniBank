const { MongoClient } = require('mongodb');
(async()=>{
  const url = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
  const client = new MongoClient(url);
  try{
    await client.connect();
    const db = client.db('bankDB');
    const cols = ['users', 'accounts', 'transactions', 'beneficiaries', 'otps', 'auditLogs', 'notifications'];
    for(const c of cols){
      const found = (await db.listCollections({ name: c }).toArray()).length > 0;
      if(found){
        const r = await db.collection(c).deleteMany({});
        console.log(`Cleared ${c}: deleted ${r.deletedCount}`);
      } else {
        console.log(`Collection ${c} not found`);
      }
    }
    // show counts
    for(const c of cols){
      const cnt = (await db.listCollections({ name: c }).toArray()).length > 0 ? await db.collection(c).countDocuments() : 0;
      console.log(`Count ${c}: ${cnt}`);
    }
  }catch(e){ console.error(e); process.exit(1); }
  await client.close();
  process.exit(0);
})();