// src/activities.js
require('dotenv').config();
const { ref, get, child, database } = require('../../database/firebase-config.js');
const { promisePool } = require('../../database/mysql-connection.js');
const { ApplicationFailure } = require('@temporalio/activity');
const request = require('request');

const BASE_URL = process.env.BASE_URL || 'https://dev-services.superzop.com';

// Activity: Update sync status
async function updateSyncStatus(syncStatusObj) {
  const sync_status_url = `${BASE_URL}/api/superzop/admin/sync_status/insertupdatesyncstatus`;
  const options = {
    url: sync_status_url,
    body: syncStatusObj,
    json: true,
    headers: { 'Content-Type': 'application/json' }
  };

  return new Promise((resolve, reject) => {
    request.post(options, (err, res, body) => {
      if (err) {
        console.error('Sync status update error:', err);
        reject(ApplicationFailure.nonRetryable(err.message));
      } else {
        console.log(`Sync status updated: ${res.statusCode}`);
        resolve({ statusCode: res.statusCode, body });
      }
    });
  });
}

// Activity: Delete existing orders
async function deleteExistingOrders() {
  try {
    console.log("Starting to delete existing orders from Orders_News table...");
    
    const [results] = await promisePool.execute("DELETE FROM superzop_ordering.Orders_News");
    
    console.log("Deleted Orders_News Successfully");
    console.log(`Affected rows: ${results.affectedRows}`);
    
    return { success: true, affectedRows: results.affectedRows };
  } catch (error) {
    console.error('Failed to delete existing orders:', error);
    throw ApplicationFailure.nonRetryable(`Failed to delete existing orders: ${error.message}`);
  }
}

// Activity: Fetch orders from Firebase
async function fetchOrdersFromFirebase(ordersPath = 'Orders_News') {
  try {
    console.log(`Fetching orders from Firebase at path: ${ordersPath}`);
    
    const snapshot = await get(ref(database, ordersPath));
    
    console.log('Orders data fetched from Firebase');
    console.log('Firebase orders count:', snapshot.size);
    
    const orders = [];
    snapshot.forEach((childSnapshot) => {
      const orderVal = childSnapshot.val();
      if (orderVal) {
        orders.push({ ...orderVal, firebase_key: childSnapshot.key });
      }
    });
    
    console.log("Orders count:", orders.length);
    if (orders.length > 0) {
      console.log("Sample order data:", orders[0]);
    }
    
    return orders;
  } catch (error) {
    console.error("Firebase read failed:", error);
    throw ApplicationFailure.nonRetryable(`Failed to fetch orders from Firebase: ${error.message}`);
  }
}

// Activity: Process order data
async function processOrderData(orders) {
  try {
    return orders.map(order => {
      // Add any order-specific processing logic here
      // For example, date conversions, data cleaning, etc.
      return {
        ...order,
        // Add any processed fields here
      };
    });
  } catch (error) {
    throw ApplicationFailure.nonRetryable(error.message);
  }
}

// Activity: Insert orders to MySQL in chunks
async function insertOrdersToMySQL(orders, syncStatusUniqueKey, chunkSize = 1000) {
  try {
    const chunks = Array.from({ length: Math.ceil(orders.length / chunkSize) }, (_, i) =>
      orders.slice(i * chunkSize, (i + 1) * chunkSize)
    );

    for (let i = 0; i < chunks.length; i++) {
      await insertOrderChunk(chunks[i], syncStatusUniqueKey, i === 0);
    }

    return { totalProcessed: orders.length, chunksProcessed: chunks.length };
  } catch (error) {
    throw ApplicationFailure.nonRetryable(error.message);
  }
}

// Helper function to insert a single chunk
async function insertOrderChunk(orders, syncStatusUniqueKey, isFirstChunk = false) {
  try {
    if (isFirstChunk) {
      await promisePool.execute('DELETE FROM superzop_ordering.Orders_News');
      console.log('Cleared existing orders from database');
    }
    if (orders.length === 0) return;

    // Define your order columns here based on your database schema
    const columns = `
      order_id, customer_id, retailer_id, order_date, delivery_date, 
      total_amount, status, sync_status_unique_key
    `.trim().replace(/\s+/g, '').split(',').join(', ');

    const baseQuery = `INSERT INTO superzop_ordering.Orders_News (${columns}) VALUES `;

    const valueStrings = [];
    const params = [];

    function safe(val) {
      return val === undefined ? null : val;
    }

    for (const order of orders) {
      valueStrings.push(`(${new Array(8).fill('?').join(', ')})`);
      
      params.push(
        safe(order.order_id),
        safe(order.customer_id),
        safe(order.retailer_id),
        safe(order.order_date),
        safe(order.delivery_date),
        safe(order.total_amount),
        safe(order.status),
        safe(syncStatusUniqueKey)
      );
    }

    const duplicateKeyUpdate = `
      ON DUPLICATE KEY UPDATE
        customer_id=VALUES(customer_id),
        retailer_id=VALUES(retailer_id),
        order_date=VALUES(order_date),
        delivery_date=VALUES(delivery_date),
        total_amount=VALUES(total_amount),
        status=VALUES(status),
        sync_status_unique_key=VALUES(sync_status_unique_key)
    `;

    const finalQuery = baseQuery + valueStrings.join(', ') + ' ' + duplicateKeyUpdate;

    const [results] = await promisePool.execute(finalQuery, params);
    console.log(`Inserted chunk of ${orders.length} orders`);
    return results;

  } catch (error) {
    console.error('Error inserting order chunk:', error);
    throw error;
  }
}

// Activity: Update final sync status
async function updateFinalSyncStatus(syncStatusUniqueKey, status) {
  const syncStatusObj = {
    unique_key: syncStatusUniqueKey,
    status: status
  };

  const sync_status_url = `${BASE_URL}/api/superzop/admin/sync_status/insertupdatesyncstatus`;
  const options = {
    url: sync_status_url,
    body: syncStatusObj,
    json: true,
    headers: { 'Content-Type': 'application/json' }
  };

  return new Promise((resolve, reject) => {
    request.post(options, (err, res, body) => {
      if (err) {
        console.error('Final sync status update failed:', err);
        reject(ApplicationFailure.nonRetryable(err.message));
      } else {
        console.log(`Final sync status updated to ${status}. Status: ${res.statusCode}`);
        resolve({ statusCode: res.statusCode, body });
      }
    });
  });
}

// Main activity function that matches the saveOrdersNewToMysql structure
async function saveOrdersNewToMysql(ordersPath = 'Orders_News') {
  const dateNow = new Date();
  const [monthNow, dayNow, yearNow] = [dateNow.getMonth() + 1, dateNow.getDate(), dateNow.getFullYear()];
  const [hourNow, minutesNow, secondsNow] = [dateNow.getHours(), dateNow.getMinutes(), dateNow.getSeconds()];
  const completeDateNow = `${yearNow}-${monthNow}-${dayNow}_${hourNow}:${minutesNow}:${secondsNow}`;
  const syncStatusUniqueKey = `Orders_New_${completeDateNow}`;

  try {
    console.log('🚀 Starting Orders New Sync Process...');
    console.log(`📅 Sync Status Key: ${syncStatusUniqueKey}`);
    console.log(`📂 Firebase Path: ${ordersPath}`);

    // Step 1: Update sync status to Running
    console.log('📊 Step 1: Updating sync status to Running...');
    const syncStatusObj = {
      table_name: "Orders_New",
      status: "Running",
      unique_key: syncStatusUniqueKey
    };

    console.log('syncStatusObj: ', syncStatusObj);
    await updateSyncStatus(syncStatusObj);
    console.log('✅ Step 1 completed: Sync status updated');

    // Step 2: Delete existing orders
    console.log('🗑️ Step 2: Deleting existing orders from database...');
    const deleteResult = await deleteExistingOrders();
    console.log(`✅ Step 2 completed: Successfully deleted ${deleteResult.affectedRows} existing orders`);

    // Step 3: Fetch orders from Firebase
    console.log('🔥 Step 3: Fetching orders from Firebase...');
    const orders = await fetchOrdersFromFirebase(ordersPath);
    console.log(`✅ Step 3 completed: Fetched ${orders.length} orders from Firebase`);

    // Step 4: Process order data
    console.log('⚙️ Step 4: Processing order data...');
    const processedOrders = await processOrderData(orders);
    console.log(`✅ Step 4 completed: Processed ${processedOrders.length} orders`);

    // Step 5: Insert orders to MySQL
    console.log('💾 Step 5: Inserting orders to MySQL...');
    const insertResult = await insertOrdersToMySQL(processedOrders, syncStatusUniqueKey);
    console.log(`✅ Step 5 completed: Successfully processed ${insertResult.totalProcessed} orders in ${insertResult.chunksProcessed} chunks`);

    // Step 6: Update final sync status to Completed
    console.log('🏁 Step 6: Updating final sync status to Completed...');
    await updateFinalSyncStatus(syncStatusUniqueKey, "Completed");
    console.log('✅ Step 6 completed: Final sync status updated');

    console.log('🎉 Orders new sync completed successfully!');
    return {
      success: true,
      totalOrders: processedOrders.length,
      deletedOrders: deleteResult.affectedRows,
      syncStatusKey: syncStatusUniqueKey,
      statusMessage: "Saved Orders New to MySql"
    };

  } catch (error) {
    console.error('❌ Orders new sync failed:', error);
    
    // Update sync status to Failed
    try {
      console.log('🔄 Updating sync status to Failed...');
      await updateFinalSyncStatus(syncStatusUniqueKey, "Failed");
      console.log('✅ Sync status updated to Failed');
    } catch (statusError) {
      console.error('❌ Failed to update sync status on error', { statusError });
    }

    throw ApplicationFailure.nonRetryable(`Orders sync failed: ${error.message}`);
  }
}

module.exports = {
  updateSyncStatus,
  deleteExistingOrders,
  fetchOrdersFromFirebase,
  processOrderData,
  insertOrdersNewToMySQL: insertOrdersToMySQL,
  updateFinalSyncStatus,
  saveOrdersNewToMysql
};