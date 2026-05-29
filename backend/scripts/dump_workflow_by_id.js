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

    const id = process.argv[2];
    if (!id) {
      console.error('Please provide workflow id as first arg');
      process.exit(2);
    }

    const wf = await db.collection('workflows').findOne({ _id: new (require('mongodb').ObjectId)(id) });
    if (!wf) {
      console.log('Workflow not found');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Print top-level keys and small samples
    const keys = Object.keys(wf);
    console.log('Workflow keys:', keys);
    if (wf.nodes) {
      console.log('Inline nodes count:', (wf.nodes && wf.nodes.length) || 0);
      if (Array.isArray(wf.nodes)) console.log('First node snippet:', JSON.stringify(wf.nodes[0]).slice(0,1000));
    }
    if (wf.data) console.log('wf.data snippet:', JSON.stringify(wf.data).slice(0,1000));
    if (wf.meta) console.log('wf.meta snippet:', JSON.stringify(wf.meta).slice(0,1000));
    console.log('Full workflow (truncated):', JSON.stringify(wf).slice(0,2000));

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error querying mongo:', err);
    try { await mongoose.disconnect(); } catch(e){}
    process.exit(1);
  }
})();
