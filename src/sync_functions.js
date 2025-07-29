const { Client } = require('@temporalio/client');
const { Connection } = require('@temporalio/client'); // adjust this if needed

const {saveRetailersFromFirebaseToMysqlWorkflow, ordersYesterdayTransferWorkflow} = require('./Workflow/workflows');

async function retailerSync() {
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

async function ordersSync() {
  const connection = await Connection.connect();
  const client = new Client({ connection });

  try {
    console.log('🚀 Starting Orders Transfer Workflow...');

    const handle = await client.workflow.start('ordersYesterdayTransferWorkflow', {
      taskQueue: 'superzop-sync-queue',
      workflowId: `orders-transfer-${Date.now()}`,
      args: ['OrdersYest'],
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

module.exports = { retailerSync, ordersSync };
