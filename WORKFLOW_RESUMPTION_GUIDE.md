# Workflow Failure Handling and Resumption Guide

## Overview

This guide explains how to handle workflow failures and resume from specific checkpoints in your Temporal-based data synchronization system.

## How Temporal Handles Failures

### 1. **Automatic Retries**
Your workflows are configured with automatic retry policies:

```javascript
retry: {
  initialInterval: '5 seconds',
  maximumInterval: '2 minutes',
  maximumAttempts: 3,
}
```

- If an activity fails, Temporal automatically retries it up to 3 times
- Retry intervals increase exponentially (5s → 10s → 20s → 2min)
- After 3 failed attempts, the workflow fails

### 2. **Checkpoint-Based Resumption**
When a workflow fails, it saves the current state and checkpoint, allowing you to resume from the exact point of failure.

## Workflow Checkpoints

Each workflow step has a specific checkpoint:

| Step | Checkpoint | Description |
|------|------------|-------------|
| 1 | `status_initialized` | Sync status initialized |
| 2 | `status_running` | Sync status set to running |
| 3 | `path_validated` | Firebase path validated |
| 4 | `delete_completed` | Existing data deleted |
| 5 | `fetch_completed` | Data fetched from Firebase |
| 6 | `data_validated` | Fetched data validated |
| 7 | `process_completed` | Data processing completed |
| 8 | `processed_validated` | Processed data validated |
| 9 | `insertion_prepared` | Database insertion prepared |
| 10 | `insert_completed` | Data inserted to database |
| 11 | `insertion_validated` | Insertion results validated |
| 12 | `sync_completed` | Final sync status updated |
| 13 | `workflow_completed` | Workflow completed |

## How to Resume a Failed Workflow

### Option 1: Using the API Endpoint

```bash
POST /table/resume
Content-Type: application/json

{
  "tableKey": "orders_new",
  "resumeInfo": {
    "originalWorkflowId": "orders-new-sync-1234567890",
    "checkpoint": "fetch_completed",
    "workflowState": {
      "step1Completed": true,
      "step2Completed": true,
      "step3Completed": true,
      "step4Completed": true,
      "step5Completed": true,
      "step6Completed": false,
      "step7Completed": false,
      "step8Completed": false,
      "step9Completed": false,
      "step10Completed": false,
      "orders": [
        { "id": 1, "name": "Order 1" },
        { "id": 2, "name": "Order 2" }
      ],
      "processedOrders": [],
      "deleteResult": { "affectedRows": 5 },
      "insertResult": null,
      "errors": [],
      "lastCheckpoint": "fetch_completed"
    }
  }
}
```

### Option 2: Using the Sync Functions

```javascript
const { ordersNewSync } = require('./src/sync_functions');

// Resume from a specific checkpoint
const resumeInfo = {
  originalWorkflowId: 'orders-new-sync-1234567890',
  checkpoint: 'fetch_completed',
  workflowState: {
    // ... workflow state object
  }
};

const workflowHandle = await ordersNewSync(resumeInfo);
console.log('Resumed workflow ID:', workflowHandle.workflowId);
```

### Option 3: Using the Generic Resume Function

```javascript
const { resumeWorkflow } = require('./src/sync_functions');

const resumeInfo = {
  originalWorkflowId: 'orders-new-sync-1234567890',
  checkpoint: 'insert_failed',
  workflowState: {
    // ... workflow state object
  }
};

const workflowHandle = await resumeWorkflow('ordersNewSync', resumeInfo);
```

## Extracting Resume Information from Failed Workflows

When a workflow fails, the error contains resume information:

```javascript
try {
  const result = await workflowHandle.result();
  console.log('Workflow completed:', result);
} catch (error) {
  // Parse the error to extract resume information
  let errorDetails;
  try {
    errorDetails = JSON.parse(error.message);
  } catch (parseError) {
    console.log('Could not parse error details');
    return;
  }
  
  if (errorDetails.details && errorDetails.details.resumeInfo) {
    console.log('Resume info:', errorDetails.details.resumeInfo);
    
    // Resume the workflow from the failure point
    const resumeHandle = await ordersNewSync(errorDetails.details.resumeInfo);
    console.log('Resumed workflow ID:', resumeHandle.workflowId);
  }
}
```

## Common Failure Scenarios and Solutions

### 1. **Database Connection Failure (Step 4: Delete)**
- **Checkpoint**: `delete_failed`
- **Solution**: Resume from `delete_failed` checkpoint
- **What happens**: Workflow will retry the delete operation

### 2. **Firebase Connection Failure (Step 5: Fetch)**
- **Checkpoint**: `fetch_failed`
- **Solution**: Resume from `fetch_failed` checkpoint
- **What happens**: Workflow will retry fetching data from Firebase

### 3. **Data Processing Error (Step 7: Process)**
- **Checkpoint**: `process_failed`
- **Solution**: Resume from `process_failed` checkpoint
- **What happens**: Workflow will retry processing the data

### 4. **Database Insertion Failure (Step 10: Insert)**
- **Checkpoint**: `insert_failed`
- **Solution**: Resume from `insert_failed` checkpoint
- **What happens**: Workflow will retry inserting data to database

## Workflow State Structure

The workflow state contains all necessary information for resumption:

```javascript
{
  // Step completion flags
  step1Completed: boolean,
  step2Completed: boolean,
  step3Completed: boolean,
  step4Completed: boolean,
  step5Completed: boolean,
  step6Completed: boolean,
  step7Completed: boolean,
  step8Completed: boolean,
  step9Completed: boolean,
  step10Completed: boolean,
  step11Completed: boolean,
  step12Completed: boolean,
  step13Completed: boolean,
  
  // Data from previous steps
  orders: Array,           // Fetched from Firebase
  processedOrders: Array,  // Processed data
  deleteResult: Object,    // Delete operation result
  insertResult: Object,    // Insert operation result
  
  // Error tracking
  errors: Array,
  lastCheckpoint: String,
  
  // Metadata
  error: String,           // Last error message
  failedAt: String         // ISO timestamp of failure
}
```

## Best Practices

### 1. **Monitor Workflow Status**
- Check workflow status regularly
- Set up alerts for failed workflows
- Monitor checkpoint progression

### 2. **Handle Resume Gracefully**
- Always validate resume information before using it
- Check if the workflow state is still valid
- Consider data freshness when resuming

### 3. **Error Recovery Strategy**
- Implement exponential backoff for retries
- Set appropriate timeout values
- Log detailed error information

### 4. **Data Consistency**
- Ensure data consistency across resume operations
- Validate data integrity after resumption
- Handle partial data scenarios

## Example: Complete Failure Recovery Flow

```javascript
async function handleWorkflowFailure(workflowHandle) {
  try {
    // Wait for workflow completion
    const result = await workflowHandle.result();
    console.log('Workflow completed successfully:', result);
    return result;
    
  } catch (error) {
    console.log('Workflow failed:', error.message);
    
    // Extract resume information
    let errorDetails;
    try {
      errorDetails = JSON.parse(error.message);
    } catch (parseError) {
      console.log('Could not parse error details');
      throw error;
    }
    
    // Check if resume is possible
    if (errorDetails.details && errorDetails.details.resumeInfo) {
      console.log('Attempting to resume workflow...');
      
      // Resume the workflow
      const resumeHandle = await ordersNewSync(errorDetails.details.resumeInfo);
      console.log('Resumed workflow started:', resumeHandle.workflowId);
      
      // Wait for resumed workflow to complete
      try {
        const resumeResult = await resumeHandle.result();
        console.log('Resumed workflow completed:', resumeResult);
        return resumeResult;
      } catch (resumeError) {
        console.log('Resumed workflow also failed:', resumeError.message);
        throw resumeError;
      }
    } else {
      console.log('No resume information available');
      throw error;
    }
  }
}
```

## Testing Workflow Resumption

Use the test client to verify resumption functionality:

```bash
# Run the test client
node src/Workflow/test-client.js

# This will test:
# 1. Normal workflow execution
# 2. Workflow resumption from different checkpoints
# 3. Error handling and recovery
# 4. State preservation across resume operations
```

## Monitoring and Debugging

### 1. **Temporal Web UI**
- Access at `http://localhost:8233`
- View workflow execution history
- Check activity details and failures
- Monitor retry attempts

### 2. **Logs**
- Check application logs for detailed error information
- Monitor checkpoint progression
- Track resume operations

### 3. **Database**
- Check sync status table for workflow status
- Monitor error details and workflow state
- Track successful vs failed operations

## Troubleshooting

### Common Issues

1. **"Resume information not found"**
   - Check if the workflow actually failed
   - Verify error parsing logic
   - Ensure workflow state is properly saved

2. **"Invalid checkpoint"**
   - Verify checkpoint name is correct
   - Check workflow state structure
   - Ensure all required fields are present

3. **"Workflow state corrupted"**
   - Validate workflow state JSON
   - Check for missing required fields
   - Verify data types and structure

### Debug Steps

1. **Enable detailed logging**
2. **Check Temporal Web UI for workflow details**
3. **Validate resume information structure**
4. **Test with simple workflow state**
5. **Monitor database for sync status updates**

This guide provides comprehensive information on handling workflow failures and resuming from specific checkpoints in your Temporal-based data synchronization system. 