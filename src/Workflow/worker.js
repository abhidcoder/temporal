// src/Workflow/worker.js
const { Worker } = require('@temporalio/worker');
const { Connection } = require('@temporalio/client');
const path = require('path');
require('dotenv').config();

async function run() {
  try {
    console.log('🚀 Starting Temporal Worker...');
    console.log('📋 Environment:', process.env.NODE_ENV || 'development');
    console.log('🔗 Temporal Address:', process.env.TEMPORAL_ADDRESS || 'localhost:7233');
    
    // Validate required environment variables
    const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.error('❌ Missing required environment variables:', missingVars);
      console.log('💡 Please create a .env file with the required database credentials');
      process.exit(1);
    }
    
    // Debug: Check if files exist with absolute paths
    const activitiesPath = path.resolve(__dirname, 'Activities');
    const workflowsPath = path.resolve(__dirname, 'workflows.js');
    
    console.log('📁 Activities path:', activitiesPath);
    console.log('📁 Workflows path:', workflowsPath);
    
    // Load activities with error handling
    let activities;
    try {
      activities = require('./Activities');
      console.log('✅ Activities loaded successfully');
      console.log('📋 Available activities:', Object.keys(activities));
    } catch (actError) {
      console.error('❌ Failed to load activities:', actError.message);
      console.error('Stack trace:', actError.stack);
      throw actError;
    }

    // Check workflows path
    try {
      require('./workflows');
      console.log('✅ Workflows loaded successfully');
    } catch (wfError) {
      console.error('❌ Failed to load workflows:', wfError.message);
      console.error('Stack trace:', wfError.stack);
      throw wfError;
    }

    // Determine task queue based on environment
    const taskQueue = process.env.TEMPORAL_TASK_QUEUE || 'superzop-sync-queue';
    
    console.log('🔧 Creating Temporal worker...');
    console.log('📋 Task Queue:', taskQueue);
    console.log('🔗 Temporal Address:', process.env.TEMPORAL_ADDRESS || 'localhost:7233');
    
    // Try to connect to Temporal with retry logic
    let retries = 0;
    const maxRetries = 5;
    const retryDelay = 2000; // 2 seconds
    
    while (retries < maxRetries) {
      try {
        console.log(`🔄 Attempting to connect to Temporal (attempt ${retries + 1}/${maxRetries})...`);
        await Connection.connect({
          address: process.env.TEMPORAL_ADDRESS || 'localhost:7233'
        });
        console.log('✅ Successfully connected to Temporal');
        break;
      } catch (error) {
        retries++;
        console.log(`❌ Connection attempt ${retries} failed:`, error.message);
        
        if (retries >= maxRetries) {
          console.error('❌ Failed to connect to Temporal after all retries');
          console.log('💡 Make sure Temporal server is running on', process.env.TEMPORAL_ADDRESS || 'localhost:7233');
          console.log('💡 For local development, you can start Temporal with:');
          console.log('   temporal server start-dev');
          process.exit(1);
        }
        
        console.log(`⏳ Retrying in ${retryDelay/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    
    const worker = await Worker.create({
      workflowsPath: require.resolve('./workflows'),
      activities,
      taskQueue: taskQueue,
      enableLogging: true,
    });

    console.log('✅ Worker created successfully');
    console.log('🚀 Worker started, listening for workflows...');
    console.log('📋 Task Queue:', taskQueue);
    console.log('🔧 Worker ready to handle workflows');
    
    // Handle graceful shutdown
    const gracefulShutdown = async (signal) => {
      console.log(`🛑 Received ${signal}, shutting down worker gracefully...`);
      try {
        await worker.shutdown();
        console.log('✅ Worker shutdown completed');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };
    
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      console.error('Stack trace:', error.stack);
      gracefulShutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
      gracefulShutdown('unhandledRejection');
    });
    
    console.log('🔄 Starting worker...');
    await worker.run();
    
  } catch (error) {
    console.error('❌ Worker error:', error);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

// Start the worker
run().catch((err) => {
  console.error('❌ Failed to start worker:', err);
  console.error('Error details:', err);
  process.exit(1);
});