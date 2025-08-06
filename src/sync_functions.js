
const { Client } = require('@temporalio/client');
const { Connection } = require('@temporalio/client'); // adjust this if needed


const {saveRetailersFromFirebaseToMysqlWorkflow, ordersYesterdayTransferWorkflow, retailerProductsSyncWorkflow, ordersNewSyncWorkflow, salesmanDetailsSyncWorkflow} = require('./Workflow/workflows');

// Import the activity to get workflow state
const { getWorkflowStateFromSyncStatus } = require('./Workflow/Activities/retailer_products_activity');

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

async function ordersNewSync(resumeInfo = null) {
  const connection = await Connection.connect({
    address: 'temporal:7233'
  });
  const client = new Client({ connection });
  
  try {
    const workflowId = resumeInfo ? 
      `resume-orders-new-${Date.now()}` : 
      `orders-new-sync-${Date.now()}`;
    
    console.log(`🚀 Starting Orders New Sync Workflow${resumeInfo ? ' (Resume)' : ''}`);
    console.log(`📋 Workflow ID: ${workflowId}`);
    
    const workflowHandle = await client.workflow.start('ordersNewSyncWorkflow', {
      taskQueue: 'superzop-sync-queue',
      workflowId: workflowId,
      args: ['Orders_News', resumeInfo]
    });
    
    console.log(`✅ Orders New Sync Workflow started with ID: ${workflowHandle.workflowId}`);
    return workflowHandle;
    
  } catch (error) {
    console.error('❌ Failed to start Orders New Sync Workflow:', error);
    throw error;
  } finally {
    await connection.close();
  }
}

async function salesmanDetailsSync(resumeInfo = null) {
  const connection = await Connection.connect({
    address: 'temporal:7233'
  });
  const client = new Client({ connection });
  
  try {
    const workflowId = resumeInfo ? 
      `resume-salesman-details-${Date.now()}` : 
      `salesman-details-sync-${Date.now()}`;
    
    console.log(`🚀 Starting Salesman Details Sync Workflow${resumeInfo ? ' (Resume)' : ''}`);
    console.log(`📋 Workflow ID: ${workflowId}`);
    
    const workflowHandle = await client.workflow.start('salesmanDetailsSyncWorkflow', {
      taskQueue: 'superzop-sync-queue',
      workflowId: workflowId,
      args: ['Salesman_Details', resumeInfo]
    });
    
    console.log(`✅ Salesman Details Sync Workflow started with ID: ${workflowHandle.workflowId}`);
    return workflowHandle;
    
  } catch (error) {
    console.error('❌ Failed to start Salesman Details Sync Workflow:', error);
    throw error;
  } finally {
    await connection.close();
  }
}

async function retailerProductsSync() {
  const connection = await Connection.connect();
  const client = new Client({ connection });

  try {
    console.log('🚀 Starting Retailer Products Sync Workflow...');

    // Generate workflowId once
    const workflowId = `retailer-products-sync-${Date.now()}`;

    const handle = await client.workflow.start('retailerProductsSyncWorkflow', {
      taskQueue: 'superzop-sync-queue',
      workflowId, // use this workflowId for Temporal
      args: [workflowId, 'Retailer_Products', null], // pass workflowId as first arg
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

async function resumeRetailerProductsSync(workflowId, checkpoint = null) {
  const connection = await Connection.connect();
  const client = new Client({ connection });

  try {
    console.log(`🔄 Resuming Retailer Products Sync Workflow from checkpoint: ${checkpoint}`);

    if (!workflowId) {
      throw new Error('Workflow ID is required for resume operation');
    }

    // First, get the original workflow's state from sync status
    let workflowState = null;
    try {
      console.log(`🔍 Attempting to retrieve workflow state for ID: ${workflowId}`);
      
      // Get the workflow state from the sync status table
      const stateResponse = await getWorkflowStateFromSyncStatus(workflowId);
      
      console.log(`🔍 State response received:`, {
        statusCode: stateResponse.statusCode,
        hasBody: !!stateResponse.body,
        hasWorkflowState: stateResponse.body && !!stateResponse.body.workflow_state
      });
      
      if (stateResponse.statusCode === 200 && stateResponse.body && stateResponse.body.workflow_state) {
        try {
          workflowState = JSON.parse(stateResponse.body.workflow_state);
          console.log('✅ Retrieved workflow state from sync status:', workflowState);
        } catch (parseError) {
          console.error('❌ Failed to parse workflow state JSON:', parseError.message);
          throw new Error(`Invalid workflow state format: ${parseError.message}`);
        }
      } else if (stateResponse.statusCode === 404) {
        console.warn('No workflow state found in sync status, cannot resume');
        throw new Error('No workflow state found in sync status table');
      } else {
        console.warn('Invalid response from sync status table:', stateResponse);
        throw new Error('Invalid response from sync status table');
      }
    } catch (stateError) {
      console.error('Could not retrieve original workflow state:', stateError.message);
      throw new Error(`Cannot resume workflow: ${stateError.message}`);
    }

    // Start a new workflow with resume parameters
    const newWorkflowId = `retailer-products-sync-resume-${Date.now()}`;
    
    const handle = await client.workflow.start('retailerProductsSyncWorkflow', {
      taskQueue: 'superzop-sync-queue',
      workflowId: newWorkflowId,
      args: [
        'Retailer_Products',
        {
          isResume: true,
          originalWorkflowId: workflowId,
          checkpoint: checkpoint,
          workflowState: workflowState
        }
      ]
    });

    console.log(`✅ Resume workflow started with ID: ${newWorkflowId}`);
    return handle;

  } catch (error) {
    console.error('❌ Failed to start resume workflow:', error);
    throw error;
  } finally {
    await connection.close();
  }
}

// Resume workflow from a specific checkpoint
async function resumeWorkflow(workflowType, resumeInfo, options = {}) {
  const client = new Client();
  
  try {
    console.log(`🔄 Resuming ${workflowType} workflow from checkpoint: ${resumeInfo.checkpoint}`);
    console.log(`📋 Original workflow ID: ${resumeInfo.originalWorkflowId}`);
    
    let workflowHandle;
    
    switch (workflowType) {
      case 'ordersNewSync':
        workflowHandle = await client.workflow.start(ordersNewSyncWorkflow, {
          taskQueue: 'superzop-sync-queue', // Changed from 'sync-queue' to 'superzop-sync-queue'
          workflowId: `resume-orders-new-${Date.now()}`,
          args: ['Orders_News', resumeInfo],
          ...options
        });
        break;
        
      case 'salesmanDetailsSync':
        workflowHandle = await client.workflow.start(salesmanDetailsSyncWorkflow, {
          taskQueue: 'superzop-sync-queue', // Changed from 'sync-queue' to 'superzop-sync-queue'
          workflowId: `resume-salesman-details-${Date.now()}`,
          args: ['Salesman_Details', resumeInfo],
          ...options
        });
        break;
        
      default:
        throw new Error(`Unknown workflow type: ${workflowType}`);
    }
    
    console.log(`✅ Resumed workflow started with ID: ${workflowHandle.workflowId}`);
    return workflowHandle;
    
  } catch (error) {
    console.error(`❌ Failed to resume ${workflowType} workflow:`, error);
    throw error;
  }
}

module.exports = { retailerSync, ordersSync, ordersNewSync, salesmanDetailsSync, retailerProductsSync, resumeRetailerProductsSync, resumeWorkflow };
