// src/Activities/index.js
const retailerActivities = require('./retailer_activity');
const ordersActivities = require('./orders_activity');

module.exports = {
  ...retailerActivities,
  ...ordersActivities
};