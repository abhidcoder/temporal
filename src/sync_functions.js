const { Client } = require('@temporalio/client');
const { Connection } = require('@temporalio/client'); // adjust this if needed



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

module.exports = { retailerSync };
