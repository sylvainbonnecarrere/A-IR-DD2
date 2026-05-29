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

    const workflowIdArg = process.argv[2];
    const nameQuery = process.argv[3] || 'Mistar';
    if (!workflowIdArg) { console.error('Usage: node search_mistar_across_collections.js <workflowId> [name]'); process.exit(2); }

    const ObjectId = require('mongodb').ObjectId;
    let objId;
    try { objId = new ObjectId(workflowIdArg); } catch(e) { objId = null; }
    const idStr = workflowIdArg.toString();

    const collectionsToCheck = [
      'workflow_nodes_v2', 'workflow_nodes',
      'agent_instances', 'agent_instances_v2', 'agentinstances', 'agents'
    ];

    for (const col of collectionsToCheck) {
      try {
        const c = db.collection(col);
        // count by name
        let byName = [];
        try { byName = await c.find({ name: { $regex: nameQuery, $options: 'i' } }).limit(20).toArray(); } catch(e){ byName = []; }
        // count by workflowId
        let byWfObj = [];
        try { if (objId) byWfObj = await c.find({ workflowId: objId }).limit(20).toArray(); } catch(e){ byWfObj = []; }
        let byWfStr = [];
        try { byWfStr = await c.find({ workflowId: idStr }).limit(20).toArray(); } catch(e){ byWfStr = []; }

        console.log(`Collection: ${col} — nameMatches: ${byName.length}, wfObjMatches: ${byWfObj.length}, wfStrMatches: ${byWfStr.length}`);
        if (byName.length > 0) console.log(' name samples:', byName.map(x=>({ id: x._id, name: x.name })).slice(0,10));
        if (byWfObj.length > 0) console.log(' wfObj samples:', byWfObj.map(x=>({ id: x._id, name: x.name, dataSnippet: JSON.stringify(x.data||{}).slice(0,200) })).slice(0,10));
        if (byWfStr.length > 0) console.log(' wfStr samples:', byWfStr.map(x=>({ id: x._id, name: x.name, dataSnippet: JSON.stringify(x.data||{}).slice(0,200) })).slice(0,10));
      } catch(e) {
        console.warn('Could not query collection', col, e.message);
      }
    }

    // Additionally search agent_journals for payload containing 'Mistar' or agentInstanceId in workflow
    try {
      const journalsByName = await db.collection('agent_journals').find({ $or: [ { 'payload': { $regex: nameQuery, $options: 'i' } }, { 'payload.message' : { $regex: nameQuery, $options: 'i' } } ] }).limit(20).toArray().catch(()=>[]);
      console.log('agent_journals matching name in payload count:', journalsByName.length);
    } catch(e) { }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error querying mongo:', err);
    try { await mongoose.disconnect(); } catch(e){}
    process.exit(1);
  }
})();
