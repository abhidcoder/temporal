// src/worker.js
const { Worker } = require('@temporalio/worker');
const activities = require('./activity');

async function run() {
  try {
    const worker = await Worker.create({
      workflowsPath: require.resolve('./workflow'),
      activities,
      taskQueue: 'retailer-sync-queue',
    });

    console.log('Worker started, listening for workflows...');
    await worker.run();
  } catch (error) {
    console.error('Worker error:', error);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Failed to start worker:', err);
  process.exit(1);
});

// src/client.js
const { Client } = require('@temporalio/client');
const { saveRetailersFromFirebaseToMysqlWorkflow } = require('./workflow');

async function startRetailerSync(retailerPath = 'Retailer_Master') {
  try {
    const client = new Client();
    
    const handle = await client.workflow.start(saveRetailersFromFirebaseToMysqlWorkflow, {
      args: [retailerPath],
      taskQueue: 'retailer-sync-queue',
      workflowId: `retailer-sync-${Date.now()}`,
    });

    console.log(`Started workflow ${handle.workflowId}`);
    
    // Wait for workflow to complete
    const result = await handle.result();
    console.log('Workflow completed:', result);
    
    return result;
  } catch (error) {
    console.error('Failed to start retailer sync workflow:', error);
    throw error;
  }
}

// Express route handler
async function saveRetailersFromFirebaseToMysql(req, res) {
  try {
    const retailerPath = req.query.retailerPath || 'Retailer_Master';
    const result = await startRetailerSync(retailerPath);
    
    if (res) {
      res.statusMessage = "Retailer sync workflow started successfully";
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.json(result);
    }
    
    return result;
  } catch (error) {
    console.error('Failed to start retailer sync workflow:', error);
    
    if (res) {
      res.statusCode = 500;
      res.statusMessage = "Failed to start retailer sync";
      res.json({ error: error.message });
    }
    
    throw error;
  }
}

// Run directly if this file is executed
if (require.main === module) {
  startRetailerSync()
    .then(result => {
      console.log('Sync completed successfully:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('Sync failed:', error);
      process.exit(1);
    });
}

module.exports = {
  startRetailerSync,
  saveRetailersFromFirebaseToMysql
};