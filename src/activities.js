const { log } = require('@temporalio/activity');

async function processOrder(orderData) {
  log.info('Processing order', { orderId: orderData.id });
  
  // Simulate order processing
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  return {
    orderId: orderData.id,
    status: 'processed',
    total: orderData.total,
    processedAt: new Date().toISOString()
  };
}

async function sendNotification(recipient, message) {
  log.info('Sending notification', { recipient, message });
  
  // Simulate notification sending (email, SMS, etc.)
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return {
    recipient,
    message,
    sentAt: new Date().toISOString(),
    status: 'sent'
  };
}

async function updateInventory(items) {
  log.info('Updating inventory', { items });
  
  // Simulate inventory update
  await new Promise(resolve => setTimeout(resolve, 1500));

  // return {
  //   items,
  //   updatedAt: new Date().toISOString(),
  //   status: 'Error'
  // };
  
  return {
    items,
    updatedAt: new Date().toISOString(),
    status: 'updated'
  };
}

async function processPayment(paymentData) {
  log.info('Processing payment', { amount: paymentData.amount });
  
  // Simulate payment processing
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Simulate random payment failure (10% chance)
  if (Math.random() < 0.1) {
    throw new Error('Payment failed: Insufficient funds');
  }
  
  return {
    paymentId: paymentData.id,
    amount: paymentData.amount,
    status: 'completed',
    transactionId: 'txn_' + Math.random().toString(36).substr(2, 9)
  };
}

module.exports = { 
  processOrder, 
  sendNotification, 
  updateInventory, 
  processPayment 
};