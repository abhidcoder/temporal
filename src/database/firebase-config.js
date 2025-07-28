// firebase-config.js (CJS version for Node.js)
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get } = require('firebase/database');

const firebaseConfig = {
  apiKey: "AIzaSyCXJDhOge4OYHqv5oPX6D5gvLMnXRpXkno",
  authDomain: "superzop-ordering-development.firebaseapp.com",
  databaseURL: "https://superzop-ordering-development.firebaseio.com",
  projectId: "superzop-ordering-development",
  storageBucket: "superzop-ordering-development.appspot.com",
  messagingSenderId: "863297578860",
  appId: "1:863297578860:web:008951edd8bb6be1e57549",
  measurementId: "G-HBW0BMHZRY"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

module.exports = { database, ref, get };
