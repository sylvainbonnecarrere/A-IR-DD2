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

    const email = process.argv[2] || 'test@test.fr';

    const user = await db.collection('users').findOne({ email });
    console.log('User found:', !!user, user ? { _id: user._id, email: user.email } : null);

    if (!user) {
      console.log('No user found with that email. Searching for any workspace references to the email...');
      // Try searching workflows and agentinstances for email in metadata
      const workflowsByEmail = await db.collection('workflows').find({ 'metadata.userEmail': email }).toArray().catch(()=>[]);
      console.log('workflowsByEmail count:', workflowsByEmail.length);
    } else {
      const userId = user._id;

      const workflows = await db.collection('workflows').find({ userId }).toArray().catch(()=>[]);
      console.log('Workflows for user:', workflows.length);

      const agentInstances = await db.collection('agentinstances').find({ ownerId: userId }).toArray().catch(()=>[]);
      console.log('AgentInstances for user:', agentInstances.length);

      const nodeCount = agentInstances.length > 0 ? await db.collection('workflownodev2').find({ instanceId: { $in: agentInstances.map(a=>a._id) } }).toArray().then(r=>r.length).catch(()=>0) : 0;
      console.log('workflownodev2 nodes referencing instances:', nodeCount);
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error querying mongo:', err);
    try { await mongoose.disconnect(); } catch(e){}
    process.exit(1);
  }
})();
