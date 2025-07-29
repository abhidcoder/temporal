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
    async function testRetailerSync() {
      const connection = await Connection.connect();
      const client = new Client({ connection });

      try {
        console.log('🚀 Starting Retailer Sync Workflow...');

        const handle = await client.workflow.start('saveRetailersFromFirebaseToMysqlWorkflow', {
          taskQueue: 'superzop-sync-queue',
          workflowId: `retailer-sync-${Date.now()}`,
          args: ['Retailer_Master'],
        });

        console.log('✅ Workflow started with ID:', handle.workflowId);
        return handle;

      } catch (error) {
        console.error('❌ Workflow failed to start:', error);
        throw error;
      } finally {
        await connection.close();
      }
    }

    const handle = await testRetailerSync();

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

