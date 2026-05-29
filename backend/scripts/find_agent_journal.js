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

    const nameQuery = process.argv[2] || process.argv[2] === '' ? process.argv[2] : 'Mistar';
    console.log('Searching agent instances by name (case-insensitive):', nameQuery);

    const agents = await db.collection('agentinstances').find({ name: { $regex: nameQuery, $options: 'i' } }).toArray();
    console.log(JSON.stringify({ foundAgentsCount: agents.length }, null, 2));

    for (const a of agents) {
      console.log('--- Agent Instance ---');
      console.log({ id: a._id, name: a.name, userId: a.ownerId || a.userId || a.user || null, workflowId: a.workflowId || null });

      const journals = await db.collection('agent_journals').find({ agentInstanceId: a._id }).sort({ timestamp: 1 }).toArray();
      console.log(`Found ${journals.length} journal entries for instance ${a._id}`);
      if (journals.length > 0) {
        console.log('Sample last 10 entries:');
        const sample = journals.slice(-10).map(j => ({ id: j._id, type: j.type, timestamp: j.timestamp, payloadSnippet: JSON.stringify(j.payload).slice(0,200) }));
        console.log(JSON.stringify(sample, null, 2));
      }
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error querying mongo:', err);
    try { await mongoose.disconnect(); } catch(e){}
    process.exit(1);
  }
})();
