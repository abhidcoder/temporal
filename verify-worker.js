#!/usr/bin/env node

// Quick verification script for worker setup
require('dotenv').config();

console.log('🔍 Verifying Worker Setup...\n');

// Check environment
console.log('📋 Environment Check:');
console.log('✅ NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('✅ TEMPORAL_ADDRESS:', process.env.TEMPORAL_ADDRESS || 'localhost:7233');
console.log('✅ TEMPORAL_TASK_QUEUE:', process.env.TEMPORAL_TASK_QUEUE || 'superzop-sync-queue');

// Check required variables
const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missing = required.filter(v => !process.env[v]);

if (missing.length > 0) {
  console.log('❌ Missing variables:', missing);
} else {
  console.log('✅ All required variables present');
}

// Check file structure
const fs = require('fs');
const path = require('path');

console.log('\n📁 File Structure Check:');
const files = [
  'src/Workflow/worker.js',
  'src/Workflow/workflows.js',
  'src/Workflow/Activities/index.js'
];

files.forEach(file => {
  const exists = fs.existsSync(file);
  console.log(`${exists ? '✅' : '❌'} ${file}`);
});

// Test module loading
console.log('\n🔧 Module Loading Test:');
try {
  const activities = require('./src/Workflow/Activities');
  console.log('✅ Activities loaded:', Object.keys(activities).length, 'activities');
} catch (e) {
  console.log('❌ Activities failed:', e.message);
}

try {
  const workflows = require('./src/Workflow/workflows');
  console.log('✅ Workflows loaded:', Object.keys(workflows).length, 'workflows');
} catch (e) {
  console.log('❌ Workflows failed:', e.message);
}

console.log('\n🎉 Verification complete!');
console.log('📋 To run worker: npm run worker');
console.log('📋 To run in Docker: docker-compose up app-worker'); 