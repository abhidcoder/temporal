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

// Activity: Delete existing salesman details
async function deleteExistingSalesmanDetails() {
  try {
    console.log("Starting to delete existing salesman details from Salesman_Details table...");
    
    const [results] = await promisePool.execute("DELETE FROM Salesman_Details");
    
    console.log("Deleted Salesman_Details Successfully");
    console.log(`Affected rows: ${results.affectedRows}`);
    
    return { success: true, affectedRows: results.affectedRows };
  } catch (error) {
    console.error('Failed to delete existing salesman details:', error);
    throw ApplicationFailure.nonRetryable(`Failed to delete existing salesman details: ${error.message}`);
  }
}

// Activity: Fetch salesman details from Firebase
async function fetchSalesmanDetailsFromFirebase(salesmanPath = 'Salesman_Details') {
  try {
    console.log(`Fetching salesman details from Firebase at path: ${salesmanPath}`);
    
    const snapshot = await get(ref(database, salesmanPath));
    
    console.log('Salesman details data fetched from Firebase');
    console.log('Firebase salesman count:', snapshot.size);
    
    const salesmanDetails = [];
    snapshot.forEach((childSnapshot) => {
      const salesmanVal = childSnapshot.val();
      if (salesmanVal && Number(salesmanVal.status) === 1) {
        salesmanDetails.push({ ...salesmanVal, firebase_key: childSnapshot.key });
      }
    });
    
    console.log("Salesman details count:", salesmanDetails.length);
    if (salesmanDetails.length > 0) {
      console.log("Sample salesman data:", salesmanDetails[0]);
    }
    
    return salesmanDetails;
  } catch (error) {
    console.error("Firebase read failed:", error);
    throw ApplicationFailure.nonRetryable(`Failed to fetch salesman details from Firebase: ${error.message}`);
  }
}

// Activity: Process salesman details data
async function processSalesmanDetailsData(salesmanDetails) {
  try {
    return salesmanDetails.map(salesman => {
      // Add any salesman-specific processing logic here
      // For example, data cleaning, validation, etc.
      return {
        ...salesman,
        // Add any processed fields here
      };
    });
  } catch (error) {
    throw ApplicationFailure.nonRetryable(error.message);
  }
}

// Activity: Insert salesman details to MySQL
async function insertSalesmanDetailsToMySQL(salesmanDetails, syncStatusUniqueKey) {
  try {
    if (salesmanDetails.length === 0) {
      console.log('No salesman details to insert');
      return { totalProcessed: 0, chunksProcessed: 0 };
    }

    console.log(`Preparing to insert ${salesmanDetails.length} salesman details`);

    const salesDetsInsUpdQuery = "INSERT INTO Salesman_Details (app_version,asm,asm_id,category,last_login,password,phone_number,salesman_id,salesman_name,salesman_type,store_series,status,zsm,zsm_id,deputy_asm,deputy_asm_id, trade_type) VALUES ";

    let insertUpdateQu = salesDetsInsUpdQuery;
    const salesmanDetailsParams = [];

    salesmanDetails.forEach(function (salesman) {
      const salesDetsInsValQu = "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?),";
      insertUpdateQu = insertUpdateQu + salesDetsInsValQu;
      
      salesmanDetailsParams.push(
        salesman.app_version, 
        salesman.asm, 
        salesman.asm_id, 
        salesman.category, 
        salesman.last_login, 
        salesman.password, 
        salesman.phone_number, 
        salesman.salesman_id, 
        salesman.salesman_name, 
        salesman.salesman_type, 
        salesman.store_series, 
        salesman.status,
        salesman.zsm ? salesman.zsm : null,
        salesman.zsm_id ? salesman.zsm_id : null,
        salesman.deputy_asm ? salesman.deputy_asm : null,
        salesman.deputy_asm_id ? salesman.deputy_asm_id : null, 
        salesman.trade_type ? salesman.trade_type : null
      );
    });

    insertUpdateQu = insertUpdateQu.replace(/.$/, "");

    const [results] = await promisePool.execute(insertUpdateQu, salesmanDetailsParams);
    
    console.log(`Successfully inserted ${salesmanDetails.length} salesman details`);
    console.log(`Affected rows: ${results.affectedRows}`);

    return { 
      totalProcessed: salesmanDetails.length, 
      chunksProcessed: 1,
      affectedRows: results.affectedRows 
    };

  } catch (error) {
    console.error('Error inserting salesman details:', error);
    throw ApplicationFailure.nonRetryable(`Failed to insert salesman details: ${error.message}`);
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

// Main activity function that matches the saveSalesmanDetailsToMysql structure
async function saveSalesmanDetailsToMysql(salesmanPath = 'Salesman_Details') {
  const dateNow = new Date();
  const [monthNow, dayNow, yearNow] = [dateNow.getMonth() + 1, dateNow.getDate(), dateNow.getFullYear()];
  const [hourNow, minutesNow, secondsNow] = [dateNow.getHours(), dateNow.getMinutes(), dateNow.getSeconds()];
  const completeDateNow = `${yearNow}-${monthNow}-${dayNow}_${hourNow}:${minutesNow}:${secondsNow}`;
  const syncStatusUniqueKey = `Salesman_Details_${completeDateNow}`;

  try {
    console.log('🚀 Starting Salesman Details Sync Process...');
    console.log(`📅 Sync Status Key: ${syncStatusUniqueKey}`);
    console.log(`📂 Firebase Path: ${salesmanPath}`);

    // Step 1: Update sync status to Running
    console.log('📊 Step 1: Updating sync status to Running...');
    const syncStatusObj = {
      table_name: "Salesman_Details",
      status: "Running",
      unique_key: syncStatusUniqueKey
    };

    console.log('syncStatusObj: ', syncStatusObj);
    await updateSyncStatus(syncStatusObj);
    console.log('✅ Step 1 completed: Sync status updated');

    // Step 2: Delete existing salesman details
    console.log('🗑️ Step 2: Deleting existing salesman details from database...');
    const deleteResult = await deleteExistingSalesmanDetails();
    console.log(`✅ Step 2 completed: Successfully deleted ${deleteResult.affectedRows} existing salesman details`);

    // Step 3: Fetch salesman details from Firebase
    console.log('🔥 Step 3: Fetching salesman details from Firebase...');
    const salesmanDetails = await fetchSalesmanDetailsFromFirebase(salesmanPath);
    console.log(`✅ Step 3 completed: Fetched ${salesmanDetails.length} salesman details from Firebase`);

    // Step 4: Process salesman details data
    console.log('⚙️ Step 4: Processing salesman details data...');
    const processedSalesmanDetails = await processSalesmanDetailsData(salesmanDetails);
    console.log(`✅ Step 4 completed: Processed ${processedSalesmanDetails.length} salesman details`);

    // Step 5: Insert salesman details to MySQL
    console.log('💾 Step 5: Inserting salesman details to MySQL...');
    const insertResult = await insertSalesmanDetailsToMySQL(processedSalesmanDetails, syncStatusUniqueKey);
    console.log(`✅ Step 5 completed: Successfully processed ${insertResult.totalProcessed} salesman details in ${insertResult.chunksProcessed} chunks`);

    // Step 6: Update final sync status to Completed
    console.log('🏁 Step 6: Updating final sync status to Completed...');
    await updateFinalSyncStatus(syncStatusUniqueKey, "Completed");
    console.log('✅ Step 6 completed: Final sync status updated');

    console.log('🎉 Salesman details sync completed successfully!');
    return {
      success: true,
      totalSalesmanDetails: processedSalesmanDetails.length,
      deletedSalesmanDetails: deleteResult.affectedRows,
      syncStatusKey: syncStatusUniqueKey,
      statusMessage: "Added Salesman Details to MySql"
    };

  } catch (error) {
    console.error('❌ Salesman details sync failed:', error);
    
    // Update sync status to Failed
    try {
      console.log('🔄 Updating sync status to Failed...');
      await updateFinalSyncStatus(syncStatusUniqueKey, "Failed");
      console.log('✅ Sync status updated to Failed');
    } catch (statusError) {
      console.error('❌ Failed to update sync status on error', { statusError });
    }

    throw ApplicationFailure.nonRetryable(`Salesman details sync failed: ${error.message}`);
  }
}

module.exports = {
  updateSyncStatus,
  deleteExistingSalesmanDetails,
  fetchSalesmanDetailsFromFirebase,
  processSalesmanDetailsData,
  insertSalesmanDetailsToMySQL,
  updateFinalSyncStatus,
  saveSalesmanDetailsToMysql
};