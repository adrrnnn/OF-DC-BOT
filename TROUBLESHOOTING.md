# Troubleshooting Guide

## Common Issues & Solutions

### 1. "Node.js not installed" or "npm not found"
**Symptom**: start.bat shows error and exits  
**Solution**:
1. Download Node.js from https://nodejs.org/
2. Install with default settings
3. Restart your terminal/command prompt
4. Run `start.bat` again

---

### 2. ".env file not found" on first run
**Symptom**: Menu prompts for account credentials  
**This is normal** - system is setting up for the first time

**Solution**:
1. Enter your Discord email
2. Enter your Discord password
3. Enter your Discord username
4. Enter your OnlyFans link
5. System creates `accounts.json` and `.env` automatically

---

### 3. "Invalid accounts.json" or "accounts database error"
**Symptom**: start.bat shows JSON error when listing/switching accounts  
**Solution**:
1. Check if `accounts.json` exists in the root folder
2. Delete it: `del accounts.json`
3. Run `start.bat` and go through first-run setup again
4. **Note**: You'll need to re-enter your account credentials

---

### 4. "Discord login takes forever" (120+ seconds)
**Symptom**: Browser loads Discord but doesn't proceed  
**Why it happens**: 
- Discord may show captcha
- 2FA (two-factor authentication) may be required
- User may need to manually verify

**Solution**:
1. **Wait 120 seconds** - system will auto-fail if nothing happens
2. Watch the browser window for any prompts
3. If captcha appears: **solve it manually**
4. If 2FA code requested: **enter it manually**
5. System will detect when page loads and proceed

---

### 5. "Accounts not saving" or changes lost
**Symptom**: You edit account info but it doesn't persist  
**Solution**:
1. Make sure you **press Enter** after each input
2. Check that `accounts.json` and `.env` files aren't read-only:
   ```
   Right-click file → Properties → uncheck "Read-only"
   ```
3. Run `node test-system.js` to verify system integrity
4. If still broken, delete `accounts.json` and start fresh

---

### 6. ".env file corrupted" (unreadable format)
**Symptom**: system doesn't load credentials  
**Solution**:
1. Delete `.env` file: `del .env`
2. Run `start.bat` → Configure Account → Add New Account
3. Enter credentials again

---

### 7. "Bot crashes immediately" or exits without message
**Symptom**: start.bat says bot exited, but no error details  
**Solution**:
1. Run `node test-system.js` to validate system
2. Check that all required .env variables exist:
   ```
   DISCORD_EMAIL=youremail@gmail.com
   DISCORD_PASSWORD=yourpassword
   BOT_USERNAME=yourusername
   OF_LINK=https://onlyfans.com/...
   ```
3. Make sure at least one API key is configured (GEMINI_API_KEY_1, etc)
4. Check `logs/` directory for detailed error messages

---

### 8. "Permission denied" when running start.bat
**Symptom**: Windows won't run the file  
**Solution**:
1. Right-click `start.bat`
2. Select "Run as Administrator"
3. If that doesn't work:
   - Move start.bat to a folder without special characters in path
   - Avoid paths with spaces if possible

---

### 9. Multiple accounts, but wrong one active
**Symptom**: You selected an account but bot uses different one  
**Solution**:
1. Run `start.bat`
2. Select "Configure Account" → "View All Accounts"
3. Select the correct account from the list
4. Verify `.env` file shows correct email/username
5. Try again

---

### 10. Batch file won't show options properly
**Symptom**: Menu text is corrupted or doesn't display  
**Solution**:
1. This is usually a Windows terminal issue
2. Try: Right-click title bar → Properties → Font → select larger font
3. Or: Use Windows Terminal (new PowerShell) instead of cmd
4. Or: Run `cmd /k start.bat` explicitly

---

## Advanced Troubleshooting

### View .env file contents
```powershell
type .env
```

### View accounts.json contents
```powershell
type accounts.json
```

### Test that .env loads correctly
```powershell
node -e "require('dotenv').config(); console.log(process.env.DISCORD_EMAIL)"
```
Expected output: Your email address (not undefined)

### View system logs
```powershell
type logs/bot.log
```
(if logs exist - note: not all versions have logging)

### Reset entire system
```powershell
del .env
del accounts.json
node test-system.js
```
Then run `start.bat` and go through setup again.

---

## When to Contact Support

If the issue persists after trying above solutions:

1. Note the **exact error message**
2. Check **SYSTEM_VALIDATION.md** test results
3. Run `node test-system.js` and note any failures
4. Provide:
   - Error message
   - Last few lines of any .log files
   - Output of `node test-system.js`
   - **Do NOT share**: passwords, API keys, or personal info

---

## Performance Tuning

### If Discord takes too long to load:
1. Check internet connection (try `ping google.com`)
2. Discord servers may be slow - wait and retry
3. Try a different time of day
4. Disable VPN if using one (may slow down Discord)

### If bot responds slowly:
1. Check `RESPONSE_DELAY_MIN` and `RESPONSE_DELAY_MAX` in .env
   - Increase these if bot is responding too fast (gets flagged as bot)
   - Decrease if you want faster responses
2. Close other applications to free up RAM
3. Check Puppeteer is using GPU (should be on by default now)

### If API calls fail:
1. Verify API keys are valid
2. Check internet connection
3. Verify you haven't exceeded API rate limits
4. Try with different API key (GEMINI_API_KEY_2, etc)

---

## File Structure Reference

```
DC Bot/
├── start.bat              ← Run this to start
├── bot.js                 ← Main bot code
├── .env                   ← Active account (DO NOT SHARE)
├── accounts.json          ← All saved accounts (DO NOT SHARE)
├── test-system.js         ← Validation tool
├── SYSTEM_VALIDATION.md   ← This system report
├── src/
│   ├── browser-controller.js
│   ├── message-handler.js
│   └── ...
├── data/
│   ├── discord-cookies.json    ← Discord session (auto-created)
│   ├── logs/                   ← Error logs
│   └── ...
├── config/
│   └── settings.json
└── package.json           ← Dependencies list
```

---

## Quick Start Checklist

- [ ] Node.js installed (`node --version` works)
- [ ] npm installed (`npm --version` works)
- [ ] Dependencies installed (`npm install` completed)
- [ ] Run `node test-system.js` - shows 31/31 passed
- [ ] .env file exists with all required fields
- [ ] Run `start.bat`
- [ ] Enter credentials on first run
- [ ] Select "Start Bot" from menu
- [ ] Browser opens Discord
- [ ] Solve 2FA/captcha if prompted
- [ ] Bot is running and checking messages

---

**Last Updated**: 2026-01-15  
**System Status**: ✅ OPERATIONAL
