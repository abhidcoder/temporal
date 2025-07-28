// src/activities.js
const { ref, get, child, database } = require('../database/firebase-config.js');
const snapshot = await get(child(ref(database), retailerPath));


const { promisePool } = require('../database/mysql-connection.js');
const { ApplicationFailure } = require('@temporalio/activity');
const request = require('request');
require('dotenv').config();

const BASE_URL = process.env.BASE_URL || 'https://dev-services.superzop.com';

// Activity: Update sync status
async function updateSyncStatus(syncStatusObj) {
  const sync_status_url = `${BASE_URL}/api/superzop/admin/sync_status/insertupdatesyncstatus`;
  
  const options = {
    url: sync_status_url,
    body: syncStatusObj,
    json: true,
    headers: {
      'Content-Type': 'application/json'
    }
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

// Activity: Fetch retailers from Firebase
async function fetchRetailersFromFirebase(retailerPath = 'Retailer_Master') {
  try {
    const retMastRef = database.ref(retailerPath);
    const snapshot = await retMastRef.once('value');
    
    console.log(`Fetching retailers from Firebase at path: ${retailerPath}`);
    console.log("Firebase retailers count:", snapshot.numChildren());
    
    const retailers = [];
    snapshot.forEach((childSnapshot) => {
      const retMastVal = childSnapshot.val();
      if (retMastVal && (retMastVal.verified === undefined || retMastVal.verified !== 'N')) {
        retailers.push({
          ...retMastVal,
          firebase_key: childSnapshot.key
        });
      }
    });

    console.log("Filtered retailers count:", retailers.length);
    return retailers;
  } catch (error) {
    throw ApplicationFailure.nonRetryable(error.message);
  }
}

// Activity: Process retailer data
async function processRetailerData(retailers) {
  try {
    const processedRetailers = retailers.map(retailer => {
      // Process dates
      let milliseconds = 0;
      let last_updated_millis = 0;
      
      if (retailer.registration_date) {
        const regDateFormatted = retailer.registration_date.replace('IST', 'GMT+05:30');
        const date = new Date(regDateFormatted);
        milliseconds = isNaN(date.getTime()) ? 0 : date.getTime();
      }

      if (retailer.last_updated) {
        const lastUpdDateFormatted = retailer.last_updated.replace('IST', 'GMT+05:30');
        const date = new Date(lastUpdDateFormatted);
        last_updated_millis = isNaN(date.getTime()) ? 0 : date.getTime();
      }

      // Process FSSAI document
      let fssai_doc_num = '';
      if (retailer.fssai_document && retailer.fssai_document.document_number) {
        fssai_doc_num = retailer.fssai_document.document_number;
      }

      return {
        ...retailer,
        registration_date_milliseconds: milliseconds,
        last_updated_milliseconds: last_updated_millis,
        fssai_document_number: fssai_doc_num,
        // Clean addresses and shop names
        address1: removeEmojis(retailer.address1),
        address2: removeEmojis(retailer.address2),
        shop_name: removeEmojis(retailer.shop_name),
        retailer_name: retailer.retailer_name
      };
    });

    return processedRetailers;
  } catch (error) {
    throw ApplicationFailure.nonRetryable(error.message);
  }
}

// Activity: Insert retailers to MySQL in chunks
async function insertRetailersToMySQL(retailers, chunkSize = 1000) {
  try {
    const chunks = [];
    for (let i = 0; i < retailers.length; i += chunkSize) {
      chunks.push(retailers.slice(i, i + chunkSize));
    }

    console.log(`Processing ${chunks.length} chunks`);

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      await insertRetailerChunk(chunk, chunkIndex === 0); // Delete on first chunk only
    }

    return { totalProcessed: retailers.length, chunksProcessed: chunks.length };
  } catch (error) {
    throw ApplicationFailure.nonRetryable(error.message);
  }
}

// Helper function to insert a single chunk
async function insertRetailerChunk(retailers, isFirstChunk = false) {
  try {
    let baseQuery = '';
    
    if (isFirstChunk) {
      await promisePool.execute('DELETE FROM Retailer_Masters');
      console.log('Cleared existing retailers from database');
    }

    if (retailers.length === 0) return;

    baseQuery = `INSERT INTO Retailer_Masters (
      registration_date, registration_date_milliseconds, new_user, aadhar_number, address1, address2, 
      app_version, area, beat_name, blacklist_flag, city, email, fssai_document_number, pan_number, phone, retailer_id, 
      retailer_name, secondary_number, state, store_owner, user_name, gst_number, verified, shop_name, agent_id, wallet, 
      fcm_device_token, last_updated, last_updated_milliseconds, latitude, longitude, delivery_duration, delivery_duration2, 
      delivery_cutoff, credit_mov, user_type, store_series, store_type, store_opening_time, store_closing_time, sub_area, 
      sub_area1, super_kredit, lunch_closer, lunch_start_time, lunch_end_time, weekly_off, tata_407_accessibility, last_order_number
    ) VALUES `;

    const valueStrings = [];
    const params = [];

    retailers.forEach(retailer => {
      valueStrings.push('(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      
      params.push(
        retailer.registration_date || null,
        retailer.registration_date_milliseconds || 0,
        retailer.new_user || null,
        retailer.aadhar_number || null,
        retailer.address1 || null,
        retailer.address2 || null,
        retailer.app_version || null,
        retailer.area || null,
        retailer.beat_name || null,
        retailer.blacklist_flag || null,
        retailer.city || null,
        retailer.email || null,
        retailer.fssai_document_number || null,
        retailer.pan_number || null,
        retailer.phone || null,
        retailer.retailer_id || null,
        retailer.retailer_name || null,
        retailer.secondary_number || null,
        retailer.state || null,
        retailer.store_owner || null,
        retailer.user_name || null,
        retailer.gst_number || null,
        retailer.verified || null,
        retailer.shop_name || null,
        retailer.agent_id || null,
        retailer.wallet || null,
        retailer.fcm_device_token || null,
        retailer.last_updated || null,
        retailer.last_updated_milliseconds || 0,
        retailer.latitude || null,
        retailer.longitude || null,
        retailer.delivery_duration || null,
        retailer.delivery_duration2 || null,
        retailer.delivery_cutoff || null,
        retailer.credit_mov || null,
        retailer.user_type || null,
        retailer.store_series || null,
        retailer.store_type || null,
        retailer.store_opening_time || null,
        retailer.store_closing_time || null,
        retailer.sub_area || null,
        retailer.sub_area1 || null,
        retailer.super_kredit || null,
        retailer.lunch_closer || null,
        retailer.lunch_start_time || null,
        retailer.lunch_end_time || null,
        retailer.weekly_off || null,
        retailer.tata_407_accessibility || null,
        retailer.last_order_number || null
      );
    });

    const finalQuery = baseQuery + valueStrings.join(',');
    const [results] = await promisePool.execute(finalQuery, params);
    
    console.log(`Inserted chunk of ${retailers.length} retailers`);
    return results;
  } catch (error) {
    console.error('Error inserting retailer chunk:', error);
    throw error;
  }
}

// Activity: Update assigned agents
async function updateAssignedAgents() {
  const url = `${BASE_URL}/api/superzop/admin/retailers/updateretailermasterswithassignedagentandasm`;
  
  const options = {
    url: url,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  return new Promise((resolve, reject) => {
    request.put(options, (err, res, body) => {
      if (err) {
        reject(ApplicationFailure.nonRetryable(err.message));
      } else {
        console.log(`Assigned agents updated: ${res.statusCode}`);
        resolve({ statusCode: res.statusCode, body });
      }
    });
  });
}

// Activity: Sync group retailers
async function syncGroupRetailers() {
  const grpUrl = `${BASE_URL}/api/superzop/admin/group_retailers/syncgroupretailerstablefromfirebase`;
  
  const options = {
    url: grpUrl,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  return new Promise((resolve, reject) => {
    request.post(options, (err, res, body) => {
      if (err) {
        reject(ApplicationFailure.nonRetryable(err.message));
      } else {
        console.log(`Group retailers synced: ${res.statusCode}`);
        resolve({ statusCode: res.statusCode, body });
      }
    });
  });
}

// Activity: Update sub area
async function updateSubArea1FromRetailerSubAreaTable() {
  try {
    // Example implementation - you'll need to customize this
    const [results] = await promisePool.execute(`
      UPDATE Retailer_Masters rm 
      JOIN Retailer_Sub_Area rsa ON rm.retailer_id = rsa.retailer_id 
      SET rm.sub_area1 = rsa.sub_area 
      WHERE rsa.sub_area IS NOT NULL
    `);
    
    console.log(`Updated sub_area1 for ${results.affectedRows} retailers`);
    return { success: true, affectedRows: results.affectedRows };
  } catch (error) {
    console.error('Error updating sub area:', error);
    throw ApplicationFailure.nonRetryable(error.message);
  }
}

// Helper function to remove emojis
function removeEmojis(text) {
  if (!text) return text;
  return text.replace(/[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}\u{1f1e6}-\u{1f1ff}\u{1f191}-\u{1f251}\u{1f004}\u{1f0cf}\u{1f170}-\u{1f171}\u{1f17e}-\u{1f17f}\u{1f18e}\u{3030}\u{2b50}\u{2b55}\u{2934}-\u{2935}\u{2b05}-\u{2b07}\u{2b1b}-\u{2b1c}\u{3297}\u{3299}\u{303d}\u{00a9}\u{00ae}\u{2122}\u{23f3}\u{24c2}\u{23e9}-\u{23ef}\u{25b6}\u{23f8}-\u{23fa}]/gu, '');
}

module.exports = {
  updateSyncStatus,
  fetchRetailersFromFirebase,
  processRetailerData,
  insertRetailersToMySQL,
  updateAssignedAgents,
  syncGroupRetailers,
  updateSubArea1FromRetailerSubAreaTable
};




