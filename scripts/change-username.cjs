const fs = require('fs');

const newUsernameRaw = process.argv[2] || '';
const newUsername = newUsernameRaw.trim();

let updatedEnv = false;
let updatedAccount = false;
let errorMessage = null;

try {
  if (!newUsername) {
    throw new Error('New username is empty');
  }

  const env = fs.readFileSync('.env', 'utf8');

  const emailMatch = env.match(/^DISCORD_EMAIL=(.*)$/m);
  const usernameMatch = env.match(/^BOT_USERNAME=(.*)$/m);

  let currentEmail = null;
  let currentUsername = null;

  if (emailMatch) {
    currentEmail = (emailMatch[1] || '').trim();
  }

  if (usernameMatch) {
    currentUsername = (usernameMatch[1] || '').trim();
  }

  // Load accounts
  let accounts = [];
  let accountsContainer = null;

  if (fs.existsSync('config/accounts.json')) {
    const raw = fs.readFileSync('config/accounts.json', 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      accounts = parsed;
    } else if (parsed && typeof parsed === 'object') {
      accountsContainer = parsed;
      accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
    }
  }

  // Find account by current email, fallback to username
  let idx = -1;

  if (currentEmail) {
    idx = accounts.findIndex(
      (a) => (a.email || '').trim().toLowerCase() === currentEmail.toLowerCase()
    );
  }

  if (idx === -1 && currentUsername) {
    idx = accounts.findIndex(
      (a) => (a.username || '').trim().toLowerCase() === currentUsername.toLowerCase()
    );
  }

  if (idx !== -1) {
    accounts[idx].username = newUsername;
    updatedAccount = true;

    if (accountsContainer) {
      accountsContainer.accounts = accounts;
      fs.writeFileSync(
        'config/accounts.json',
        JSON.stringify(accountsContainer, null, 2)
      );
    } else {
      fs.writeFileSync('config/accounts.json', JSON.stringify(accounts, null, 2));
    }
  }

  // Update BOT_USERNAME in .env
  let newEnvContent = env;
  const newEnvLine = 'BOT_USERNAME=' + newUsername;

  if (/^BOT_USERNAME=.*$/m.test(env)) {
    newEnvContent = env.replace(/^BOT_USERNAME=.*$/m, newEnvLine);
  } else {
    const trimmed = env.replace(/\s+$/g, '');
    newEnvContent = trimmed + (trimmed.endsWith('\n') ? '' : '\n') + newEnvLine + '\n';
  }

  fs.writeFileSync('.env', newEnvContent);
  updatedEnv = true;
} catch (e) {
  errorMessage = e.message || String(e);
}

