const express = require('express');
const cors = require('cors');
const { Connection, Client } = require('@temporalio/client');
const { retailerSync, ordersSync, ordersNewSync, salesmanDetailsSync, retailerProductsSync, resumeRetailerProductsSync } = require('./sync_functions');

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



// Table sync endpoint - handles both retailer and orders workflows
app.post('/table/sync', async (req, res) => {

  let { tableKey } = req.body;

  if (!tableKey) {
    return res.status(400).json({"error": "tableKey is required"});
  }

  try {

    let handle;
    let workflowType;
    
    if(tableKey == "retailer_master") {
      handle = await retailerSync();
      workflowType = 'retailer';
    }
    else if(tableKey == "orders") {
      handle = await ordersSync();
      workflowType = 'orders';
    }
    else if(tableKey == "orders_new") {
      handle = await ordersNewSync();
      workflowType = 'orders_new';
    }
    else if(tableKey == "salesman_details") {
      handle = await salesmanDetailsSync();
      workflowType = 'salesman_details';
    }
    else if(tableKey == "retailer_products") {
      handle = await retailerProductsSync();
      workflowType = 'retailer_products';
    }
    else {
      return res.status(400).json({
        "error": "Invalid tableKey. Supported values: 'retailer_master', 'orders', 'orders_new', 'salesman_details', 'retailer_products'"
      });
    }

    res.status(202).json({
      success: true,
      message: `${workflowType} sync workflow started successfully`,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      status: 'RUNNING',
      startTime: new Date().toISOString(),
      workflowUrl: `http://localhost:8233/namespaces/default/workflows/${handle.workflowId}/${handle.firstExecutionRunId}`
    });

  } catch (error) {
    console.error('❌ Failed to start workflow:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to start workflow',
      message: error.message,
      details: error.stack,
      timestamp: new Date().toISOString()
    });
  }
});

// Resume workflow endpoint
app.post('/table/resume', async (req, res) => {
  let { workflowId, tableKey, checkpoint } = req.body;

  if (!workflowId || !tableKey) {
    return res.status(400).json({"error": "workflowId and tableKey are required"});
  }

  try {
    let handle;
    let workflowType;
    
    if(tableKey == "retailer_products") {
      handle = await resumeRetailerProductsSync(workflowId, checkpoint);
      workflowType = 'retailer_products';
    }
    else {
      return res.status(400).json({
        "error": "Resume not supported for this tableKey. Supported values: 'retailer_products'"
      });
    }

    res.status(202).json({
      success: true,
      message: `${workflowType} workflow resume initiated`,
      workflowId: handle.workflowId,
      originalWorkflowId: workflowId,
      checkpoint: checkpoint,
      status: 'RESUMING',
      resumeTime: new Date().toISOString(),
      workflowUrl: `http://localhost:8233/namespaces/default/workflows/${handle.workflowId}`
    });

  } catch (error) {
    console.error('❌ Failed to resume workflow:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to resume workflow',
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

