#!/usr/bin/env node

/**
 * MongoDB Direct Query Diagnostic
 * Check if User.defaultWorkflowId is being persisted by /api/workflows
 */

const mongoose = require('mongoose');

const MONGO_URL = 'mongodb://localhost:27017/workflow-db';

async function diagnose() {
  try {
    console.log('\n📊 CONNECTING TO MONGODB...');
    await mongoose.connect(MONGO_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;

    // Check what users exist
    console.log('\n📊 QUERYING USERS COLLECTION...');
    const users = await db.collection('users').find({}).limit(10).toArray();
    
    if (users.length === 0) {
      console.log('❌ NO USERS FOUND IN DATABASE');
    } else {
      console.log(`✅ Found ${users.length} users\n`);
      
      users.forEach((user, idx) => {
        console.log(`User ${idx + 1}:`);
        console.log(`  Email: ${user.email}`);
        console.log(`  ID: ${user._id}`);
        console.log(`  defaultWorkflowId: ${user.defaultWorkflowId || 'NULL'}`);
        console.log(`  workflowCount: ${user.workflowCount !== undefined ? user.workflowCount : 'undefined'}`);
        console.log('');
      });
    }

    // Check workflows collection
    console.log('\n📊 QUERYING WORKFLOWS COLLECTION...');
    const workflows = await db.collection('workflows').find({}).limit(10).toArray();
    
    if (workflows.length === 0) {
      console.log('❌ NO WORKFLOWS FOUND IN DATABASE');
    } else {
      console.log(`✅ Found ${workflows.length} workflows\n`);
      
      workflows.forEach((wf, idx) => {
        console.log(`Workflow ${idx + 1}:`);
        console.log(`  ID: ${wf._id}`);
        console.log(`  Name: ${wf.name}`);
        console.log(`  UserId: ${wf.userId}`);
        console.log(`  isDefault: ${wf.isDefault}`);
        console.log('');
      });
    }

    // Check if any user has workflow references
    console.log('\n📊 ANALYSIS: User with defaultWorkflowId set...');
    const userWithDefault = users.find(u => u.defaultWorkflowId);
    if (userWithDefault) {
      console.log(`✅ Found: ${userWithDefault.email}`);
      console.log(`   defaultWorkflowId: ${userWithDefault.defaultWorkflowId}`);
    } else {
      console.log('❌ NO USER HAS defaultWorkflowId SET');
      console.log('\n⚠️ ROOT CAUSE: User.updateOne() in /api/workflows is NOT persisting data!');
    }

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB\n');
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    process.exit(1);
  }
}

diagnose();
