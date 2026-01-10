import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configDir = path.join(process.cwd(), 'config');
const accountsFile = path.join(configDir, 'accounts.json');
const settingsFile = path.join(configDir, 'settings.json');

if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

function loadAccounts() {
  if (!fs.existsSync(accountsFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
  } catch {
    return [];
  }
}

function loadSettings() {
  if (!fs.existsSync(settingsFile)) {
    return { ofLink: '', activeAccount: '' };
  }
  try {
    return JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch {
    return { ofLink: '', activeAccount: '' };
  }
}

function saveAccounts(accounts) {
  fs.writeFileSync(accountsFile, JSON.stringify(accounts, null, 2), 'utf8');
}

function saveSettings(settings) {
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
}

async function main() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    console.clear();
    console.log('========================================');
    console.log('  Discord OnlyFans Bot Setup');
    console.log('========================================\n');

    let accounts = loadAccounts();
    let settings = loadSettings();

    // First time setup
    if (accounts.length === 0) {
      console.log('First time setup - configure your bot:\n');

      // Add account
      const email = await rl.question('Discord Email: ');
      const password = await rl.question('Discord Password: ');

      if (!email || !password) {
        console.log('\nEmail and password required\n');
        rl.close();
        return;
      }

      accounts.push({ email, password });
      settings.activeAccount = email;
      console.log('Account added\n');

      // Set OF link
      const link = await rl.question('OnlyFans Link (or press Enter to skip): ');
      if (link.trim()) {
        settings.ofLink = link.trim();
      } else {
        settings.ofLink = 'https://onlyfans.com';
      }
      console.log('OF Link saved\n');

      saveAccounts(accounts);
      saveSettings(settings);
      console.log('Setup complete!\n');
      rl.close();
      return;
    }

    // Main menu
    let running = true;
    while (running) {
      console.clear();
      console.log('========================================');
      console.log('  Main Menu');
      console.log('========================================\n');
      console.log('Accounts: ' + (accounts.length > 0 ? accounts.length + ' saved' : 'None'));
      console.log('OF Link: ' + (settings.ofLink ? 'Set' : 'Not set'));
      console.log('Active: ' + (settings.activeAccount || 'None'));
      console.log('\n[1] Start Bot');
      console.log('[2] Add Account');
      console.log('[3] Change OF Link');
      console.log('[4] Exit');

      const choice = await rl.question('\nSelect [1-4]: ');

      switch (choice.trim()) {
        case '1':
          if (!settings.activeAccount) {
            console.log('\nNo active account configured\n');
            await rl.question('Press Enter to continue...');
            break;
          }

          const account = accounts.find(acc => acc.email === settings.activeAccount);
          if (!account) {
            console.log('\nActive account not found\n');
            await rl.question('Press Enter to continue...');
            break;
          }

          console.log('\nStarting bot...');
          console.log('Account: ' + account.email);
          console.log('OF Link: ' + settings.ofLink + '\n');

          const envContent = `DISCORD_EMAIL=${account.email}
DISCORD_PASSWORD=${account.password}
OF_LINK=${settings.ofLink}
GEMINI_API_KEY_1=${process.env.GEMINI_API_KEY_1 || ''}
GEMINI_API_KEY_2=${process.env.GEMINI_API_KEY_2 || ''}
GEMINI_API_KEY_3=${process.env.GEMINI_API_KEY_3 || ''}
OPENAI_API_KEY=${process.env.OPENAI_API_KEY || ''}
CHECK_DMS_INTERVAL=5000
RESPONSE_DELAY_MIN=1000
RESPONSE_DELAY_MAX=3000`;

          fs.writeFileSync(path.join(process.cwd(), '.env'), envContent);
          rl.close();
          
          setTimeout(() => {
            import('./bot.js').catch(error => {
              console.error('Failed to start bot:', error.message);
              process.exit(1);
            });
          }, 100);
          return;

        case '2':
          const newEmail = await rl.question('Discord Email: ');
          const newPassword = await rl.question('Discord Password: ');

          if (!newEmail || !newPassword) {
            console.log('Email and password required\n');
            break;
          }

          if (accounts.find(acc => acc.email === newEmail)) {
            console.log('Account already exists\n');
            break;
          }

          accounts.push({ email: newEmail, password: newPassword });
          saveAccounts(accounts);
          console.log('Account added\n');
          break;

        case '3':
          const newLink = await rl.question('OnlyFans Link: ');
          if (newLink.trim()) {
            settings.ofLink = newLink.trim();
            saveSettings(settings);
            console.log('OF Link updated\n');
          }
          break;

        case '4':
          running = false;
          break;
      }

      if (running) {
        await rl.question('Press Enter to continue...');
      }
    }

    rl.close();
  } catch (error) {
    console.error('Error:', error.message);
    rl.close();
    process.exit(1);
  }
}

main();
