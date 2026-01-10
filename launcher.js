#!/usr/bin/env node
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configDir = path.join(process.cwd(), 'config');
const accountsFile = path.join(configDir, 'accounts.json');
const settingsFile = path.join(configDir, 'settings.json');

console.log('');
console.log('========================================');
console.log('  Discord OnlyFans Bot - Launcher');
console.log('========================================');
console.log('');

// Check if credentials exist
if (!fs.existsSync(accountsFile) || !fs.existsSync(settingsFile)) {
  console.log('ERROR: No credentials configured!');
  console.log('');
  console.log('Please run: node setup.js');
  console.log('');
  console.log('This will prompt you to enter:');
  console.log('  1. Your Discord email');
  console.log('  2. Your Discord password');
  console.log('  3. Your OnlyFans link');
  console.log('');
  process.exit(1);
}

// Load credentials from local database
let accounts = [];
let settings = {};

try {
  accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf-8'));
  settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
} catch (error) {
  console.log('ERROR: Failed to read credentials!');
  console.log('Details: ' + error.message);
  process.exit(1);
}

// Validate loaded data
if (!accounts || accounts.length === 0) {
  console.log('ERROR: No accounts configured!');
  console.log('Please run: node setup.js');
  process.exit(1);
}

if (!settings.activeAccount) {
  console.log('ERROR: No active account set!');
  console.log('Please run: node setup.js');
  process.exit(1);
}

// Find active account
const activeAccount = accounts.find(acc => acc.email === settings.activeAccount);
if (!activeAccount) {
  console.log('ERROR: Active account not found!');
  console.log('Please run: node setup.js');
  process.exit(1);
}

// Load existing .env to preserve API keys
dotenv.config();

// Create .env file from credentials database (preserve API keys)
const envContent = `DISCORD_EMAIL=${activeAccount.email}
DISCORD_PASSWORD=${activeAccount.password}
OF_LINK=${settings.ofLink || 'https://onlyfans.com'}
GEMINI_API_KEY_1=${process.env.GEMINI_API_KEY_1 || ''}
GEMINI_API_KEY_2=${process.env.GEMINI_API_KEY_2 || ''}
GEMINI_API_KEY_3=${process.env.GEMINI_API_KEY_3 || ''}
OPENAI_API_KEY=${process.env.OPENAI_API_KEY || ''}
CHECK_DMS_INTERVAL=5000
RESPONSE_DELAY_MIN=1000
RESPONSE_DELAY_MAX=3000`;

fs.writeFileSync(path.join(process.cwd(), '.env'), envContent, 'utf8');

// Reload env
dotenv.config({ override: true });

console.log('Email: ' + activeAccount.email);
console.log('OF Link: ' + (settings.ofLink || 'https://onlyfans.com'));
console.log('');
console.log('Status: Starting bot...');
console.log('');

// Spawn bot.js as a separate process
const botProcess = spawn('node', ['bot.js'], {
  cwd: process.cwd(),
  stdio: 'inherit'
});

botProcess.on('exit', (code) => {
  console.log('');
  if (code === 0) {
    console.log('Bot stopped gracefully.');
  } else {
    console.log('Bot exited with code: ' + code);
  }
  process.exit(code || 0);
});

botProcess.on('error', (error) => {
  console.log('');
  console.log('Bot process error: ' + error.message);
  process.exit(1);
});
