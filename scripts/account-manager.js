const fs = require('fs');
const path = require('path');
require('dotenv').config();

const ACCOUNTS_DB = path.join(__dirname, '../accounts.json');
const ENV_FILE = path.join(__dirname, '../.env');

// Initialize accounts database if it doesn't exist
function initDatabase() {
    if (!fs.existsSync(ACCOUNTS_DB)) {
        const data = {
            accounts: [],
            lastActive: null
        };
        fs.writeFileSync(ACCOUNTS_DB, JSON.stringify(data, null, 2));
        return data;
    }
    return JSON.parse(fs.readFileSync(ACCOUNTS_DB, 'utf8'));
}

// Get current active account from .env
function getCurrentAccount() {
    if (!fs.existsSync(ENV_FILE)) return null;
    
    const env = {};
    const content = fs.readFileSync(ENV_FILE, 'utf8');
    content.split('\n').forEach(line => {
        if (line.trim() && !line.startsWith('#')) {
            const [key, ...values] = line.split('=');
            env[key] = values.join('=');
        }
    });
    return env;
}

// Save account to database
function saveAccountToDatabase(account) {
    let db = initDatabase();
    const email = account.DISCORD_EMAIL;
    
    const existingIndex = db.accounts.findIndex(a => a.email === email);
    const newAccount = {
        username: account.BOT_USERNAME || 'Unknown',
        email: email,
        password: account.DISCORD_PASSWORD || '',
        ofLink: account.OF_LINK || ''
    };
    
    if (existingIndex >= 0) {
        db.accounts[existingIndex] = newAccount;
    } else {
        db.accounts.push(newAccount);
    }
    
    db.lastActive = email;
    fs.writeFileSync(ACCOUNTS_DB, JSON.stringify(db, null, 2));
}

// Load account to .env
function loadAccountToEnv(accountEmail) {
    let db = initDatabase();
    const account = db.accounts.find(a => a.email === accountEmail);
    
    if (!account) {
        console.error('Account not found:', accountEmail);
        return false;
    }
    
    // Read existing .env to preserve other settings
    let envContent = '';
    if (fs.existsSync(ENV_FILE)) {
        envContent = fs.readFileSync(ENV_FILE, 'utf8');
    }
    
    // Update account fields
    envContent = updateEnvValue(envContent, 'DISCORD_EMAIL', account.email);
    envContent = updateEnvValue(envContent, 'DISCORD_PASSWORD', account.password);
    envContent = updateEnvValue(envContent, 'BOT_USERNAME', account.username);
    envContent = updateEnvValue(envContent, 'OF_LINK', account.ofLink);
    
    fs.writeFileSync(ENV_FILE, envContent);
    
    db.lastActive = accountEmail;
    fs.writeFileSync(ACCOUNTS_DB, JSON.stringify(db, null, 2));
    
    return true;
}

// Helper function to update .env value
function updateEnvValue(content, key, value) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
        return content.replace(regex, `${key}=${value}`);
    }
    return content + `\n${key}=${value}`;
}

// List all accounts
function listAccounts() {
    const db = initDatabase();
    return db.accounts;
}

// Delete account
function deleteAccount(email) {
    let db = initDatabase();
    db.accounts = db.accounts.filter(a => a.email !== email);
    fs.writeFileSync(ACCOUNTS_DB, JSON.stringify(db, null, 2));
    return true;
}

module.exports = {
    initDatabase,
    getCurrentAccount,
    saveAccountToDatabase,
    loadAccountToEnv,
    listAccounts,
    deleteAccount,
    ACCOUNTS_DB
};
