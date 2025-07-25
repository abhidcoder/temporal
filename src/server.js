const express = require('express');
const cors = require('cors');
const { Connection, Client } = require('@temporalio/client');
const { orderFulfillmentWorkflow, dataProcessingWorkflow } = require('./workflows');
// Simple ID generator to avoid ESM issues
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
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    temporal: temporalClient ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString() 
  });
});

// Start order fulfillment workflow
app.post('/orders', async (req, res) => {
  try {
    const orderData = {
      id: req.body.id || `order_${generateId()}`,
      customerEmail: req.body.customerEmail,
      items: req.body.items || [],
      total: req.body.total,
      paymentId: req.body.paymentId || `payment_${generateId()}`,
      ...req.body
    };

    const workflowId = `order-${orderData.id}`;
    
    const handle = await temporalClient.workflow.start(orderFulfillmentWorkflow, {
      taskQueue: 'express-task-queue',
      args: [orderData],
      workflowId,
    });

    res.status(202).json({
      message: 'Order processing started',
      orderId: orderData.id,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId
    });

  } catch (error) {
    console.error('Error starting order workflow:', error);
    res.status(500).json({ 
      error: 'Failed to start order processing',
      details: error.message 
    });
  }
});

// Start data processing workflow
app.post('/jobs/data-processing', async (req, res) => {
  try {
    const jobData = {
      jobName: req.body.jobName || `job_${generateId()}`,
      batches: req.body.batches || 5,
      notificationEmail: req.body.notificationEmail,
      ...req.body
    };

    const workflowId = `data-job-${jobData.jobName}`;
    
    const handle = await temporalClient.workflow.start(dataProcessingWorkflow, {
      taskQueue: 'express-task-queue',
      args: [jobData],
      workflowId,
    });

    res.status(202).json({
      message: 'Data processing job started',
      jobName: jobData.jobName,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId
    });

  } catch (error) {
    console.error('Error starting data processing workflow:', error);
    res.status(500).json({ 
      error: 'Failed to start data processing job',
      details: error.message 
    });
  }
});

// Get workflow status
app.get('/workflows/:workflowId/status', async (req, res) => {
  try {
    const { workflowId } = req.params;
    const handle = temporalClient.workflow.getHandle(workflowId);
    
    const description = await handle.describe();
    
    res.json({
      workflowId,
      status: description.status.name,
      startTime: description.startTime,
      executionTime: description.executionTime,
      runId: description.runId
    });
    
  } catch (error) {
    console.error('Error getting workflow status:', error);
    res.status(404).json({ 
      error: 'Workflow not found',
      workflowId: req.params.workflowId 
    });
  }
});

// Get workflow result
app.get('/workflows/:workflowId/result', async (req, res) => {
  try {
    const { workflowId } = req.params;
    const handle = temporalClient.workflow.getHandle(workflowId);
    
    // This will wait for the workflow to complete
    const result = await handle.result();
    
    res.json({
      workflowId,
      result,
      completedAt: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error getting workflow result:', error);
    res.status(500).json({ 
      error: 'Failed to get workflow result',
      details: error.message,
      workflowId: req.params.workflowId 
    });
  }
});

// Cancel workflow
app.delete('/workflows/:workflowId', async (req, res) => {
  try {
    const { workflowId } = req.params;
    const handle = temporalClient.workflow.getHandle(workflowId);
    
    await handle.cancel();
    
    res.json({
      message: 'Workflow cancelled',
      workflowId
    });
    
  } catch (error) {
    console.error('Error cancelling workflow:', error);
    res.status(500).json({ 
      error: 'Failed to cancel workflow',
      details: error.message 
    });
  }
});

// List recent workflows (mock endpoint - in production you'd query Temporal)
app.get('/workflows', async (req, res) => {
  res.json({
    message: 'Use Temporal Web UI at http://localhost:8233 to see all workflows',
    endpoints: {
      'POST /orders': 'Start order fulfillment workflow',
      'POST /jobs/data-processing': 'Start data processing workflow',
      'GET /workflows/:id/status': 'Get workflow status',
      'GET /workflows/:id/result': 'Get workflow result',
      'DELETE /workflows/:id': 'Cancel workflow'
    }
  });
});

// Start server
async function startServer() {
  try {
    await initTemporal();
    
    app.listen(PORT, () => {
      console.log(`🌐 Express server running on http://localhost:${PORT}`);
      console.log(`📊 Temporal Web UI: http://localhost:8233`);
      console.log('\n📖 API Endpoints:');
      console.log('  POST /orders - Start order processing');
      console.log('  POST /jobs/data-processing - Start data processing job');
      console.log('  GET /workflows/:id/status - Get workflow status');
      console.log('  GET /workflows/:id/result - Get workflow result');
      console.log('  DELETE /workflows/:id - Cancel workflow');
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Example curl commands:
/*
# Start an order
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerEmail": "customer@example.com",
    "items": [{"name": "Product 1", "quantity": 2}],
    "total": 29.99
  }'

# Start a data processing job
curl -X POST http://localhost:3000/jobs/data-processing \
  -H "Content-Type: application/json" \
  -d '{
    "jobName": "monthly-report",
    "batches": 3,
    "notificationEmail": "admin@example.com"
  }'

# Check workflow status
curl http://localhost:3000/workflows/order-order_abc123/status

# Get workflow result
curl http://localhost:3000/workflows/order-order_abc123/result

# Cancel workflow
curl -X DELETE http://localhost:3000/workflows/order-order_abc123
*/