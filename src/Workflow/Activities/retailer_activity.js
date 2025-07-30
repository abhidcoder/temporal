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

// Activity: Fetch retailers from Firebase
async function fetchRetailersFromFirebase(retailerPath = 'Retailer_Master') {
  try {
    const snapshot = await get(ref(database, retailerPath));

    console.log(`Fetching retailers from Firebase at path: ${retailerPath}`);
    console.log("Firebase retailers count:", snapshot.size);

    const retailers = [];
    snapshot.forEach((childSnapshot) => {
      const retMastVal = childSnapshot.val();
      if (retMastVal && (retMastVal.verified === undefined || retMastVal.verified !== 'N')) {
        retailers.push({ ...retMastVal, firebase_key: childSnapshot.key });
      }
    });

    console.log("Filtered retailers count:", retailers.length);
    console.log("Sample retailer data:", retailers[0]);
    return retailers;
  } catch (error) {
    throw ApplicationFailure.nonRetryable(`Failed to fetch retailers from Firebase: ${error.message}`);
  }
}

// // Activity: Process retailer data
async function processRetailerData(retailers) {
  try {
    return retailers.map(retailer => {


      const milliseconds = retailer.registration_date
  ? new Date(retailer.registration_date).getTime() || 0
  : 0;

      let last_updated_millis = 0;

      if (retailer.registration_date) {
        const date = new Date(retailer.registration_date.replace('IST', 'GMT+05:30'));
        milliseconds = isNaN(date.getTime()) ? 0 : date.getTime();
      }

      if (retailer.last_updated) {
        const date = new Date(retailer.last_updated.replace('IST', 'GMT+05:30'));
        last_updated_millis = isNaN(date.getTime()) ? 0 : date.getTime();
      }

      return {
        ...retailer,
        registration_date_milliseconds: milliseconds,
        last_updated_milliseconds: last_updated_millis,
        fssai_document_number: retailer.fssai_document?.document_number || '',
        address1: removeEmojis(retailer.address1),
        address2: removeEmojis(retailer.address2),
        shop_name: removeEmojis(retailer.shop_name),
        retailer_name: retailer.retailer_name
      };
    });
  } catch (error) {
    throw ApplicationFailure.nonRetryable(error.message);
  }
}

// // Activity: Insert retailers to MySQL in chunks
async function insertRetailersToMySQL(retailers, chunkSize = 1000) {
  try {
    const chunks = Array.from({ length: Math.ceil(retailers.length / chunkSize) }, (_, i) =>
      retailers.slice(i * chunkSize, (i + 1) * chunkSize)
    );

    for (let i = 0; i < chunks.length; i++) {
      await insertRetailerChunk(chunks[i], i === 0);
    }

    return { totalProcessed: retailers.length, chunksProcessed: chunks.length };
  } catch (error) {
    throw ApplicationFailure.nonRetryable(error.message);
  }
}

// // Helper function to insert a single chunk
async function insertRetailerChunk(retailers, isFirstChunk = false) {
  try {
    if (isFirstChunk) {
      await promisePool.execute('DELETE FROM Retailer_Masters');
      console.log('Cleared existing retailers from database');
    }
    if (retailers.length === 0) return;

    const columns = `
      registration_date, registration_date_milliseconds, new_user, aadhar_number, address1, address2,
      app_version, area, beat_name, blacklist_flag, city, email, fssai_document_number, pan_number, phone,
      old_phone, retailer_id, retailer_name, secondary_number, state, store_owner, user_name, gst_number,
      verified, shop_name, agent_id, wallet, fcm_device_token, last_updated, last_updated_milliseconds,
      latitude, longitude, delivery_duration, delivery_duration2, delivery_cutoff, credit_mov, user_type,
      store_series, store_type, store_type_2, store_opening_time, store_closing_time, sub_area, sub_area1,
      super_kredit, lunch_closer, lunch_start_time, lunch_end_time, weekly_off, tata_407_accessibility,
      last_order_number, pincode, reason_blacklisted, blacklisted_date, id
    `.trim().replace(/\s+/g, '').split(',').join(', '); // column list

    const baseQuery = `INSERT INTO Retailer_Masters (${columns}) VALUES `;

    const valueStrings = [];
    const params = [];

    function safe(val) {
      return val === undefined ? null : val;
    }


    for (const r of retailers) {
      valueStrings.push(`(${new Array(55).fill('?').join(', ')})`);
      
      params.push(
          safe(r.registration_date),
          safe(r.registration_date_milliseconds),
          safe(r.new_user),
          safe(r.aadhar_number),
          safe(r.address1),
          safe(r.address2),
          safe(r.app_version),
          safe(r.area),
          safe(r.beat_name),
          safe(r.blacklist_flag),
          safe(r.city),
          safe(r.email),
          safe(r.fssai_document_number),
          safe(r.pan_number),
          safe(r.phone),
          safe(r.old_phone),
          safe(r.retailer_id),
          safe(r.retailer_name),
          safe(r.secondary_number),
          safe(r.state),
          safe(r.store_owner),
          safe(r.user_name),
          safe(r.gst_number),
          safe(r.verified),
          safe(r.shop_name),
          safe(r.agent_id),
          safe(r.wallet),
          safe(r.fcm_device_token),
          safe(r.last_updated),
          safe(r.last_updated_milliseconds),
          safe(r.latitude),
          safe(r.longitude),
          safe(r.delivery_duration),
          safe(r.delivery_duration2),
          safe(r.delivery_cutoff),
          safe(r.credit_mov),
          safe(r.user_type),
          safe(r.store_series),
          safe(r.store_type),
          safe(r.store_type_2),
          safe(r.store_opening_time),
          safe(r.store_closing_time),
          safe(r.sub_area),
          safe(r.sub_area1),
          safe(r.super_kredit),
          safe(r.lunch_closer),
          safe(r.lunch_start_time),
          safe(r.lunch_end_time),
          safe(r.weekly_off),
          safe(r.tata_407_accessibility),
          safe(r.last_order_number),
          safe(r.pincode),
          safe(r.reason_blacklisted),
          safe(r.blacklisted_date),
          safe(r.id)
        );

    }

    const duplicateKeyUpdate = `
      ON DUPLICATE KEY UPDATE
        registration_date=VALUES(registration_date),
        registration_date_milliseconds=VALUES(registration_date_milliseconds),
        new_user=VALUES(new_user),
        aadhar_number=VALUES(aadhar_number),
        address1=VALUES(address1),
        address2=VALUES(address2),
        app_version=VALUES(app_version),
        area=VALUES(area),
        beat_name=VALUES(beat_name),
        blacklist_flag=VALUES(blacklist_flag),
        city=VALUES(city),
        email=VALUES(email),
        fssai_document_number=VALUES(fssai_document_number),
        pan_number=VALUES(pan_number),
        phone=VALUES(phone),
        old_phone=VALUES(old_phone),
        retailer_id=VALUES(retailer_id),
        retailer_name=VALUES(retailer_name),
        secondary_number=VALUES(secondary_number),
        state=VALUES(state),
        store_owner=VALUES(store_owner),
        user_name=VALUES(user_name),
        gst_number=VALUES(gst_number),
        verified=VALUES(verified),
        shop_name=VALUES(shop_name),
        agent_id=VALUES(agent_id),
        wallet=VALUES(wallet),
        fcm_device_token=VALUES(fcm_device_token),
        last_updated=VALUES(last_updated),
        last_updated_milliseconds=VALUES(last_updated_milliseconds),
        latitude=VALUES(latitude),
        longitude=VALUES(longitude),
        delivery_duration=VALUES(delivery_duration),
        delivery_duration2=VALUES(delivery_duration2),
        delivery_cutoff=VALUES(delivery_cutoff),
        credit_mov=VALUES(credit_mov),
        user_type=VALUES(user_type),
        store_series=VALUES(store_series),
        store_type=VALUES(store_type),
        store_type_2=VALUES(store_type_2),
        store_opening_time=VALUES(store_opening_time),
        store_closing_time=VALUES(store_closing_time),
        sub_area=VALUES(sub_area),
        sub_area1=VALUES(sub_area1),
        super_kredit=VALUES(super_kredit),
        lunch_closer=VALUES(lunch_closer),
        lunch_start_time=VALUES(lunch_start_time),
        lunch_end_time=VALUES(lunch_end_time),
        weekly_off=VALUES(weekly_off),
        tata_407_accessibility=VALUES(tata_407_accessibility),
        last_order_number=VALUES(last_order_number),
        pincode=VALUES(pincode),
        reason_blacklisted=VALUES(reason_blacklisted),
        blacklisted_date=VALUES(blacklisted_date)
    `;

    const finalQuery = baseQuery + valueStrings.join(', ') + ' ' + duplicateKeyUpdate;

    const [results] = await promisePool.execute(finalQuery, params);
    console.log(`Inserted chunk of ${retailers.length} retailers`);
    return results;

  } catch (error) {
    console.error('Error inserting retailer chunk:', error);
    throw error;
  }
}


// // Activity: Update assigned agents
async function updateAssignedAgents() {
  const url = `${BASE_URL}/api/superzop/admin/retailers/updateretailermasterswithassignedagentandasm`;
  const options = { url, headers: { 'Content-Type': 'application/json' } };

  return new Promise((resolve, reject) => {
    request.put(options, (err, res, body) => {
      if (err) reject(ApplicationFailure.nonRetryable(err.message));
      else resolve({ statusCode: res.statusCode, body });
    });
  });
}

// // Activity: Sync group retailers
async function syncGroupRetailers() {
  const url = `${BASE_URL}/api/superzop/admin/group_retailers/syncgroupretailerstablefromfirebase`;
  const options = { url, headers: { 'Content-Type': 'application/json' } };

  return new Promise((resolve, reject) => {
    request.post(options, (err, res, body) => {
      if (err) reject(ApplicationFailure.nonRetryable(err.message));
      else resolve({ statusCode: res.statusCode, body });
    });
  });
}

// // Activity: Update sub area
// async function updateSubArea1FromRetailerSubAreaTable() {
//   try {
//     const [results] = await promisePool.execute(`
//       UPDATE superzop_delivery.Retailer_Masters rm 
//       JOIN superzop_ordering.Retailer_Sub_Area rsa 
//       ON rm.retailer_id = rsa.retailer_id 
//       SET rm.sub_area1 = rsa.sub_area 
//       WHERE rsa.sub_area IS NOT NULL
//     `);

//     console.log(`✅ Sub-area updated for ${results.affectedRows} retailers`);

//     return { success: true, affectedRows: results.affectedRows };
//   } catch (error) {
//     console.error(`❌ Failed to update sub_area1: ${error.message}`);
//     throw ApplicationFailure.nonRetryable(error.message);
//   }
// }

function removeEmojis(text) {
  if (!text) return text;
  return text.replace(/\p{Emoji}/gu, '');
}

module.exports = {
  updateSyncStatus,
  fetchRetailersFromFirebase,
  processRetailerData,
  insertRetailersToMySQL,
  updateAssignedAgents,
  syncGroupRetailers,
  // updateSubArea1FromRetailerSubAreaTable
};
