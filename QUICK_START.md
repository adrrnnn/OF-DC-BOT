# 🚀 QUICK START GUIDE

## 30-Second Setup

1. **Start the bot:**
   ```bash
   node bot.js
   ```

2. **Wait for it to be ready** (watch for logs):
   ```
   [INFO] Discord bot starting...
   [INFO] Browser ready
   [INFO] Successfully logged in
   [INFO] DM polling started (checking every 60000ms)
   ```

3. **Send a test DM** to the bot account from another Discord account

4. **Wait ~60 seconds** for the polling cycle

5. **Check the reply** - Bot should auto-respond!

---

## What to Expect

### First Run
```
[INFO] DM polling started (checking every 60000ms)
[INFO] Starting health check interval...
(Waits about 60 seconds for first poll)
[INFO] Checking 1 DM(s) for new messages...
[INFO] ✓ NEW MESSAGE from TestUser#1234
[INFO] Generated reply: "Thanks for reaching out!"
[INFO] Message sent successfully
```

### Cache File Created
```
data/dm-cache.json
{
  "987654321": {
    "lastMessageId": "msg_12345_abc",
    "lastCheckTime": 1705327845000,
    "messageCount": 1,
    "hasNewMessages": false
  }
}
```

### Sidebar Behavior
- Sidebar stays **visible** throughout operation ✅
- Bot can reliably detect DMs
- No constant reloading or flickering

---

## Key Changes You Should Know

### Old Behavior (Broken ❌)
- Checked every DM every 5 seconds
- Looked for red "unread" badges
- Sidebar would disappear
- Bot would go blind

### New Behavior (Fixed ✅)
- Checks every 60 seconds
- Compares message IDs instead of badges
- Sidebar stays visible
- Bot detects messages reliably

---

## Performance Gains

| Aspect | Old | New | Improvement |
|--------|-----|-----|-------------|
| Poll Interval | 5s | 60s | 12× slower |
| Checks/Hour | 720 | 60 | 92% fewer |
| Sidebar Status | Hides | Visible | ✅ Fixed |
| Discord Detection | Detected | Not detected | ✅ Fixed |

---

## If Something Goes Wrong

### "Failed to get latest message ID"
- Discord may have changed DOM structure
- Try sending another message
- Check browser window manually

### Sidebar disappears
- Check that `dmCheckInterval = 60000` (not less)
- Too-frequent polling triggers Discord protection
- Restart bot and wait longer between checks

### Bot doesn't reply
- Check logs for "✓ NEW MESSAGE" detection
- Verify Discord allows bot to send messages
- Try manual message sending

### Cache not saving
- Ensure `data/` folder exists and is writable
- Check disk space
- Verify file permissions

---

## File Structure

```
DC Bot/
├── bot.js                         ← MAIN FILE (start here)
├── src/
│   ├── browser-controller.js      (Updated: new methods)
│   ├── dm-cache-manager.js        (New: cache system)
│   ├── conversation-manager.js    (Message tracking)
│   ├── message-handler.js         (Message processing)
│   └── [other modules]
├── data/
│   ├── conversations.json         (Conversation history)
│   └── dm-cache.json              (Created automatically)
└── [Documentation files]
```

---

## Documentation Files

For deeper information, read:

1. **STATUS_REPORT.md** - Current status & summary
2. **README_IMPLEMENTATION.md** - High-level overview
3. **ARCHITECTURE_FLOWCHART.md** - System diagrams
4. **TESTING_GUIDE.md** - Detailed test procedures
5. **VALIDATION_CHECKLIST.md** - Verification items
6. **IMPLEMENTATION_SUMMARY.md** - Technical details

---

## Key Metrics to Watch

✅ Bot should:
- [x] Detect new DMs within 120 seconds
- [x] Generate intelligent replies
- [x] Wait 5 minutes between replies to same user
- [x] Handle multiple users (check one at a time)
- [x] Keep sidebar visible and responsive
- [x] Use minimal CPU when idle

❌ Bot should NOT:
- [ ] Spam-check DMs constantly
- [ ] Crash with errors
- [ ] Send duplicate replies
- [ ] Hide the Discord sidebar
- [ ] Use excessive CPU/memory

---

## Common Commands

```bash
# Start the bot
node bot.js

# Stop the bot
Ctrl+C

# Check status
tail -f logs/latest.log

# Clear cache (fresh start)
rm data/dm-cache.json

# View conversation history
cat data/conversations.json
```

---

## Configuration (if needed)

Edit `bot.js` to change:
```javascript
this.dmCheckInterval = 60000;      // How often to poll (default: 60s)
this.dmCheckMinInterval = 30000;   // Min time between DM re-checks (default: 30s)
```

⚠️ **WARNING**: Don't set interval below 30 seconds! Discord will hide sidebar.

---

## Expected Behavior Timeline

```
T=0s:    Bot starts
T=60s:   First poll → Detects first DM
         Bot replies → Enters 5-min conversation wait

T=120s:  Still waiting (only checks locked user)

T=300s:  Conversation timeout → Can check other users

T=360s:  Poll resumes normal multi-DM checking

(Repeat every 60 seconds)
```

---

## Need Help?

1. **Check the logs** - Most issues visible there
2. **Read TESTING_GUIDE.md** - Has troubleshooting section
3. **Verify Discord manually** - Send/receive messages normally?
4. **Check file permissions** - Can write to `data/` folder?

---

## You're Ready!

```bash
node bot.js
```

The bot will:
1. Load Discord ✓
2. Check for unread DMs every 60 seconds ✓
3. Detect new messages using smart caching ✓
4. Generate and send intelligent replies ✓
5. Wait 5 minutes before replying to same user ✓
6. Keep the sidebar visible and responsive ✓

**Status: ✅ READY TO RUN**

---

## Monitoring

Watch for these log messages:

```
✓ Expected (Good)
└─ "DM polling started"
└─ "✓ NEW MESSAGE from"
└─ "Message sent successfully"
└─ "Checking X DM(s)"

✗ Unexpected (Problem)
└─ "Failed to get latest message ID"
└─ "Could not open DM"
└─ Repeated errors without recovery
```

---

**Happy botting! 🤖**
