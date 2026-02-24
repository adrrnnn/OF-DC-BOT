const fs = require('fs');

let accounts = [];
let errorMessage = null;
let hasAccounts = false;

try {
  if (fs.existsSync('config/accounts.json')) {
    const raw = fs.readFileSync('config/accounts.json', 'utf8');
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      accounts = parsed;
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.accounts)) {
      accounts = parsed.accounts;
    }

    hasAccounts = accounts.length > 0;

    if (hasAccounts) {
      console.log('');
      console.log('Saved accounts:');
      accounts.forEach((acc, i) => {
        const username = acc.username || 'Unknown';
        const email = acc.email || 'No email';
        console.log('[' + (i + 1) + '] ' + username + ' (' + email + ')');
      });
    } else {
      console.log('No accounts saved');
    }
  } else {
    console.log('No accounts database found');
  }
} catch (e) {
  errorMessage = e.message || String(e);
  console.log('Error:', errorMessage);
}

