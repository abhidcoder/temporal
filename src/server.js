const express = require('express');
const cors = require('cors');
const { Connection, Client } = require('@temporalio/client');
const { retailerSync } = require('./sync_functions');

const {saveRetailersFromFirebaseToMysqlWorkflow} = require('./Workflow/workflows');


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

  let { tableKey } = req.body;

  if (!tableKey) {
    return res.status(400).json({"error": "tableKey is required"});
  }

  try {

    let handle
    if(tableKey == "retailer_master") {
      handle = await retailerSync();
    }
    else if(tableKey == "orders") {
      
    }

    res.status(202).json({
      success: true,
      message: 'Retailer sync workflow started successfully',
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      status: 'RUNNING',
      startTime: new Date().toISOString(),
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

