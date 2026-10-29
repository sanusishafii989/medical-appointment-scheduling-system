require('dotenv').config();

const app = require('./app');
const { startReminderScheduler } = require('./services/reminder-worker');
const { startWaitlistScheduler } = require('./services/waitlist-worker');
const port = Number(process.env.PORT) || 4000;

startReminderScheduler();
startWaitlistScheduler();

app.listen(port, () => {
  console.log(`Medical appointment API listening on port ${port}`);
});
