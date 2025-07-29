// src/activities.js
const { ref, get, child, database, once } = require('../../database/firebase-config.js');
const { promisePool } = require('../../database/mysql-connection.js');
const { ApplicationFailure } = require('@temporalio/activity');
const request = require('request');
require('dotenv').config();

const BASE_URL = process.env.ORDERING_APP_BASE_URL // || 'https://dev-services.superzop.com';

// Activity: Update sync status
async function updateSyncStatus(syncStatusObj) {
  const sync_status_url = `${BASE_URL}/api/superzop/admin/sync_status/insertupdatesyncstatus`;
  const options = {
    url: sync_status_url,
    body: JSON.stringify(syncStatusObj),
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

// Activity: Process yesterday's orders transfer
async function ordersYesterdayTransferActivity({ ordersYestQuery }) {
  try {
    // Generate sync status tracking info
    const dateNow = new Date();
    const [monthNow, dayNow, yearNow] = [
      dateNow.getMonth() + 1, 
      dateNow.getDate(), 
      dateNow.getFullYear()
    ];
    const [hourNow, minutesNow, secondsNow] = [
      dateNow.getHours(), 
      dateNow.getMinutes(), 
      dateNow.getSeconds()
    ];
    const completDateNow = `${yearNow}-${monthNow}-${dayNow}_${hourNow}:${minutesNow}:${secondsNow}`;
    const syncStatusUniqueKey = `Orders_New_To_Orders_${completDateNow}`;

    const syncStatusObj = {
      table_name: "Orders_New_To_Orders",
      status: "Running",
      unique_key: syncStatusUniqueKey
    };

    // Update sync status to running
    await updateSyncStatus(syncStatusObj);

    console.log(`Starting orders yesterday transfer: ${syncStatusUniqueKey}`);

    // Initialize counters
    let orderId = '';
    let orders_count = 0;
    let orders_val = 0;
    let orders_cancelled_count = 0;
    let orders_cancelled_val = 0;

    const orders = [];
    const processedOrders = [];

    // Set up date for processing
    const currentDate = new Date();
    currentDate.setHours(18, 30, 0, 0);

    const day = currentDate.getDate();
    const month = currentDate.getMonth() + 1;
    const year = currentDate.getFullYear();
    const dateFormat = `${day}-${month}-${year}`;

    // Fetch orders from Firebase
    const snapshot = await get(ref(database, ordersYestQuery));
    console.log(`Firebase orders count: ${snapshot.size}`);

    // Process each order
    snapshot.forEach((childSnapshot) => {
      const key = childSnapshot.key;
      const val = childSnapshot.val();

      if (!val) return;

      const {
        retailer_id: retailer_id_data,
        item_id: item_id_data,
        order_number: order_number_data,
        order_amt: order_amt_data,
        status: order_status,
        customer_id
      } = val;

      // Process retailer orders (exclude test orders)
      if (retailer_id_data < 90000) {
        if (orderId.toLowerCase() !== order_number_data.toLowerCase()) {
          if (order_status.toLowerCase() !== "cancelled") {
            orderId = order_number_data;
            orders_count += 1;
            orders_val += parseFloat(order_amt_data) || 0;
          } else {
            orderId = order_number_data;
            orders_cancelled_count += 1;
            orders_cancelled_val += parseFloat(order_amt_data) || 0;
          }
        }
      }

      // Create order history key
      const orderHistkey = order_number_data.replace(/\//g, "-") + "-" + item_id_data;

      orders.push(val);
      processedOrders.push({
        key,
        orderHistkey,
        retailer_id: retailer_id_data,
        order_number: order_number_data,
        status: order_status
      });
    });

    console.log(`Processed orders count: ${orders.length}`);
    console.log(`Valid orders count: ${orders_count}`);
    console.log(`Cancelled orders count: ${orders_cancelled_count}`);

    return {
      success: true,
      syncStatusUniqueKey,
      processedOrdersCount: orders.length,
      validOrdersCount: orders_count,
      cancelledOrdersCount: orders_cancelled_count,
      totalOrdersValue: orders_val,
      totalCancelledValue: orders_cancelled_val,
      dateProcessed: dateFormat,
      orders: orders,
      processedOrders: processedOrders
    };

  } catch (error) {
    console.error('Orders yesterday transfer activity failed:', error);
    throw ApplicationFailure.nonRetryable(`Orders yesterday transfer failed: ${error.message}`);
  }
}

// Activity: Insert orders to Firebase history
async function insertOrdersToFirebaseHistory({ orders, processedOrders, dateInfo }) {
  try {
    const { day, month, year, dateFormat } = dateInfo;
    
    console.log(`Inserting ${orders.length} orders to Firebase history`);

    // Get Firebase references
    const ordersHistoryRef = ref(database, 'OrdersHistory');
    const ordersHistDatewiseRef = ref(database, 'OrdersHistoryDatewise');

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < orders.length; i++) {
      try {
        const val = orders[i];
        const orderInfo = processedOrders[i];
        const { retailer_id_data, customer_id } = val;
        const { orderHistkey } = orderInfo;

        // Save to retailer/customer specific history
        if (retailer_id_data !== 0) {
          await ref(ordersHistoryRef, `${retailer_id_data}/${orderHistkey}`).set(val);
        } else {
          await ref(ordersHistoryRef, `${customer_id}/${orderHistkey}`).set(val);
        }

        // Save to date-wise history
        await ref(ordersHistDatewiseRef, `${year}/${month}/${dateFormat}/${orderHistkey}`).set(val);

        successCount++;
      } catch (error) {
        console.error(`Error inserting order ${orderInfo.orderHistkey}:`, error);
        errorCount++;
      }
    }

    console.log(`Firebase history insertion completed: ${successCount} success, ${errorCount} errors`);

    return {
      success: true,
      totalOrders: orders.length,
      successCount,
      errorCount
    };

  } catch (error) {
    console.error('Firebase history insertion failed:', error);
    throw ApplicationFailure.nonRetryable(`Firebase history insertion failed: ${error.message}`);
  }
}

// Activity: Insert orders to MySQL in chunks
async function insertOrdersToMySQL(orders, chunkSize = 1000) {
  try {
    console.log(`Inserting ${orders.length} orders to MySQL`);

    const chunks = Array.from({ length: Math.ceil(orders.length / chunkSize) }, (_, i) =>
      orders.slice(i * chunkSize, (i + 1) * chunkSize)
    );

    let totalProcessed = 0;
    let totalErrors = 0;

    for (let i = 0; i < chunks.length; i++) {
      try {
        const result = await insertOrderChunk(chunks[i]);
        totalProcessed += result.processedCount;
        console.log(`Processed chunk ${i + 1}/${chunks.length}: ${result.processedCount} orders`);
      } catch (error) {
        console.error(`Error processing chunk ${i + 1}:`, error);
        totalErrors += chunks[i].length;
      }
    }

    return { 
      success: true,
      totalOrders: orders.length,
      totalProcessed, 
      totalErrors,
      chunksProcessed: chunks.length 
    };

  } catch (error) {
    console.error('MySQL insertion failed:', error);
    throw ApplicationFailure.nonRetryable(`MySQL insertion failed: ${error.message}`);
  }
}

// Helper function to insert a single chunk of orders
async function insertOrderChunk(orders) {
  try {
    if (orders.length === 0) return { processedCount: 0 };

    const columns = `
      area, card_amt, cash_amt, cashback_availed, cashback_redeemed, cf_transaction_id,
      cheque_date, coupon_code, credit_amt, dealer_price, delivery_date, distributor_id,
      ean, exp_delivery_date, final_order_amt, item_disc, item_id, market_price, mrp,
      mtd_exclude, net_amt, net_order_amt, offer_disc, offer_id, offer_price, order_amt,
      order_date, order_disc, order_number, order_payment_mode, order_qty, paid_date,
      paytm_amt, price, retailer_id, revised_order_amt, scheme_amt, shipping_charges,
      status, total_amt, update_status, vat_amt, vat_percent, customer_id
    `.trim().replace(/\s+/g, '').split(',').join(', ');

    const baseQuery = `INSERT INTO Orders (${columns}) VALUES `;
    const valueStrings = [];
    const params = [];

    function safe(val) {
      return val === undefined || val === null ? null : val;
    }

    for (const order of orders) {
      valueStrings.push(`(${new Array(43).fill('?').join(', ')})`);
      
      params.push(
        safe(order.area),
        safe(order.card_amt),
        safe(order.cash_amt),
        safe(order.cashback_availed),
        safe(order.cashback_redeemed),
        safe(order.cf_transaction_id),
        safe(order.cheque_date),
        safe(order.coupon_code),
        safe(order.credit_amt),
        safe(order.dealer_price),
        safe(order.delivery_date),
        safe(order.distributor_id),
        safe(order.ean),
        safe(order.exp_delivery_date),
        safe(order.final_order_amt),
        safe(order.item_disc),
        safe(order.item_id),
        safe(order.market_price),
        safe(order.mrp),
        safe(order.mtd_exclude),
        safe(order.net_amt),
        safe(order.net_order_amt),
        safe(order.offer_disc),
        safe(order.offer_id),
        safe(order.offer_price),
        safe(order.order_amt),
        safe(order.order_date),
        safe(order.order_disc),
        safe(order.order_number),
        safe(order.order_payment_mode),
        safe(order.order_qty),
        safe(order.paid_date),
        safe(order.paytm_amt),
        safe(order.price),
        safe(order.retailer_id),
        safe(order.revised_order_amt),
        safe(order.scheme_amt),
        safe(order.shipping_charges),
        safe(order.status),
        safe(order.total_amt),
        safe(order.update_status),
        safe(order.vat_amt),
        safe(order.vat_percent),
        safe(order.customer_id)
      );
    }

    const duplicateKeyUpdate = `
      ON DUPLICATE KEY UPDATE
        area=VALUES(area),
        card_amt=VALUES(card_amt),
        cash_amt=VALUES(cash_amt),
        status=VALUES(status),
        delivery_date=VALUES(delivery_date),
        update_status=VALUES(update_status)
    `;

    const finalQuery = baseQuery + valueStrings.join(', ') + ' ' + duplicateKeyUpdate;
    const [results] = await promisePool.execute(finalQuery, params);

    return { processedCount: orders.length, affectedRows: results.affectedRows };

  } catch (error) {
    console.error('Error inserting order chunk:', error);
    throw error;
  }
}

// Activity: Call order new yesterday transfer
async function callOrderNewYesterdayTransfer({ day, month, year, dateFormat, orders, syncStatusUniqueKey }) {
  const url = `${BASE_URL}/api/superzop/admin/orders/ordernew_yesterday_transfer`;
  const options = {
    url,
    method: 'POST',
    json: true,
    body: {
      day,
      month,
      year,
      dateFormat,
      orders,
      syncStatusUniqueKey
    },
    headers: { 'Content-Type': 'application/json' }
  };

  return new Promise((resolve, reject) => {
    request(options, (err, res, body) => {
      if (err) {
        reject(ApplicationFailure.nonRetryable(err.message));
      } else {
        console.log(`Order new yesterday transfer completed: ${res.statusCode}`);
        resolve({ statusCode: res.statusCode, body });
      }
    });
  });
}

// Activity: Complete sync status
async function completeSyncStatus(syncStatusUniqueKey) {
  try {
    const syncStatusObj = {
      table_name: "Orders_New_To_Orders",
      status: "Completed",
      unique_key: syncStatusUniqueKey
    };

    await updateSyncStatus(syncStatusObj);
    console.log(`✅ Sync status completed: ${syncStatusUniqueKey}`);

    return { success: true, syncStatusUniqueKey };
  } catch (error) {
    console.error(`❌ Failed to complete sync status: ${error.message}`);
    throw ApplicationFailure.nonRetryable(error.message);
  }
}

module.exports = {
  updateSyncStatus,
  ordersYesterdayTransferActivity,
  insertOrdersToFirebaseHistory,
  insertOrdersToMySQL,
  callOrderNewYesterdayTransfer,
  completeSyncStatus
};