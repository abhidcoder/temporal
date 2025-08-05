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

async function testOrdersNewSync() {
  const connection = await Connection.connect();
  const client = new Client({ connection });

  try {
    console.log('🚀 Starting Orders New Sync Workflow...');
    
    const handle = await client.workflow.start('ordersNewSyncWorkflow', {
      taskQueue: 'superzop-sync-queue',
      workflowId: `orders-new-sync-${Date.now()}`,
      args: ['Orders_News'], // Firebase path
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

async function testSalesmanDetailsSync() {
  const connection = await Connection.connect();
  const client = new Client({ connection });

  try {
    console.log('🚀 Starting Salesman Details Sync Workflow...');
    
    const handle = await client.workflow.start('salesmanDetailsSyncWorkflow', {
      taskQueue: 'superzop-sync-queue',
      workflowId: `salesman-details-sync-${Date.now()}`,
      args: ['Salesman_Details'], // Firebase path
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

// Test workflow resumption functionality
async function testWorkflowResumption() {
  console.log('\n🔄 Testing Workflow Resumption...');
  
  try {
    // Example 1: Resume from a specific checkpoint
    const resumeInfo = {
      originalWorkflowId: 'orders-new-sync-1234567890',
      checkpoint: 'fetch_completed',
      workflowState: {
        step1Completed: true,
        step2Completed: true,
        step3Completed: true,
        step4Completed: true,
        step5Completed: true,
        step6Completed: false,
        step7Completed: false,
        step8Completed: false,
        step9Completed: false,
        step10Completed: false,
        orders: [
          { id: 1, name: 'Order 1' },
          { id: 2, name: 'Order 2' }
        ],
        processedOrders: [],
        deleteResult: { affectedRows: 5 },
        insertResult: null,
        errors: [],
        lastCheckpoint: 'fetch_completed'
      }
    };

    console.log('📋 Example 1: Resuming from fetch_completed checkpoint');
    const resumeHandle = await ordersNewSync(resumeInfo);
    console.log(`✅ Resumed workflow started: ${resumeHandle.workflowId}`);

    // Example 2: Resume from insert_failed checkpoint
    const resumeInfo2 = {
      originalWorkflowId: 'orders-new-sync-9876543210',
      checkpoint: 'insert_failed',
      workflowState: {
        step1Completed: true,
        step2Completed: true,
        step3Completed: true,
        step4Completed: true,
        step5Completed: true,
        step6Completed: true,
        step7Completed: true,
        step8Completed: true,
        step9Completed: true,
        step10Completed: false,
        orders: [
          { id: 1, name: 'Order 1' },
          { id: 2, name: 'Order 2' }
        ],
        processedOrders: [
          { id: 1, name: 'Order 1', processed: true },
          { id: 2, name: 'Order 2', processed: true }
        ],
        deleteResult: { affectedRows: 5 },
        insertResult: null,
        errors: ['Database connection failed'],
        lastCheckpoint: 'insert_failed'
      }
    };

    console.log('📋 Example 2: Resuming from insert_failed checkpoint');
    const resumeHandle2 = await ordersNewSync(resumeInfo2);
    console.log(`✅ Resumed workflow started: ${resumeHandle2.workflowId}`);

    return { resumeHandle, resumeHandle2 };

  } catch (error) {
    console.error('❌ Workflow resumption test failed:', error);
    throw error;
  }
}

// Test error handling and recovery
async function testErrorHandlingAndRecovery() {
  console.log('\n🛡️ Testing Error Handling and Recovery...');
  
  try {
    // Simulate a workflow that fails at step 4 (delete operation)
    console.log('📋 Simulating workflow failure at delete step...');
    
    // Start a workflow that might fail
    const workflowHandle = await ordersNewSync();
    
    // Wait a bit for the workflow to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check workflow status
    try {
      const result = await workflowHandle.result();
      console.log('✅ Workflow completed successfully:', result);
    } catch (workflowError) {
      console.log('❌ Workflow failed as expected:', workflowError.message);
      
      // Parse the error to extract resume information
      let errorDetails;
      try {
        errorDetails = JSON.parse(workflowError.message);
      } catch (parseError) {
        console.log('⚠️ Could not parse error details');
        return;
      }
      
      if (errorDetails.details && errorDetails.details.resumeInfo) {
        console.log('🔄 Attempting to resume workflow...');
        console.log('📋 Resume info:', errorDetails.details.resumeInfo);
        
        // Resume the workflow from the failure point
        const resumeHandle = await ordersNewSync(errorDetails.details.resumeInfo);
        console.log(`✅ Resumed workflow started: ${resumeHandle.workflowId}`);
        
        // Wait for the resumed workflow to complete
        try {
          const resumeResult = await resumeHandle.result();
          console.log('✅ Resumed workflow completed successfully:', resumeResult);
        } catch (resumeError) {
          console.log('❌ Resumed workflow also failed:', resumeError.message);
        }
      }
    }

  } catch (error) {
    console.error('❌ Error handling test failed:', error);
    throw error;
  }
}

// Run tests
async function runTests() {
  console.log('🧪 Starting Temporal Workflow Tests...\n');
  
  try {
    // Run existing tests
    await testOrdersNewSync();
    await testSalesmanDetailsSync();
    
    // Run new resumption tests
    await testWorkflowResumption();
    await testErrorHandlingAndRecovery();
    
    console.log('\n🎉 All tests completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
  }
}

runTests().catch(console.error);