// src/worker.js
const { Worker } = require('@temporalio/worker');
const path = require('path');

async function run() {
  try {
    console.log('Starting worker initialization...');
    
    // Debug: Check if files exist
    const activitiesPath = path.resolve(__dirname, 'Activities');
    const workflowsPath = path.resolve(__dirname, 'workflows');
    
    console.log('Activities path:', activitiesPath);
    console.log('Workflows path:', workflowsPath);
    
    // Load activities with error handling
    let activities;
    try {
      activities = require('./Activities');
      console.log('✅ Activities loaded successfully');
      console.log('Available activities:', Object.keys(activities));
    } catch (actError) {
      console.error('❌ Failed to load activities:', actError.message);
      throw actError;
    }

    // Check workflows path
    try {
      require('./workflows');
      console.log('✅ Workflows loaded successfully');
    } catch (wfError) {
      console.error('❌ Failed to load workflows:', wfError.message);
      throw wfError;
    }

    console.log('Creating Temporal worker...');
    const worker = await Worker.create({
      workflowsPath: require.resolve('./workflows'),
      activities,
      taskQueue: 'superzop-sync-queue',
      enableLogging: true,
      dataConverter: undefined, // Use default
    });

    console.log('✅ Worker created successfully');
    console.log('🚀 Worker started, listening for workflows...');
    console.log('📋 Task Queue: superzop-sync-queue');
    console.log('🔧 Worker ready to handle both retailer and orders sync workflows');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('🛑 Shutting down worker gracefully...');
      await worker.shutdown();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('🛑 Shutting down worker gracefully...');
      await worker.shutdown();
      process.exit(0);
    });
    
    await worker.run();
  } catch (error) {
    console.error('❌ Worker error:', error);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('❌ Failed to start worker:', err);
  console.error('Error details:', err);
  process.exit(1);
});