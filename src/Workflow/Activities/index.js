// src/Activities/index.js
const retailerActivities = require('./retailer_activity');
const ordersActivities = require('./orders_activity');
const retailerProductsActivities = require('./retailer_products_activity');

module.exports = {
  ...retailerActivities,
  ...ordersActivities,
  ...retailerProductsActivities
};