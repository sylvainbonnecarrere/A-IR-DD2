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

    const agents = await db.collection('agentinstances').find({ name: 'drag-agent-touch-collision' }).toArray();
    console.log(JSON.stringify({ foundAgentsCount: agents.length, agents }, null, 2));

    if (agents.length > 0) {
      const ids = agents.map(a => a._id);
      const nodes = await db.collection('workflownodev2').find({ instanceId: { $in: ids } }).toArray();
      console.log(JSON.stringify({ foundNodesCount: nodes.length, nodes }, null, 2));
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error querying mongo:', err);
    try { await mongoose.disconnect(); } catch(e){}
    process.exit(1);
  }
})();