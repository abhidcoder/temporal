const { Worker } = require('@temporalio/worker');
const activities = require('./activities');

async function run() {
  const worker = await Worker.create({
    workflowsPath: require.resolve('./workflows'),
    activities,
    taskQueue: 'express-task-queue',
  });

  console.log('🚀 Temporal Worker started, ctrl+c to exit');
  await worker.run();
}

run().catch((err) => {
  console.error('Worker error:', err);
  process.exit(1);
});