const fs = require('fs');

const newEmailRaw = process.argv[2] || '';
const newEmail = newEmailRaw.trim();

let updatedEnv = false;
let updatedAccount = false;
let envHadLine = false;
let envEmailEmpty = false;
let botUsernamePresent = false;
let errorMessage = null;

try {
  const env = fs.readFileSync('.env', 'utf8');

  const emailMatch = env.match(/^DISCORD_EMAIL=(.*)$/m);
  const botMatch = env.match(/^BOT_USERNAME=(.*)$/m);

  let currentEmail = null;
  let botUsername = null;

  if (emailMatch) {
    envHadLine = true;
    currentEmail = (emailMatch[1] || '').trim();
    envEmailEmpty = currentEmail === '';
  }

  if (botMatch) {
    botUsername = (botMatch[1] || '').trim();
    botUsernamePresent = !!botUsername;
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

  // Find account index by current email or BOT_USERNAME fallback
  let idx = -1;

  if (currentEmail) {
    idx = accounts.findIndex(
      (a) => (a.email || '').trim().toLowerCase() === currentEmail.toLowerCase()
    );
  }

  if (idx === -1 && botUsername) {
    idx = accounts.findIndex(
      (a) => (a.username || '').trim().toLowerCase() === botUsername.toLowerCase()
    );
  }

  if (idx !== -1 && newEmail) {
    accounts[idx].email = newEmail;
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

  // Update .env DISCORD_EMAIL line (create if missing) ONLY when newEmail is non-empty
  if (newEmail) {
    let newEnvContent = env;
    const newEnvLine = 'DISCORD_EMAIL=' + newEmail;

    if (envHadLine) {
      newEnvContent = env.replace(/^DISCORD_EMAIL=.*$/m, newEnvLine);
    } else {
      const trimmed = env.replace(/\s+$/g, '');
      newEnvContent = trimmed + (trimmed.endsWith('\n') ? '' : '\n') + newEnvLine + '\n';
    }

    fs.writeFileSync('.env', newEnvContent);
    updatedEnv = true;
  } else {
    updatedEnv = false;
  }
} catch (e) {
  errorMessage = e.message || String(e);
}

