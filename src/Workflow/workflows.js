const { proxyActivities, log } = require('@temporalio/workflow');

// Proxy activities with appropriate timeouts
const {
  // Retailer activities
  updateSyncStatus,
  fetchRetailersFromFirebase,
  processRetailerData,
  insertRetailersToMySQL,
  updateAssignedAgents,
  syncGroupRetailers,
  
  // Orders activities - Add these new ones
  ordersYesterdayTransferActivity,
  insertOrdersToMySQL,
  completeSyncStatus,
  
  // Orders New activities
  saveOrdersNewToMysql,
  deleteExistingOrders,
  fetchOrdersFromFirebase,
  processOrderData,
  insertOrdersNewToMySQL,
  updateFinalSyncStatus,
  
  // Salesman Details activities
  saveSalesmanDetailsToMysql,
  deleteExistingSalesmanDetails,
  fetchSalesmanDetailsFromFirebase,
  processSalesmanDetailsData,
  insertSalesmanDetailsToMySQL,
  
  // Retailer Products activities
  updateRetailerProductsSyncStatus,
  fetchRetailerProductsFromFirebase,
  processRetailerProductsData,
  insertRetailerProductsToMySQL,
  completeRetailerProductsSyncStatus,
  getWorkflowStateFromSyncStatus,
  saveWorkflowStateToMySQL,
  loadRetailerProductsFromCache,
  
  // updateSubArea1FromRetailerSubAreaTable
} = proxyActivities({
  startToCloseTimeout: '60 minutes',
  heartbeatTimeout: '5 minutes',
  retry: {
    initialInterval: '5 seconds',
    maximumInterval: '2 minutes',
    maximumAttempts: 3,
  },
});

// Existing retailer workflow - unchanged
async function saveRetailersFromFirebaseToMysqlWorkflow(retailerPath = 'Retailer_Master') {
  const dateNow = new Date();
  const [monthNow, dayNow, yearNow] = [dateNow.getMonth() + 1, dateNow.getDate(), dateNow.getFullYear()];
  const [hourNow, minutesNow, secondsNow] = [dateNow.getHours(), dateNow.getMinutes(), dateNow.getSeconds()];
  const completeDateNow = `${yearNow}-${monthNow}-${dayNow}_${hourNow}:${minutesNow}:${secondsNow}`;
  const syncStatusUniqueKey = `Retailer_Master_${completeDateNow}`;

  try {
    // Step 1: Update sync status to Running
    log.info('Starting retailer sync process');
    await updateSyncStatus({
      table_name: "Retailer_Master",
      status: "Running/Temporal Sync",
      unique_key: syncStatusUniqueKey
    });

    // Step 2: Fetch retailers from Firebase
    log.info('Fetching retailers from Firebase');
    const retailers = await fetchRetailersFromFirebase(retailerPath);

    // Step 3: Process retailer data
    log.info('Processing retailer data');
    const processedRetailers = await processRetailerData(retailers);

    // Step 4: Insert retailers to MySQL
    log.info('Inserting retailers to MySQL');
    const insertResult = await insertRetailersToMySQL(processedRetailers);
    log.info(`Successfully processed ${insertResult.totalProcessed} retailers in ${insertResult.chunksProcessed} chunks`);


    // Step 5: Update sync status to Completed
    await updateSyncStatus({
      table_name: "Retailer_Master",
      status: "Completed/Temporal Sync",
      unique_key: syncStatusUniqueKey
    });

    // Step 6: Update assigned agents
    log.info('Updating assigned agents');
    await updateAssignedAgents();

    // Step 7: Sync group retailers
    log.info('Syncing group retailers');
    await syncGroupRetailers();

    // Step 8: Update sub area
    // log.info('Updating sub area');
    // await updateSubArea1FromRetailerSubAreaTable();

    log.info('Retailer sync workflow completed successfully');
    return {
      success: true,
      totalRetailers: processedRetailers.length,
      syncStatusKey: syncStatusUniqueKey
    };

  } catch (error) {
    // Update sync status to Failed
    try {
      await updateSyncStatus({
        table_name: "Retailer_Master",
        status: "Failed",
        unique_key: syncStatusUniqueKey,
        error: error.message
      });
    } catch (statusError) {
      log.error('Failed to update sync status on error', { statusError });
    }

    log.error('Retailer sync workflow failed', { error });
    throw error;
  }
}

// New orders workflow - using the same pattern as your retailer workflow
async function ordersYesterdayTransferWorkflow(ordersYestQuery = 'OrdersYest') {
  const dateNow = new Date();
  const [monthNow, dayNow, yearNow] = [dateNow.getMonth() + 1, dateNow.getDate(), dateNow.getFullYear()];
  const [hourNow, minutesNow, secondsNow] = [dateNow.getHours(), dateNow.getMinutes(), dateNow.getSeconds()];
  const completeDateNow = `${yearNow}-${monthNow}-${dayNow}_${hourNow}:${minutesNow}:${secondsNow}`;
  const syncStatusUniqueKey = `Orders_New_To_Orders_${completeDateNow}`;

  try {
    // Step 1: Update sync status to Running
    log.info('Starting orders yesterday transfer process');
    await updateSyncStatus({
      table_name: "Orders_New_To_Orders",
      status: "Running/Temporal Sync",
      unique_key: syncStatusUniqueKey
    });

    // Step 2: Process yesterday's orders from Firebase
    log.info('Processing yesterday\'s orders from Firebase');
    const orderResult = await ordersYesterdayTransferActivity({
      ordersYestQuery: ordersYestQuery
    });

    log.info(`Successfully processed ${orderResult.processedOrdersCount} orders`);
    log.info(`Valid orders: ${orderResult.validOrdersCount}, Cancelled: ${orderResult.cancelledOrdersCount}`);

    // Step 3: Insert orders to MySQL (if there are orders to process)
    if (orderResult.orders && orderResult.orders.length > 0) {
      log.info('Inserting orders to MySQL');
      const mysqlResult = await insertOrdersToMySQL(orderResult.orders);
      log.info(`Successfully inserted ${mysqlResult.totalProcessed}/${mysqlResult.totalOrders} orders in ${mysqlResult.chunksProcessed} chunks`);
    } else {
      log.info('No orders to insert to MySQL');
    }

    // Step 4: Complete sync status
    log.info('Completing sync status');
    await completeSyncStatus(orderResult.syncStatusUniqueKey);

    log.info('Orders yesterday transfer workflow completed successfully');
    return {
      success: true,
      totalOrders: orderResult.processedOrdersCount,
      validOrders: orderResult.validOrdersCount,
      cancelledOrders: orderResult.cancelledOrdersCount,
      totalValue: orderResult.totalOrdersValue,
      cancelledValue: orderResult.totalCancelledValue,
      syncStatusKey: orderResult.syncStatusUniqueKey,
      dateProcessed: orderResult.dateProcessed
    };

  } catch (error) {
    // Update sync status to Failed
    try {
      await updateSyncStatus({
        table_name: "Orders_New_To_Orders",
        status: "Failed/Temporal Sync",
        unique_key: syncStatusUniqueKey,
        error_message: error.message
      });
    } catch (statusError) {
      log.error('Failed to update sync status on error', { statusError });
    }

    log.error('Orders yesterday transfer workflow failed', { error });
    throw error;
  }
}

// Retailer Products workflow with state persistence and checkpointing
async function retailerProductsSyncWorkflow(workflowId, retailerProductsPath = 'Retailer_Products', resumeInfo = null) {
  const dateNow = new Date();
const [monthNow, dayNow, yearNow] = [dateNow.getMonth() + 1, dateNow.getDate(), dateNow.getFullYear()];
const [hourNow, minutesNow, secondsNow] = [dateNow.getHours(), dateNow.getMinutes(), dateNow.getSeconds()];
const completeDateNow = `${yearNow}-${monthNow}-${dayNow}_${hourNow}:${minutesNow}:${secondsNow}`;

// Use the passed workflowId for the unique key
const syncStatusUniqueKey = `Retailer_Products_${workflowId}_${completeDateNow}`;

  // Check if this is a resume operation
  const isResume = resumeInfo ? true : false;
  const originalWorkflowId = resumeInfo?.originalWorkflowId || null;
  const resumeCheckpoint = resumeInfo?.checkpoint || null;
  const savedWorkflowState = resumeInfo?.workflowState || null;

  if (isResume) {
    log.info(`🔄 Resuming workflow from checkpoint: ${resumeCheckpoint}`);
    log.info(`📋 Original workflow ID: ${originalWorkflowId}`);
  }

  // Initialize workflow state - restore from saved state if resuming
  let workflowState = savedWorkflowState || {
    step1Completed: false,
    step2Completed: false,
    step3Completed: false,
    step4Completed: false,
    fetchResult: null,
    processResult: null,
    insertResult: null,
    errors: [],
    lastCheckpoint: null
  };

  if (isResume && savedWorkflowState) {
    log.info(`🔄 Restored workflow state: ${JSON.stringify(workflowState)}`);
  }

  try {
    // Step 1: Update sync status to Running
    if (!workflowState.step1Completed) {
      if (isResume) {
        log.info('🔄 Resuming: Skipping Step 1 (already completed in original workflow)');
        workflowState.step1Completed = true;
        workflowState.lastCheckpoint = 'status_updated';
      } else {
        log.info('Starting retailer products sync process');
        await saveWorkflowStateToMySQL({
          table_name: "Retailer_Products",
          status: "Running/Temporal Sync",
          unique_key: syncStatusUniqueKey
        });
        workflowState.step1Completed = true;
        workflowState.lastCheckpoint = 'status_updated';
        log.info('✅ Step 1 completed: Sync status updated');
      }
    }

    // Step 2: Fetch retailer products from Firebase
    if (!workflowState.step2Completed) {
      if (isResume && resumeCheckpoint === 'fetch_failed') {
        log.info('🔄 Resuming: Retrying Step 2 (fetch) from previous failure');
      } else if (isResume && resumeCheckpoint === 'fetch_completed') {
        log.info('🔄 Resuming: Skipping Step 2 (fetch already completed)');
        workflowState.step2Completed = true;
        workflowState.lastCheckpoint = 'fetch_completed';
      } else {
        log.info('Fetching retailer products from Firebase');
      }
      
      // Only fetch if we don't have the result or if we're retrying
      if (!isResume || resumeCheckpoint === 'fetch_failed' || !workflowState.fetchResult) {
        const fetchResult = await fetchRetailerProductsFromFirebase(retailerProductsPath);
        console.log({fetchResult})
        workflowState.fetchResult = fetchResult;
        
        if (fetchResult.success) {
          log.info(`✅ Step 2 completed: Fetched ${fetchResult.totalRetailers} retailers`);
          workflowState.step2Completed = true;
          workflowState.lastCheckpoint = 'fetch_completed';
        } else {
          log.error(`❌ Step 2 failed: ${fetchResult.error}`);
          workflowState.errors.push(`Fetch failed: ${fetchResult.error}`);
          workflowState.lastCheckpoint = 'fetch_failed';
          await saveWorkflowStateToMySQL({
            table_name: "Retailer_Products",
            status: "Failed/Fetch_Error",
            unique_key: syncStatusUniqueKey,
            error_message: `Fetch failed: ${fetchResult.error}`,
            checkpoint: 'fetch_failed',
            workflow_state: JSON.stringify(workflowState)
          });
          throw new Error(`Firebase fetch failed: ${fetchResult.error}`);
        }
      } else {
        log.info('🔄 Using cached fetch result from previous execution');
      }
    }

    // Step 3: Process retailer products data
    if (!workflowState.step3Completed && workflowState.fetchResult) {
      log.info('Processing retailer products data');
      let processResult = null;
      if (workflowState.fetchResult && workflowState.fetchResult.dataKey) {
        processResult = await processRetailerProductsData(workflowState.fetchResult.dataKey);
      }
      workflowState.processResult = processResult;
      
      if (processResult.success) {
        log.info(`✅ Step 3 completed: Processed ${processResult.totalProcessed} products`);
        workflowState.step3Completed = true;
        workflowState.lastCheckpoint = 'processing_completed';
      } else {
        log.error(`❌ Step 3 failed after all retries: ${processResult.error}`);
        workflowState.errors.push(`Processing failed: ${processResult.error}`);
        workflowState.lastCheckpoint = 'processing_failed';
        
        // Update sync status to indicate failure and checkpoint
        await saveWorkflowStateToMySQL({
          table_name: "Retailer_Products",
          status: "Failed/Processing_Error",
          unique_key: syncStatusUniqueKey,
          error_message: `Processing failed after retries: ${processResult.error}`,
          checkpoint: 'processing_failed',
          workflow_state: JSON.stringify(workflowState)
        });
        
        // Stop the workflow - don't continue to next steps
        throw new Error(`Data processing failed: ${processResult.error}`);
      }
    }

    // Step 4: Insert retailer products to MySQL
    if (!workflowState.step4Completed && workflowState.processResult) {
      log.info('Inserting retailer products to MySQL');
      let insertResult = null;
      if (workflowState.fetchResult && workflowState.fetchResult.dataKey) {
        insertResult = await insertRetailerProductsToMySQL(workflowState.fetchResult.dataKey);
      }
      workflowState.insertResult = insertResult;
      
      if (insertResult.success) {
        log.info(`✅ Step 4 completed: Inserted ${insertResult.totalProcessed} products`);
        workflowState.step4Completed = true;
        workflowState.lastCheckpoint = 'insertion_completed';
      } else {
        log.error(`❌ Step 4 failed after all retries: ${insertResult.error}`);
        workflowState.errors.push(`Insert failed: ${insertResult.error}`);
        workflowState.lastCheckpoint = 'insertion_failed';
        
        // Update sync status to indicate failure and checkpoint
        await saveWorkflowStateToMySQL({
          table_name: "Retailer_Products",
          status: "Failed/Insertion_Error",
          unique_key: syncStatusUniqueKey,
          error_message: `Insertion failed after retries: ${insertResult.error}`,
          checkpoint: 'insertion_failed',
          workflow_state: JSON.stringify(workflowState)
        });
        
        // Stop the workflow - don't continue to next steps
        throw new Error(`MySQL insertion failed: ${insertResult.error}`);
      }
    }

    // Step 5: Update sync status based on results
    const hasErrors = workflowState.errors.length > 0;
    const hasSuccess = workflowState.insertResult && workflowState.insertResult.totalProcessed > 0;
    
    if (hasSuccess) {
      await completeRetailerProductsSyncStatus(syncStatusUniqueKey);
      log.info('✅ Retailer products sync workflow completed with partial success');
    } else {
      await saveWorkflowStateToMySQL({
        table_name: "Retailer_Products",
        status: "Failed/Temporal Sync",
        unique_key: syncStatusUniqueKey,
        error_message: workflowState.errors.join('; ')
      });
      log.error('❌ Retailer products sync workflow failed completely');
    }

    return {
      success: hasSuccess,
      totalProducts: workflowState.processResult ? workflowState.processResult.totalProcessed : 0,
      totalInserted: workflowState.insertResult ? workflowState.insertResult.totalProcessed : 0,
      totalErrors: workflowState.insertResult ? workflowState.insertResult.totalErrors : 0,
      syncStatusKey: syncStatusUniqueKey,
      errors: workflowState.errors,
      workflowState
    };

  } catch (error) {
    // Update sync status to Failed
    try {
      await saveWorkflowStateToMySQL({
        table_name: "Retailer_Products",
        status: "Failed/Temporal Sync",
        unique_key: syncStatusUniqueKey,
        error_message: error.message
      });
    } catch (statusError) {
      log.error('Failed to update sync status on error', { statusError });
    }

    log.error('Retailer products sync workflow failed', { error });
    
    // Re-throw the error to make the workflow actually fail
    throw error;
  }
}

// New Orders Sync Workflow - using granular steps for better monitoring
async function ordersNewSyncWorkflow(ordersPath = 'Orders_News') {
  const dateNow = new Date();
  const [monthNow, dayNow, yearNow] = [dateNow.getMonth() + 1, dateNow.getDate(), dateNow.getFullYear()];
  const [hourNow, minutesNow, secondsNow] = [dateNow.getHours(), dateNow.getMinutes(), dateNow.getSeconds()];
  const completeDateNow = `${yearNow}-${monthNow}-${dayNow}_${hourNow}:${minutesNow}:${secondsNow}`;
  const syncStatusUniqueKey = `Orders_New_${completeDateNow}`;

  let orders = [];
  let processedOrders = [];
  let deleteResult = null;
  let insertResult = null;

  try {
    log.info('🚀 Starting Orders New Sync Workflow');
    log.info(`📅 Sync Status Key: ${syncStatusUniqueKey}`);
    log.info(`📂 Firebase Path: ${ordersPath}`);

    // Step 1: Initialize sync status
    log.info('📊 Step 1: Initializing sync status...');
    const syncStatusObj = {
      table_name: "Orders_New",
      status: "Initializing/Temporal Sync",
      unique_key: syncStatusUniqueKey
    };
    await updateSyncStatus(syncStatusObj);
    log.info('✅ Step 1 completed: Sync status initialized');

    // Step 2: Update sync status to Running
    log.info('🔄 Step 2: Updating sync status to Running...');
    const runningStatusObj = {
      table_name: "Orders_New",
      status: "Running/Temporal Sync",
      unique_key: syncStatusUniqueKey
    };
    await updateSyncStatus(runningStatusObj);
    log.info('✅ Step 2 completed: Sync status set to Running');

    // Step 3: Validate Firebase path
    log.info('🔍 Step 3: Validating Firebase path...');
    if (!ordersPath || typeof ordersPath !== 'string') {
      throw new Error(`Invalid Firebase path: ${ordersPath}`);
    }
    log.info(`✅ Step 3 completed: Firebase path validated - ${ordersPath}`);

    // Step 4: Delete existing orders from database
    log.info('🗑️ Step 4: Deleting existing orders from database...');
    deleteResult = await deleteExistingOrders();
    log.info(`✅ Step 4 completed: Successfully deleted ${deleteResult.affectedRows} existing orders`);

    // Step 5: Fetch orders from Firebase
    log.info('🔥 Step 5: Fetching orders from Firebase...');
    orders = await fetchOrdersFromFirebase(ordersPath);
    log.info(`✅ Step 5 completed: Fetched ${orders.length} orders from Firebase`);

    // Step 6: Validate fetched data
    log.info('✅ Step 6: Validating fetched data...');
    if (!Array.isArray(orders)) {
      throw new Error('Fetched orders is not an array');
    }
    log.info(`✅ Step 6 completed: Data validation passed - ${orders.length} orders`);

    // Step 7: Process order data
    log.info('⚙️ Step 7: Processing order data...');
    processedOrders = await processOrderData(orders);
    log.info(`✅ Step 7 completed: Processed ${processedOrders.length} orders`);

    // Step 8: Validate processed data
    log.info('✅ Step 8: Validating processed data...');
    if (!Array.isArray(processedOrders)) {
      throw new Error('Processed orders is not an array');
    }
    if (processedOrders.length !== orders.length) {
      log.warn(`⚠️ Warning: Processed orders count (${processedOrders.length}) differs from fetched count (${orders.length})`);
    }
    log.info(`✅ Step 8 completed: Processed data validation passed`);

    // Step 9: Prepare for database insertion
    log.info('📋 Step 9: Preparing for database insertion...');
    if (processedOrders.length === 0) {
      log.info('ℹ️ No orders to insert, skipping database operations');
    } else {
      log.info(`📊 Preparing to insert ${processedOrders.length} orders`);
    }
    log.info('✅ Step 9 completed: Database insertion prepared');

         // Step 10: Insert orders to MySQL
     log.info('💾 Step 10: Inserting orders to MySQL...');
     if (processedOrders.length > 0) {
       insertResult = await insertOrdersNewToMySQL(processedOrders, syncStatusUniqueKey);
       log.info(`✅ Step 10 completed: Successfully processed ${insertResult.totalProcessed} orders in ${insertResult.chunksProcessed} chunks`);
     } else {
       insertResult = { totalProcessed: 0, chunksProcessed: 0 };
       log.info('✅ Step 10 completed: No orders to insert');
     }

    // Step 11: Validate insertion results
    log.info('✅ Step 11: Validating insertion results...');
    if (processedOrders.length > 0 && (!insertResult || insertResult.totalProcessed !== processedOrders.length)) {
      log.warn(`⚠️ Warning: Insertion count (${insertResult?.totalProcessed || 0}) differs from processed count (${processedOrders.length})`);
    }
    log.info('✅ Step 11 completed: Insertion results validated');

    // Step 12: Update final sync status to Completed
    log.info('🏁 Step 12: Updating final sync status to Completed...');
    await updateFinalSyncStatus(syncStatusUniqueKey, "Completed/Temporal Sync");
    log.info('✅ Step 12 completed: Final sync status updated');

    // Step 13: Generate final report
    log.info('📊 Step 13: Generating final report...');
    const finalReport = {
      success: true,
      totalOrders: processedOrders.length,
      deletedOrders: deleteResult.affectedRows,
      insertedOrders: insertResult.totalProcessed,
      chunksProcessed: insertResult.chunksProcessed,
      syncStatusKey: syncStatusUniqueKey,
      statusMessage: "Orders New sync completed successfully",
      timestamp: new Date().toISOString(),
      workflowDuration: Date.now() - dateNow.getTime()
    };
    log.info('✅ Step 13 completed: Final report generated');

    log.info('🎉 Orders new sync workflow completed successfully!');
    log.info(`📈 Summary: ${finalReport.totalOrders} orders processed, ${finalReport.insertedOrders} inserted`);
    
    return finalReport;

  } catch (error) {
    log.error('❌ Orders new sync workflow failed', { error });
    
    // Update sync status to Failed with detailed error information
    try {
      log.info('🔄 Updating sync status to Failed...');
      const failedStatusObj = {
        table_name: "Orders_New",
        status: "Failed/Temporal Sync",
        unique_key: syncStatusUniqueKey,
        error_message: error.message,
        error_details: {
          ordersFetched: orders.length,
          ordersProcessed: processedOrders.length,
          ordersDeleted: deleteResult?.affectedRows || 0,
          ordersInserted: insertResult?.totalProcessed || 0,
          timestamp: new Date().toISOString()
        }
      };
      await updateFinalSyncStatus(syncStatusUniqueKey, "Failed/Temporal Sync");
      log.info('✅ Sync status updated to Failed');
    } catch (statusError) {
      log.error('❌ Failed to update sync status on error', { statusError });
    }

    // Throw detailed error for workflow failure
    const detailedError = {
      message: `Orders sync failed: ${error.message}`,
      details: {
        step: 'Unknown',
        ordersFetched: orders.length,
        ordersProcessed: processedOrders.length,
        ordersDeleted: deleteResult?.affectedRows || 0,
        ordersInserted: insertResult?.totalProcessed || 0,
        originalError: error.message
      }
    };

    throw new Error(JSON.stringify(detailedError));
  }
}

// Salesman Details Sync Workflow - using granular steps for better monitoring
async function salesmanDetailsSyncWorkflow(salesmanPath = 'Salesman_Details') {
  const dateNow = new Date();
  const [monthNow, dayNow, yearNow] = [dateNow.getMonth() + 1, dateNow.getDate(), dateNow.getFullYear()];
  const [hourNow, minutesNow, secondsNow] = [dateNow.getHours(), dateNow.getMinutes(), dateNow.getSeconds()];
  const completeDateNow = `${yearNow}-${monthNow}-${dayNow}_${hourNow}:${minutesNow}:${secondsNow}`;
  const syncStatusUniqueKey = `Salesman_Details_${completeDateNow}`;

  let salesmanDetails = [];
  let processedSalesmanDetails = [];
  let deleteResult = null;
  let insertResult = null;

  try {
    log.info('🚀 Starting Salesman Details Sync Workflow');
    log.info(`📅 Sync Status Key: ${syncStatusUniqueKey}`);
    log.info(`📂 Firebase Path: ${salesmanPath}`);

    // Step 1: Initialize sync status
    log.info('📊 Step 1: Initializing sync status...');
    const syncStatusObj = {
      table_name: "Salesman_Details",
      status: "Initializing/Temporal Sync",
      unique_key: syncStatusUniqueKey
    };
    await updateSyncStatus(syncStatusObj);
    log.info('✅ Step 1 completed: Sync status initialized');

    // Step 2: Update sync status to Running
    log.info('🔄 Step 2: Updating sync status to Running...');
    const runningStatusObj = {
      table_name: "Salesman_Details",
      status: "Running/Temporal Sync",
      unique_key: syncStatusUniqueKey
    };
    await updateSyncStatus(runningStatusObj);
    log.info('✅ Step 2 completed: Sync status set to Running');

    // Step 3: Validate Firebase path
    log.info('🔍 Step 3: Validating Firebase path...');
    if (!salesmanPath || typeof salesmanPath !== 'string') {
      throw new Error(`Invalid Firebase path: ${salesmanPath}`);
    }
    log.info(`✅ Step 3 completed: Firebase path validated - ${salesmanPath}`);

    // Step 4: Delete existing salesman details from database
    log.info('🗑️ Step 4: Deleting existing salesman details from database...');
    deleteResult = await deleteExistingSalesmanDetails();
    log.info(`✅ Step 4 completed: Successfully deleted ${deleteResult.affectedRows} existing salesman details`);

    // Step 5: Fetch salesman details from Firebase
    log.info('🔥 Step 5: Fetching salesman details from Firebase...');
    salesmanDetails = await fetchSalesmanDetailsFromFirebase(salesmanPath);
    log.info(`✅ Step 5 completed: Fetched ${salesmanDetails.length} salesman details from Firebase`);

    // Step 6: Validate fetched data
    log.info('✅ Step 6: Validating fetched data...');
    if (!Array.isArray(salesmanDetails)) {
      throw new Error('Fetched salesman details is not an array');
    }
    log.info(`✅ Step 6 completed: Data validation passed - ${salesmanDetails.length} salesman details`);

    // Step 7: Process salesman details data
    log.info('⚙️ Step 7: Processing salesman details data...');
    processedSalesmanDetails = await processSalesmanDetailsData(salesmanDetails);
    log.info(`✅ Step 7 completed: Processed ${processedSalesmanDetails.length} salesman details`);

    // Step 8: Validate processed data
    log.info('✅ Step 8: Validating processed data...');
    if (!Array.isArray(processedSalesmanDetails)) {
      throw new Error('Processed salesman details is not an array');
    }
    if (processedSalesmanDetails.length !== salesmanDetails.length) {
      log.warn(`⚠️ Warning: Processed salesman details count (${processedSalesmanDetails.length}) differs from fetched count (${salesmanDetails.length})`);
    }
    log.info(`✅ Step 8 completed: Processed data validation passed`);

    // Step 9: Prepare for database insertion
    log.info('📋 Step 9: Preparing for database insertion...');
    if (processedSalesmanDetails.length === 0) {
      log.info('ℹ️ No salesman details to insert, skipping database operations');
    } else {
      log.info(`📊 Preparing to insert ${processedSalesmanDetails.length} salesman details`);
    }
    log.info('✅ Step 9 completed: Database insertion prepared');

    // Step 10: Insert salesman details to MySQL
    log.info('💾 Step 10: Inserting salesman details to MySQL...');
    if (processedSalesmanDetails.length > 0) {
      insertResult = await insertSalesmanDetailsToMySQL(processedSalesmanDetails, syncStatusUniqueKey);
      log.info(`✅ Step 10 completed: Successfully processed ${insertResult.totalProcessed} salesman details in ${insertResult.chunksProcessed} chunks`);
    } else {
      insertResult = { totalProcessed: 0, chunksProcessed: 0 };
      log.info('✅ Step 10 completed: No salesman details to insert');
    }

    // Step 11: Validate insertion results
    log.info('✅ Step 11: Validating insertion results...');
    if (processedSalesmanDetails.length > 0 && (!insertResult || insertResult.totalProcessed !== processedSalesmanDetails.length)) {
      log.warn(`⚠️ Warning: Insertion count (${insertResult?.totalProcessed || 0}) differs from processed count (${processedSalesmanDetails.length})`);
    }
    log.info('✅ Step 11 completed: Insertion results validated');

    // Step 12: Update final sync status to Completed
    log.info('🏁 Step 12: Updating final sync status to Completed...');
    await updateFinalSyncStatus(syncStatusUniqueKey, "Completed/Temporal Sync");
    log.info('✅ Step 12 completed: Final sync status updated');

    // Step 13: Generate final report
    log.info('📊 Step 13: Generating final report...');
    const finalReport = {
      success: true,
      totalSalesmanDetails: processedSalesmanDetails.length,
      deletedSalesmanDetails: deleteResult.affectedRows,
      insertedSalesmanDetails: insertResult.totalProcessed,
      chunksProcessed: insertResult.chunksProcessed,
      syncStatusKey: syncStatusUniqueKey,
      statusMessage: "Salesman Details sync completed successfully",
      timestamp: new Date().toISOString(),
      workflowDuration: Date.now() - dateNow.getTime()
    };
    log.info('✅ Step 13 completed: Final report generated');

    log.info('🎉 Salesman details sync workflow completed successfully!');
    log.info(`📈 Summary: ${finalReport.totalSalesmanDetails} salesman details processed, ${finalReport.insertedSalesmanDetails} inserted`);
    
    return finalReport;

  } catch (error) {
    log.error('❌ Salesman details sync workflow failed', { error });
    
    // Update sync status to Failed with detailed error information
    try {
      log.info('🔄 Updating sync status to Failed...');
      const failedStatusObj = {
        table_name: "Salesman_Details",
        status: "Failed/Temporal Sync",
        unique_key: syncStatusUniqueKey,
        error_message: error.message,
        error_details: {
          salesmanDetailsFetched: salesmanDetails.length,
          salesmanDetailsProcessed: processedSalesmanDetails.length,
          salesmanDetailsDeleted: deleteResult?.affectedRows || 0,
          salesmanDetailsInserted: insertResult?.totalProcessed || 0,
          timestamp: new Date().toISOString()
        }
      };
      await updateFinalSyncStatus(syncStatusUniqueKey, "Failed/Temporal Sync");
      log.info('✅ Sync status updated to Failed');
    } catch (statusError) {
      log.error('❌ Failed to update sync status on error', { statusError });
    }

    // Throw detailed error for workflow failure
    const detailedError = {
      message: `Salesman details sync failed: ${error.message}`,
      details: {
        step: 'Unknown',
        salesmanDetailsFetched: salesmanDetails.length,
        salesmanDetailsProcessed: processedSalesmanDetails.length,
        salesmanDetailsDeleted: deleteResult?.affectedRows || 0,
        salesmanDetailsInserted: insertResult?.totalProcessed || 0,
        originalError: error.message
      }
    };

    throw new Error(JSON.stringify(detailedError));
  }
}

module.exports = { 
  saveRetailersFromFirebaseToMysqlWorkflow,
  ordersYesterdayTransferWorkflow,
  retailerProductsSyncWorkflow,
  ordersNewSyncWorkflow,
  salesmanDetailsSyncWorkflow
};