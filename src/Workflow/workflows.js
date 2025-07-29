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
  
  // updateSubArea1FromRetailerSubAreaTable
} = proxyActivities({
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '30 seconds',
  retry: {
    initialInterval: '1 second',
    maximumInterval: '30 seconds',
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

module.exports = { 
  saveRetailersFromFirebaseToMysqlWorkflow,
  ordersYesterdayTransferWorkflow 
};