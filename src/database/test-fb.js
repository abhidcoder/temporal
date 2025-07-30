// firebase-test.js
const { database, ref, get } = require('./firebase-config');

// Change this to a path that exists in your Firebase DB
const testPath = '/Retailer_Products'; // root, or e.g. '/some/test/path'

async function testFirebase() {
  try {
    console.log('About to GET from Firebase...');
    const snapshot = await get(ref(database, testPath));
    if (snapshot.exists()) {
      console.log('Firebase GET success:', snapshot.val());
    } else {
      console.log('Firebase GET: No data at path', testPath);
    }
  } catch (err) {
    console.error('Firebase error:', err);
  }
}

testFirebase();