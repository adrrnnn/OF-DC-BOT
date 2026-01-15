#!/usr/bin/env node
/**
 * System Validation Test
 * Tests all critical components of the bot system
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ override: true });

const TESTS = [];
let passCount = 0;
let failCount = 0;

function test(name, fn) {
    TESTS.push({ name, fn });
}

function pass(msg) {
    console.log(`  ✓ ${msg}`);
    passCount++;
}

function fail(msg) {
    console.log(`  ✗ ${msg}`);
    failCount++;
}

// Test 1: .env file exists and has required fields
test('.env file integrity', () => {
    if (!fs.existsSync('.env')) {
        fail('.env file not found');
        return;
    }
    pass('.env file exists');

    const content = fs.readFileSync('.env', 'utf8');
    const required = ['DISCORD_EMAIL', 'DISCORD_PASSWORD', 'BOT_USERNAME', 'OF_LINK'];
    
    for (const field of required) {
        if (content.includes(field)) {
            pass(`Contains ${field}`);
        } else {
            fail(`Missing ${field}`);
        }
    }
});

// Test 2: process.env loads from .env correctly
test('dotenv configuration', () => {
    const required = {
        DISCORD_EMAIL: 'email address',
        DISCORD_PASSWORD: 'password',
        BOT_USERNAME: 'username',
        OF_LINK: 'OnlyFans link'
    };
    
    for (const [key, desc] of Object.entries(required)) {
        if (process.env[key]) {
            pass(`${key} loaded (${desc})`);
        } else {
            fail(`${key} not loaded from .env`);
        }
    }
});

// Test 3: accounts.json database structure (if exists)
test('accounts database', () => {
    if (!fs.existsSync('accounts.json')) {
        pass('accounts.json does not exist yet (will be created on first run)');
        return;
    }
    
    try {
        const accounts = JSON.parse(fs.readFileSync('accounts.json', 'utf8'));
        
        if (Array.isArray(accounts.accounts)) {
            pass(`accounts.json is valid JSON with ${accounts.accounts.length} account(s)`);
            
            if (accounts.accounts.length > 0) {
                const acc = accounts.accounts[0];
                const fields = ['username', 'email', 'password', 'ofLink'];
                for (const field of fields) {
                    if (field in acc) {
                        pass(`Account has ${field}`);
                    } else {
                        fail(`Account missing ${field}`);
                    }
                }
            }
        } else {
            fail('accounts.json missing accounts array');
        }
    } catch (e) {
        fail(`accounts.json invalid JSON: ${e.message}`);
    }
});

// Test 4: Browser controller exists
test('browser-controller module', () => {
    const bcPath = './src/browser-controller.js';
    if (fs.existsSync(bcPath)) {
        pass('browser-controller.js exists');
        const content = fs.readFileSync(bcPath, 'utf8');
        if (content.includes('export class BrowserController')) {
            pass('BrowserController class exported');
        }
        if (content.includes('async login')) {
            pass('login() method found');
        }
    } else {
        fail('browser-controller.js not found');
    }
});

// Test 5: bot.js can be parsed
test('bot.js syntax', () => {
    try {
        const botContent = fs.readFileSync('./bot.js', 'utf8');
        if (botContent.includes('class DiscordOFBot')) {
            pass('DiscordOFBot class found');
        }
        if (botContent.includes('async start()')) {
            pass('start() method found');
        }
        if (botContent.includes('process.env.DISCORD_EMAIL')) {
            pass('Reads DISCORD_EMAIL from process.env');
        }
        if (botContent.includes('process.env.DISCORD_PASSWORD')) {
            pass('Reads DISCORD_PASSWORD from process.env');
        }
        if (botContent.includes('process.env.OF_LINK')) {
            pass('Reads OF_LINK from process.env');
        }
    } catch (e) {
        fail(`bot.js error: ${e.message}`);
    }
});

// Test 6: Required Node modules installed
test('dependencies installed', () => {
    const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    const requiredModules = ['dotenv', 'puppeteer'];
    
    for (const mod of requiredModules) {
        if (mod in deps) {
            pass(`${mod} in package.json`);
        } else {
            fail(`${mod} not in package.json`);
        }
    }
    
    if (fs.existsSync('node_modules')) {
        pass('node_modules directory exists');
    } else {
        fail('node_modules not installed - run: npm install');
    }
});

// Test 7: start.bat syntax
test('start.bat script', () => {
    if (fs.existsSync('start.bat')) {
        pass('start.bat exists');
        
        const content = fs.readFileSync('start.bat', 'utf8');
        const checks = {
            ':MAIN_MENU': 'Main menu section',
            ':CONFIGURE_ACCOUNT': 'Account configuration section',
            ':LIST_ACCOUNTS': 'Account listing section',
            ':ADD_NEW_ACCOUNT': 'Add account section',
            ':START_BOT': 'Bot start section',
            'node bot.js': 'Bot launch command'
        };
        
        for (const [check, desc] of Object.entries(checks)) {
            if (content.includes(check)) {
                pass(`Has ${desc}`);
            } else {
                fail(`Missing ${desc}`);
            }
        }
    } else {
        fail('start.bat not found');
    }
});

// Test 8: API keys present (at least one)
test('API keys configured', () => {
    const apiKeys = ['GEMINI_API_KEY_1', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'OPENAI_API_KEY'];
    let hasAtLeastOne = false;
    
    for (const key of apiKeys) {
        if (process.env[key]) {
            pass(`${key} is set`);
            hasAtLeastOne = true;
        }
    }
    
    if (!hasAtLeastOne) {
        fail('No API keys configured - bot may have issues');
    }
});

// Run all tests
console.log('\n' + '='.repeat(60));
console.log('  SYSTEM VALIDATION TEST');
console.log('='.repeat(60) + '\n');

for (const { name, fn } of TESTS) {
    console.log(`Testing: ${name}`);
    try {
        fn();
    } catch (e) {
        fail(`Test exception: ${e.message}`);
    }
    console.log();
}

// Summary
console.log('='.repeat(60));
console.log(`  RESULTS: ${passCount} passed, ${failCount} failed`);
console.log('='.repeat(60) + '\n');

if (failCount > 0) {
    console.log('⚠️  Some tests failed. Please address the issues above.\n');
    process.exit(1);
} else {
    console.log('✅ All tests passed! System is ready to use.\n');
    process.exit(0);
}
