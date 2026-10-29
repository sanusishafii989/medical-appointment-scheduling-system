const cron = require('node-cron');
const prisma = require('../lib/prisma');
const { processExpiredWaitlistOffers } = require('./waitlist');

let running = false;

async function processWaitlistOffers() {
  if (running) return;
  running = true;
  try {
    await processExpiredWaitlistOffers(prisma);
  } catch (error) {
    console.error('Waitlist worker failed:', error.message);
  } finally {
    running = false;
  }
}

function startWaitlistScheduler() {
  processWaitlistOffers();
  return cron.schedule('* * * * *', processWaitlistOffers);
}

module.exports = { processWaitlistOffers, startWaitlistScheduler };
