const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not found in .env');
  process.exit(2);
}

(async () => {
  try {
    await mongoose.connect(uri, { dbName: process.env.MONGO_INITDB_DATABASE });
    const db = mongoose.connection.db;

    const instanceId = process.argv[2];
    if (!instanceId) { console.error('Usage: node dump_journals_for_instance.js <instanceId>'); process.exit(2); }

    const ObjectId = require('mongodb').ObjectId;
    let objId;
    try { objId = new ObjectId(instanceId); } catch(e){ console.error('Invalid ObjectId'); process.exit(2); }

    const journals = await db.collection('agent_journals').find({ agentInstanceId: objId }).sort({ timestamp: 1 }).limit(200).toArray().catch(()=>[]);
    console.log(`Found ${journals.length} journal entries for instance ${instanceId}`);
    if (journals.length > 0) {
      const sample = journals.slice(-20).map(j => ({ id: j._id, type: j.type, timestamp: j.timestamp, payloadSnippet: JSON.stringify(j.payload).slice(0,200) }));
      console.log('Last entries sample:', JSON.stringify(sample, null, 2));
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error querying mongo:', err);
    try { await mongoose.disconnect(); } catch(e){}
    process.exit(1);
  }
})();
