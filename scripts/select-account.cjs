const fs = require('fs');

const indexRaw = process.argv[2] || '';
const index = parseInt(indexRaw, 10);

let updatedEnv = false;
let errorMessage = null;
let hadAccount = false;

try {
  if (!Number.isInteger(index) || index <= 0) {
    throw new Error('Invalid account index');
  }

  if (!fs.existsSync('config/accounts.json')) {
    throw new Error('accounts.json not found');
  }

  const raw = fs.readFileSync('config/accounts.json', 'utf8');
  const parsed = JSON.parse(raw);

  let accounts = [];
  if (Array.isArray(parsed)) {
    accounts = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.accounts)) {
    accounts = parsed.accounts;
  }

  const acc = accounts[index - 1];
  if (!acc) {
    throw new Error('Account index out of range');
  }

  hadAccount = true;

  const env =
    'DISCORD_EMAIL=' + (acc.email || '') + '\n' +
    'DISCORD_PASSWORD=' + (acc.password || '') + '\n' +
    'BOT_USERNAME=' + (acc.username || '') + '\n' +
    'OF_LINK=' + (acc.ofLink || '') + '\n' +
    'API_PROXY_URL=https://discord-bot-api-proxy.mma12personal.workers.dev\n' +
    'CHECK_DMS_INTERVAL=5000\n' +
    'RESPONSE_DELAY_MIN=1000\n' +
    'RESPONSE_DELAY_MAX=3000\n';

  fs.writeFileSync('.env', env);
  console.log('[OK] Switched to:', acc.username || acc.email || 'Unknown');
  updatedEnv = true;
} catch (e) {
  errorMessage = e.message || String(e);
  console.log('[ERROR]', errorMessage);
}

