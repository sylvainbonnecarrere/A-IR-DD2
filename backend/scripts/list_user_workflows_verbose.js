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
    const nameFilter = process.argv[3] || 'Mistar';

    const user = await db.collection('users').findOne({ email });
    console.log('User found:', !!user, user ? { _id: user._id, email: user.email } : null);
    if (!user) {
      console.log('No user found, exiting.');
      await mongoose.disconnect();
      process.exit(0);
    }

    const userId = user._id;
    const workflows = await db.collection('workflows').find({ userId }).toArray().catch(()=>[]);
    console.log(`Found ${workflows.length} workflows for user`);

    for (const wf of workflows) {
      console.log('--- Workflow ---');
      console.log({ id: wf._id, name: wf.name || wf.title || wf.meta?.name || wf.workflowName || null });

      // Find nodes in workflownodev2 referencing this workflow (try both ObjectId and string forms)
      let nodesObj = [];
      try {
        nodesObj = await db.collection('workflownodev2').find({ workflowId: new (require('mongodb').ObjectId)(wf._id) }).toArray().catch(()=>[]);
      } catch(e) { nodesObj = []; }
      const idStr = wf._id.toString ? wf._id.toString() : String(wf._id);
      const nodesStr = await db.collection('workflownodev2').find({ workflowId: idStr }).toArray().catch(()=>[]);
      const nodes = nodesObj.length >= nodesStr.length ? nodesObj : nodesStr;
      console.log(`Nodes found (objectId match: ${nodesObj.length}, string match: ${nodesStr.length}): ${nodes.length}`);

      // Search for agent references or the nameFilter in node data
      const matches = [];
      for (const n of nodes) {
        const dataStr = JSON.stringify(n.data || {}).toLowerCase();
        if (dataStr.includes(nameFilter.toLowerCase()) || (n.name && n.name.toLowerCase().includes(nameFilter.toLowerCase()))) {
          matches.push({ nodeId: n._id || n.id || null, name: n.name || null, dataSnippet: JSON.stringify(n.data).slice(0,300) });
        }
      }

      console.log(`Nodes matching '${nameFilter}': ${matches.length}`);
      if (matches.length > 0) console.log(JSON.stringify(matches, null, 2));
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error querying mongo:', err);
    try { await mongoose.disconnect(); } catch(e){}
    process.exit(1);
  }
})();
