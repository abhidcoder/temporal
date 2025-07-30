require('dotenv').config({ path: '../../.env' });
const mysql = require('mysql2');
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    // port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});
const promisePool = pool.promise();

async function test() {
  try {
    console.log('About to INSERT...');
    await promisePool.execute(
      `INSERT INTO Sync_Status (table_name, status, unique_key) VALUES (?, ?, ?)`,
      ['Retailer_Products', 'Test', 'test_key']
    );
    console.log('INSERT done.');

    console.log('About to SELECT...');
    const [rows] = await promisePool.execute(
      `SELECT * FROM Sync_Status WHERE unique_key = ?`,
      ['test_key']
    );
    console.log('SELECT done.', rows);
  } catch (err) {
    console.error('DB error:', err);
  } finally {
    pool.end();
  }
}

test();