// src/Workflow/test-client.js
const { Connection, Client } = require('@temporalio/client');

async function testRetailerSync() {
  const connection = await Connection.connect();
  const client = new Client({ connection });

  try {
    console.log('🚀 Starting Retailer Sync Workflow...');
    
    const handle = await client.workflow.start('saveRetailersFromFirebaseToMysqlWorkflow', {
      taskQueue: 'superzop-sync-queue',
      workflowId: `retailer-sync-${Date.now()}`,
      args: ['Retailer_Master'], // Firebase path
    });

    console.log('✅ Workflow started with ID:', handle.workflowId);
    console.log('⏳ Waiting for result...');
    
    const result = await handle.result();
    console.log('🎉 Workflow completed successfully!');
    console.log('📊 Result:', JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('❌ Workflow failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await connection.close();
  }
}

async function testOrdersSync() {
  const connection = await Connection.connect();
  const client = new Client({ connection });

  try {
    console.log('🚀 Starting Orders Transfer Workflow...');
    
    const handle = await client.workflow.start('ordersYesterdayTransferWorkflow', {
      taskQueue: 'superzop-sync-queue',
      workflowId: `orders-transfer-${Date.now()}`,
      args: ['Orders'], // Firebase path
    });

    console.log('✅ Workflow started with ID:', handle.workflowId);
    console.log('⏳ Waiting for result...');
    
    const result = await handle.result();
    console.log('🎉 Workflow completed successfully!');
    console.log('📊 Result:', JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('❌ Workflow failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await connection.close();
  }
}

// Run tests
async function runTests() {
  console.log('='.repeat(50));
  console.log('🧪 Testing Temporal Workflows');
  console.log('='.repeat(50));
  
  const testChoice = process.argv[2];
  
  if (testChoice === 'retailers' || !testChoice) {
    await testRetailerSync();
  }
  
  if (testChoice === 'orders' || !testChoice) {
    console.log('\n' + '-'.repeat(30));
    await testOrdersSync();
  }
  
  console.log('\n✨ Tests completed!');
}

runTests().catch(console.error);