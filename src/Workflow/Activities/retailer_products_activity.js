// src/retailer_products_activity.js
require('dotenv').config();

console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? '***' : '(empty)');
console.log('DB_NAME:', process.env.DB_NAME);



const { ref, get, child, database } = require('../../database/firebase-config.js');
const { promisePool } = require('../../database/mysql-connection.js');
const { ApplicationFailure } = require('@temporalio/activity');
const request = require('request');
const { v4: uuidv4 } = require('uuid');


const BASE_URL = process.env.BASE_URL || 'https://dev-services.superzop.com';

// Activity: Update sync status for retailer products
async function updateRetailerProductsSyncStatus(syncStatusObj) {
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
        console.error('Retailer products sync status update error:', err);
        reject(ApplicationFailure.nonRetryable(err.message));
      } else {
        console.log(`Retailer products sync status updated: ${res.statusCode}`);
        resolve({ statusCode: res.statusCode, body });
      }
    });
  });
}

// Activity: Fetch retailer products from Firebase (single attempt, store large data externally)
async function fetchRetailerProductsFromFirebase(retailerProductsPath = 'Retailer_Products') {
  try {
    console.log(`Fetching retailer products from Firebase at path: ${retailerProductsPath}`);
    const snapshot = await get(ref(database, retailerProductsPath));
    console.log("Firebase retailer products count:", snapshot.size);

    const retailerProducts = [];
    snapshot.forEach((childSnapshot) => {
      const retailerData = childSnapshot.val();
      if (retailerData) {
        retailerProducts.push({ 
          retailer_id: childSnapshot.key, 
          products: retailerData 
        });
      }
    });

    console.log("Retailer products count:", retailerProducts.length);
    if (retailerProducts.length > 0) {
      console.log("Sample retailer products data:", retailerProducts[0]);
    }

    // Store the large data in MySQL as a JSON blob with a unique key
    const dataKey = `retailer_products_${Date.now()}_${uuidv4()}`;
    await promisePool.execute(
      `INSERT INTO Retailer_Products_FetchCache (data_key, data_json, created_at) VALUES (?, ?, NOW())`,
      [dataKey, JSON.stringify(retailerProducts)]
    );

    return {
      success: true,
      dataKey,
      totalRetailers: retailerProducts.length
    };

  } catch (error) {
    console.error('Firebase fetch failed:', error.message);
    return {
      success: false,
      dataKey: null,
      totalRetailers: 0,
      error: error.message
    };
  }
}
// Refactored: processRetailerProductsData now takes dataKey, loads data, processes, and returns only summary
async function processRetailerProductsData(dataKey, maxRetries = 3) {
  let lastError;
  let retailerProducts = [];
  try {
    // Load the data from the cache table
    const [rows] = await promisePool.execute(
      `SELECT data_json FROM Retailer_Products_FetchCache WHERE data_key = ?`,
      [dataKey]
    );
    if (rows && rows.length > 0) {
      retailerProducts = JSON.parse(rows[0].data_json);
    }
  } catch (error) {
    return {
      success: false,
      totalProcessed: 0,
      totalErrors: 0,
      error: 'Failed to load retailer products from cache: ' + error.message
    };
  }

  try {
    const processedProducts = [];
    let processedCount = 0;
    let errorCount = 0;
    for (const retailer of retailerProducts) {
      try {
        const { retailer_id, products } = retailer;
        if (products && typeof products === 'object') {
          for (const itemId in products) {
            try {
              const itemData = products[itemId];
              if (itemData && typeof itemData === 'object') {
                processedProducts.push({
                  retailer_id: retailer_id,
                  item_id: itemId,
                  ...itemData
                });
                processedCount++;
              }
            } catch (itemError) {
              errorCount++;
            }
          }
        }
      } catch (retailerError) {
        errorCount++;
      }
    }
    return {
      success: true,
      totalProcessed: processedCount,
      totalErrors: errorCount
    };
  } catch (error) {
    lastError = error;
    return {
      success: false,
      totalProcessed: 0,
      totalErrors: retailerProducts.length,
      error: error.message
    };
  }
}

// Refactored: insertRetailerProductsToMySQL now takes dataKey, loads data, and inserts
async function insertRetailerProductsToMySQL(dataKey, chunkSize = 1000, maxRetries = 3) {
  try {
    console.log('[insertRetailerProductsToMySQL] dataKey:', dataKey, 'chunkSize:', chunkSize, 'maxRetries:', maxRetries);
    // Load the data from the cache table
    let retailerProducts = [];
    try {
      const [rows] = await promisePool.execute(
        `SELECT data_json FROM Retailer_Products_FetchCache WHERE data_key = ?`,
        [dataKey]
      );
      if (rows && rows.length > 0) {
        retailerProducts = JSON.parse(rows[0].data_json);
      }
    } catch (error) {
      console.error('[insertRetailerProductsToMySQL] Failed to load retailer products from cache:', error && error.message ? error.message : error);
      return {
        success: false,
        totalProducts: 0,
        totalProcessed: 0,
        totalErrors: 0,
        error: '[insertRetailerProductsToMySQL] Failed to load retailer products from cache: ' + (error && error.message ? error.message : JSON.stringify(error))
      };
    }
    if (!Array.isArray(retailerProducts)) {
      console.error('[insertRetailerProductsToMySQL] retailerProducts is not an array.');
      return {
        success: false,
        totalProducts: 0,
        totalProcessed: 0,
        totalErrors: 0,
        error: '[insertRetailerProductsToMySQL] retailerProducts is not an array.'
      };
    }
    try {
      console.log(`[insertRetailerProductsToMySQL] Inserting ${retailerProducts.length} retailer products to MySQL`);
      const chunks = Array.from({ length: Math.ceil(retailerProducts.length / chunkSize) }, (_, i) =>
        retailerProducts.slice(i * chunkSize, (i + 1) * chunkSize)
      );
      let totalProcessed = 0;
      let totalErrors = 0;
      let successfulChunks = 0;
      let failedChunks = 0;
      for (let i = 0; i < chunks.length; i++) {
        let chunkSuccess = false;
        let lastChunkError;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            console.log(`[insertRetailerProductsToMySQL] Processing chunk ${i + 1}/${chunks.length} (attempt ${attempt}/${maxRetries})`);
            const result = await insertRetailerProductsChunk(chunks[i]);
            totalProcessed += result.processedCount;
            successfulChunks++;
            chunkSuccess = true;
            console.log(`[insertRetailerProductsToMySQL] ✅ Chunk ${i + 1}/${chunks.length} processed successfully: ${result.processedCount} products`);
            break; // Success, exit retry loop
          } catch (error) {
            lastChunkError = error;
            console.error(`[insertRetailerProductsToMySQL] ❌ Chunk ${i + 1}/${chunks.length} attempt ${attempt}/${maxRetries} failed:`, error && error.message ? error.message : error);
            if (attempt < maxRetries) {
              const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
              console.log(`[insertRetailerProductsToMySQL] Waiting ${waitTime}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
            }
          }
        }
        if (!chunkSuccess) {
          console.error(`[insertRetailerProductsToMySQL] ❌ Chunk ${i + 1}/${chunks.length} failed after ${maxRetries} attempts. Last error:`, lastChunkError && lastChunkError.message ? lastChunkError.message : lastChunkError);
          totalErrors += Array.isArray(chunks[i]) ? chunks[i].length : 0;
          failedChunks++;
          // Continue with next chunk instead of failing entire process
        }
      }
      const success = successfulChunks > 0; // Consider successful if at least one chunk succeeded
      console.log(`[insertRetailerProductsToMySQL] 📊 MySQL insertion summary: ${successfulChunks} successful chunks, ${failedChunks} failed chunks`);
      console.log(`[insertRetailerProductsToMySQL] 📊 Total processed: ${totalProcessed}, Total errors: ${totalErrors}`);
      return { 
        success,
        totalProducts: retailerProducts.length,
        totalProcessed, 
        totalErrors,
        chunksProcessed: chunks.length,
        successfulChunks,
        failedChunks
      };
    } catch (error) {
      console.error('[insertRetailerProductsToMySQL] MySQL insertion failed:', error && error.message ? error.message : error);
      return {
        success: false,
        totalProducts: Array.isArray(retailerProducts) ? retailerProducts.length : 0,
        totalProcessed: 0,
        totalErrors: Array.isArray(retailerProducts) ? retailerProducts.length : 0,
        chunksProcessed: 0,
        successfulChunks: 0,
        failedChunks: 0,
        error: '[insertRetailerProductsToMySQL] MySQL insertion failed: ' + (error && error.message ? error.message : JSON.stringify(error))
      };
    }
  } catch (error) {
    console.error('[insertRetailerProductsToMySQL] Top-level error:', error && error.message ? error.message : error);
    return {
      success: false,
      totalProducts: 0,
      totalProcessed: 0,
      totalErrors: 0,
      chunksProcessed: 0,
      successfulChunks: 0,
      failedChunks: 0,
      error: '[insertRetailerProductsToMySQL] Top-level error: ' + (error && error.message ? error.message : JSON.stringify(error))
    };
  }
}

// Helper function to insert a single chunk of retailer products
async function insertRetailerProductsChunk(products) {
  try {
    if (products.length === 0) return { processedCount: 0 };

    // Define the expected fields for Retailer_Products table
    const expectedFields = [
      'price', 'mrp', 'dealer_price', 'market_price', 'offer_price',
      'item_disc', 'offer_disc', 'scheme_amt', 'vat_amt', 'vat_percent',
      'order_qty', 'status', 'update_status', 'last_updated'
    ];

    const columns = `retailer_id, item_id, ${expectedFields.join(', ')}`;
    const baseQuery = `INSERT INTO Retailer_Products (${columns}) VALUES `;
    const valueStrings = [];
    const params = [];

    function safe(val) {
      return val === undefined || val === null ? null : val;
    }

    for (const product of products) {
      valueStrings.push(`(${new Array(expectedFields.length + 2).fill('?').join(', ')})`);
      
      const rowParams = [
        safe(product.retailer_id),
        safe(product.item_id)
      ];

      expectedFields.forEach(field => {
        rowParams.push(safe(product[field]));
      });

      params.push(...rowParams);
    }

    const duplicateKeyUpdate = `
      ON DUPLICATE KEY UPDATE
        ${expectedFields.map(field => `${field}=VALUES(${field})`).join(', ')}
    `;

    const finalQuery = baseQuery + valueStrings.join(', ') + ' ' + duplicateKeyUpdate;
    const [results] = await promisePool.execute(finalQuery, params);

    return { processedCount: products.length, affectedRows: results.affectedRows };

  } catch (error) {
    console.error('Error inserting retailer products chunk:', error);
    throw error;
  }
}

// Activity: Save workflow state to MySQL database
async function saveWorkflowStateToMySQL(syncStatusObj) {
  try {
    console.log(`💾 Saving workflow state to MySQL:`, {
      table_name: syncStatusObj.table_name,
      status: syncStatusObj.status,
      unique_key: syncStatusObj.unique_key,
      hasWorkflowState: !!syncStatusObj.workflow_state,
      hasCheckpoint: !!syncStatusObj.checkpoint
    });

    const query = `
      INSERT INTO superzop_delivery.Sync_Status (
        table_name, status, unique_key, error_message, 
        checkpoint, workflow_state, sync_start_time
      ) VALUES (?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        error_message = VALUES(error_message),
        checkpoint = VALUES(checkpoint),
        workflow_state = VALUES(workflow_state),
        sync_start_time = NOW()
    `;

    const params = [
      syncStatusObj.table_name,
      syncStatusObj.status,
      syncStatusObj.unique_key,
      syncStatusObj.error_message || null,
      syncStatusObj.checkpoint || null,
      syncStatusObj.workflow_state || null
    ];

    const [result] = await promisePool.execute(query, params);
    console.log(`✅ Workflow state saved to MySQL: ${result.affectedRows} rows affected`);

    return { success: true, affectedRows: result.affectedRows };
  } catch (error) {
    console.error(`❌ Failed to save workflow state to MySQL: ${error.message}`);
    throw ApplicationFailure.nonRetryable(`Failed to save workflow state: ${error.message}`);
  }
}

// Activity: Complete retailer products sync status
async function completeRetailerProductsSyncStatus(syncStatusUniqueKey) {
  try {
    const syncStatusObj = {
      table_name: "Retailer_Products",
      status: "Completed",
      unique_key: syncStatusUniqueKey
    };

    // Only save to local MySQL
    await saveWorkflowStateToMySQL(syncStatusObj);
    console.log(`✅ Retailer products sync status completed: ${syncStatusUniqueKey}`);

    return { success: true, syncStatusUniqueKey };
  } catch (error) {
    console.error(`❌ Failed to complete retailer products sync status: ${error.message}`);
    throw ApplicationFailure.nonRetryable(error.message);
  }
}

// Activity: Get workflow state from sync status
async function getWorkflowStateFromSyncStatus(workflowId) {

  try {
    console.log(`🔍 Retrieving workflow state for workflow ID: ${workflowId}`);
    
    if (!workflowId) {
      throw new Error('Workflow ID is required');
    }
    
    // First, let's test if we can connect to the database at all
    // try {
    //   const [testRows] = await promisePool.execute('SELECT 1 as test');
    //   console.log('✅ Database connection test successful:', testRows[0]);
    // } catch (dbError) {
    //   console.error('❌ Database connection test failed:', dbError.message);
    //   throw new Error(`Database connection failed: ${dbError.message}`);
    // }
    
    // Query the sync status table to find the workflow state
    const query = `
      SELECT workflow_state, checkpoint, status, error_message 
      FROM Sync_Status 
      WHERE unique_key = ?
    `;
    
    const [result] = await promisePool.execute(query, [workflowId]);
    
    console.log(`🔍 Query returned ${result ? result.length : 0} rows`);
    
    if (result && result.length > 0) {
      const row = result[0];
      console.log(`✅ Found workflow state in sync status table:`, {
        checkpoint: row.checkpoint,
        status: row.status,
        hasWorkflowState: !!row.workflow_state,
        workflowStateLength: row.workflow_state ? row.workflow_state.length : 0
      });
      
      return {
        statusCode: 200,
        body: {
          workflow_state: row.workflow_state,
          checkpoint: row.checkpoint,
          status: row.status,
          error_message: row.error_message
        }
      };
    } else {
      console.warn(`❌ No workflow state found for workflow ID: ${workflowId}`);
      return {
        statusCode: 404,
        body: null
      };
    }
  } catch (error) {
    console.error(`❌ Failed to get workflow state:`, error);
    console.error(`❌ Error details:`, {
      message: error.message,
      stack: error.stack,
      code: error.code,
      errno: error.errno
    });
    
    // Provide a more descriptive error message
    const errorMessage = error.message || 'Unknown database error';
    throw ApplicationFailure.nonRetryable(`Failed to retrieve workflow state: ${errorMessage}`);
  }
}

// Activity: Load retailer products from cache table by dataKey
async function loadRetailerProductsFromCache(dataKey) {
  try {
    const [rows] = await promisePool.execute(
      `SELECT data_json FROM Retailer_Products_FetchCache WHERE data_key = ?`,
      [dataKey]
    );
    if (rows && rows.length > 0) {
      return JSON.parse(rows[0].data_json);
    } else {
      return [];
    }
  } catch (error) {
    console.error('Failed to load retailer products from cache:', error.message);
    return [];
  }
}

module.exports = {
  updateRetailerProductsSyncStatus,
  fetchRetailerProductsFromFirebase,
  processRetailerProductsData,
  insertRetailerProductsToMySQL,
  completeRetailerProductsSyncStatus,
  getWorkflowStateFromSyncStatus,
  saveWorkflowStateToMySQL,
  loadRetailerProductsFromCache
};