const express = require('express');
const cors = require('cors');
const { Connection, Client } = require('@temporalio/client');

const {saveRetailersFromFirebaseToMysqlWorkflow} = require('./Workflow/workflows');

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Temporal client setup
let temporalClient;

async function initTemporal() {
  const connection = await Connection.connect({ 
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233' 
  });
  temporalClient = new Client({ connection });
  console.log('✅ Connected to Temporal');
}

// Routes

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'healthy', 
    temporal: temporalClient ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString() 
  });
});



// Retailer sync endpoint - CORRECTED VERSION
app.post('/table/sync', async (req, res) => {
  try {
    // Validate Temporal client is available
    if (!temporalClient) {
      return res.status(503).json({
        success: false,
        error: 'Temporal client not initialized',
        message: 'Server is not ready to process workflows'
      });
    }

    // Extract parameters from request body or use defaults
    const { retailerPath = 'Retailer_Master', workflowTimeout = '30 minutes' } = req.body;
    
    // Generate unique workflow ID
    const workflowId = `retailer-sync-${Date.now()}-${generateId()}`;
    
    console.log(`🚀 Starting retailer sync workflow: ${workflowId}`);

    // Start the workflow using Temporal client
    const handle = await temporalClient.workflow.start(saveRetailersFromFirebaseToMysqlWorkflow, {
      args: [retailerPath], // Pass retailerPath as argument
      taskQueue: 'retailer-sync-queue',
      workflowId: workflowId,
      workflowExecutionTimeout: workflowTimeout,
      retry: {
        initialInterval: '1s',
        maximumInterval: '30s',
        maximumAttempts: 3,
      }
    });

    console.log(`✅ Workflow started successfully: ${workflowId}`);

    // Return immediate response with workflow handle
    res.status(202).json({
      success: true,
      message: 'Retailer sync workflow started successfully',
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      status: 'RUNNING',
      startTime: new Date().toISOString(),
      // Include workflow URL for monitoring (if you have Temporal Web UI)
      workflowUrl: `http://localhost:8233/namespaces/default/workflows/${handle.workflowId}/${handle.firstExecutionRunId}`
    });

  } catch (error) {
    console.error('❌ Failed to start retailer sync workflow:', error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to start retailer sync workflow',
      message: error.message,
      details: error.stack,
      timestamp: new Date().toISOString()
    });
  }
});


// Start server
async function startServer() {
  try {
    await initTemporal();
    
    app.listen(PORT, () => {
      console.log(`🌐 Express server running on http://localhost:${PORT}`);
      console.log(`📊 Temporal Web UI: http://localhost:8233`);
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

