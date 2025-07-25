// src/workflows.js
const { proxyActivities, sleep } = require('@temporalio/workflow');

// Configure activities with timeouts and retry policies
const {
  processPayment,
  processOrder,
  updateInventory,
  sendNotification
} = proxyActivities({
  taskQueue: 'express-task-queue', // Make sure this matches your worker
  scheduleToCloseTimeout: '5m',
  startToCloseTimeout: '2m',
  retryPolicy: {
    maximumAttempts: 3,
  },
});

async function orderFulfillmentWorkflow(orderData) {
  console.log(`Starting order fulfillment for order ${orderData.id}`);
  
  try {
    // Step 1: Process payment
    console.log('Processing payment...');
    const paymentResult = await processPayment({
      id: orderData.paymentId,
      amount: orderData.total
    });
    
    // Step 2: Process the order
    console.log('Processing order...');
    const orderResult = await processOrder(orderData);
    
    // Step 3: Update inventory
    console.log('Updating inventory...');
    const inventoryResult = await updateInventory(orderData.items);
    if (inventoryResult.status !== 'updated') {
      throw new Error('Inventory update failed');
    }
    
    // Step 4: Wait a bit before sending confirmation
    await sleep('2 seconds');
    
    // Step 5: Send confirmation notification
    console.log('Sending confirmation...');
    const notificationResult = await sendNotification(
      orderData.customerEmail,
      `Your order ${orderData.id} has been processed successfully!`
    );
    
    return {
      orderId: orderData.id,
      status: 'completed',
      payment: paymentResult,
      order: orderResult,
      inventory: inventoryResult,
      notification: notificationResult,
      completedAt: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Order fulfillment failed:', error.message);
    
    // Send failure notification
    await sendNotification(
      orderData.customerEmail,
      `Sorry, your order ${orderData.id} failed to process. Please contact support.`
    );
    
    throw error;
  }
}

async function dataProcessingWorkflow(jobData) {
  console.log(`Starting data processing job: ${jobData.jobName}`);
  
  const results = [];
  
  // Process data in batches
  for (let i = 0; i < jobData.batches; i++) {
    console.log(`Processing batch ${i + 1}/${jobData.batches}`);
    
    // Simulate batch processing
    await sleep('3 seconds');
    
    const batchResult = {
      batch: i + 1,
      processed: true,
      timestamp: new Date().toISOString()
    };
    
    results.push(batchResult);
    
    // Send progress notification every 2 batches
    if ((i + 1) % 2 === 0) {
      await sendNotification(
        jobData.notificationEmail,
        `Data processing job ${jobData.jobName}: ${i + 1}/${jobData.batches} batches completed`
      );
    }
  }
  
  // Final notification
  await sendNotification(
    jobData.notificationEmail,
    `Data processing job ${jobData.jobName} completed successfully!`
  );
  
  return {
    jobName: jobData.jobName,
    status: 'completed',
    totalBatches: jobData.batches,
    results,
    completedAt: new Date().toISOString()
  };
}

module.exports = { 
  orderFulfillmentWorkflow, 
  dataProcessingWorkflow 
};
