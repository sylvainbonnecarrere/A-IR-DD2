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
    const cols = await db.listCollections().toArray();
    console.log('Collections:');
    cols.forEach(c => console.log(' -', c.name));
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error listing collections:', err);
    try { await mongoose.disconnect(); } catch(e){}
    process.exit(1);
  }
})();
