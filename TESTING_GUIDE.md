# Testing Guide - New Message Detection System

## Pre-Test Setup

1. **Ensure Discord account is ready**
   - Bot account credentials in `.env` file
   - Test account ready to send DMs to bot

2. **Check file structure**
   ```
   DC Bot/
   ├── bot.js
   ├── .env (credentials)
   ├── src/
   │   ├── browser-controller.js ✅ UPDATED
   │   ├── dm-cache-manager.js ✅ NEW
   │   ├── conversation-manager.js
   │   └── message-handler.js
   └── data/
       └── conversations.json
   ```

3. **Clear old cache (optional)**
   - Delete `data/dm-cache.json` to start fresh
   - Delete `data/conversations.json` to reset conversations

## Test Case 1: Initial DM Detection

**Objective**: Verify bot detects first DM and initializes cache

**Steps**:
1. Start bot: `node bot.js`
2. Wait for login: Check for "Browser ready" in logs
3. Send test DM to bot account from another Discord account
4. Wait for next 60-second polling cycle
5. Observe logs

**Expected Results**:
- [ ] "DM polling started (checking every 60000ms)" appears in logs
- [ ] After ~60 seconds: "Checking X DM(s) for new messages..." 
- [ ] "✓ NEW MESSAGE from {userId}" appears in logs
- [ ] Bot generates reply using template matching
- [ ] "Message sent successfully" appears in logs
- [ ] Cache file created: `data/dm-cache.json` contains the DM
- [ ] Cache shows: `lastMessageId` = extracted message ID
- [ ] Cache shows: `messageCount` = number of messages (should be 1+)

**Debug if fails**:
- Check logs for message ID extraction: "Failed to get latest message ID" = extraction issue
- Check browser window: Is DM actually opening?
- Verify Discord is not blocking: Try manual DM navigation
- Check cache file exists and has content

## Test Case 2: No Duplicate Reply (Message ID Caching)

**Objective**: Verify bot doesn't reply to same message twice

**Steps**:
1. Continue from Test Case 1 (bot already running)
2. Wait another 30+ seconds (to trigger next check of that DM)
3. Observe logs
4. Check Discord: Should only see ONE reply from bot

**Expected Results**:
- [ ] Another polling cycle starts ~30s later
- [ ] "No new messages from {userId} (message ID unchanged)" appears in logs
- [ ] Bot does NOT generate another reply
- [ ] Discord shows only 1 bot message in conversation
- [ ] Cache still contains same `lastMessageId` (unchanged)

**Debug if fails**:
- If bot sends duplicate reply: Message ID extraction inconsistent
  - Same message should return same ID
  - Check `getLatestMessageId()` method
- If no logs appear: Polling might be skipping DM
  - Check `shouldCheckDM()` timing logic
  - Verify `dmCheckMinInterval = 30000`

## Test Case 3: New Message Detection (5-Minute Wait)

**Objective**: Verify bot waits 5 minutes then detects new message

**Steps**:
1. Continue from Test Case 2
2. From test account, send a SECOND message to bot
3. Check logs immediately (should NOT detect yet - in conversation)
4. Wait 5 minutes
5. Send THIRD message (or bot might auto-reply at timeout)
6. Observe logs

**Expected Results**:
- [ ] First message after 5 min timeout: Bot detects new message
- [ ] "✓ NEW MESSAGE" appears after 5 minute wait
- [ ] Bot generates new reply
- [ ] Reply correctly addresses new message
- [ ] Cache updated with new `lastMessageId`
- [ ] Bot enters 5-minute conversation wait again

**Debug if fails**:
- If bot replies too quickly: Conversation timeout not working
  - Check `inConversationWith` logic in polling
  - Verify conversation timeout = 300000ms (5 minutes)
- If bot never detects message: Message ID extraction or comparison issue
  - Verify different messages return different IDs
  - Check cache update logic

## Test Case 4: Multiple DMs (Selective Checking)

**Objective**: Verify bot only checks DMs needing re-checks

**Steps**:
1. Continue from Test Case 3
2. Send DM from SECOND test account (different user)
3. Wait for polling cycle
4. Check logs
5. Send message from FIRST test account again (after conversation timeout)
6. Check logs

**Expected Results**:
- [ ] "Checking X DM(s) for new messages..." where X = 2
- [ ] First new DM detected and processed
- [ ] Bot enters 5-minute wait with first user
- [ ] Second DM marked in cache but not re-checked (< 30s since first check)
- [ ] After first conversation timeout (5 min), second DM is re-checked
- [ ] Cache file contains entries for both users
- [ ] Sidebar remains visible throughout (no collapse)

**Debug if fails**:
- If sidebar disappears: Polling too aggressive
  - Verify interval is 60s, not 5s
  - Check for rapid DM opening loops
- If both DMs processed simultaneously: Concurrency issue
  - Should process one DM at a time
  - Check for `break` statement after processing

## Test Case 5: Message ID Consistency

**Objective**: Verify same message returns same ID

**Steps**:
1. Look at one DM in Discord (don't send new message)
2. Wait for bot polling cycle
3. Check extracted message ID in logs
4. Wait another polling cycle (30+ seconds)
5. Check extracted message ID again
6. Compare IDs

**Expected Results**:
- [ ] Same message returns same ID on both checks
- [ ] ID appears in cache file
- [ ] No "NEW MESSAGE" alert when IDs match
- [ ] ID is either:
  - [ ] Discord's native message ID (from data attributes)
  - [ ] Hash of timestamp + content (fallback strategy)

**Debug if fails**:
- If IDs don't match: Extraction inconsistent
  - Problem: Fallback strategy using timestamp might include milliseconds
  - Check `getLatestMessageId()` hash creation
  - May need to round timestamp to seconds instead of milliseconds

## Test Case 6: Sidebar Stability

**Objective**: Verify sidebar doesn't collapse during polling

**Steps**:
1. Start bot, login
2. Watch Discord window for 5-10 minutes
3. Note any times sidebar:
   - Disappears
   - Shows fewer DMs than before
   - Reloads/flickers
   - Becomes unresponsive

**Expected Results**:
- [ ] Sidebar remains visible and stable
- [ ] DM list doesn't change unexpectedly
- [ ] Can manually click DMs throughout test
- [ ] No "re-syncing" or reload messages

**Debug if fails**:
- If sidebar collapses: Discord anti-bot measure triggered
  - Likely cause: Still checking every DM too frequently
  - Check polling interval (should be 60s exactly, not less)
  - Check `getDMsToCheck()` - verify 30s min between re-checks
  - Add random delays (1-3s) between DM opens

## Test Case 7: Cache Persistence

**Objective**: Verify cache survives bot restart

**Steps**:
1. Run bot for ~2 minutes (process at least one DM)
2. Check `data/dm-cache.json` exists and has content
3. Note cache content (copy to file if needed)
4. Stop bot: Press Ctrl+C
5. Wait 5 seconds
6. Start bot again: `node bot.js`
7. Check cache file

**Expected Results**:
- [ ] Cache file still exists after restart
- [ ] Cache contains same DM entries as before
- [ ] `lastCheckTime` updated to new restart time
- [ ] Bot doesn't re-check recently-checked DMs
- [ ] Conversation history preserved in `conversations.json`

**Debug if fails**:
- If cache lost: File write issue
  - Check folder permissions: `data/` directory writable
  - Check errors in `saveCache()` method
- If old data used: Load issue
  - Verify `loadCache()` called in constructor
  - Check JSON parsing in load method

## Test Case 8: Performance Monitoring

**Objective**: Verify polling efficiency

**Steps**:
1. Run bot for 5 minutes with 2-3 active DMs
2. Count lines in debug logs (or redirect to file)
3. Note timing between checks
4. Monitor CPU and memory usage

**Expected Results**:
- [ ] Polling occurs at ~60 second intervals (±2s)
- [ ] Each DM checked at most once per 30 seconds
- [ ] CPU stays below 5% (mostly idle between polls)
- [ ] Memory stable (no growth over time)
- [ ] Logs show clear "Checking X DM(s)" messages at regular intervals
- [ ] No error logs for normal operation

**Debug if fails**:
- If polling too frequent: Check interval setting
  - Should be: `dmCheckInterval = 60000`
- If DM re-checked too often: Min interval too short
  - Should be: `dmCheckMinInterval = 30000`
- If CPU high: Something looping in background
  - Check for infinite loops in polling
  - Verify promises are awaited correctly

## Cleanup After Testing

1. **Stop bot**: Press Ctrl+C in terminal
2. **Optional: Clear cache**:
   ```bash
   rm data/dm-cache.json
   ```
3. **Check conversation log**:
   - View `data/conversations.json` to see tracked conversations
4. **Save logs** for debugging if issues found
5. **Reset test accounts** if needed

## Expected Log Output Example

```
[INFO] Discord bot starting...
[INFO] Browser ready (1920x1080)
[INFO] Successfully logged in
[INFO] DM polling started (checking every 60000ms)
[INFO] Starting health check interval...

[After 60 seconds]
[INFO] Checking 1 DM(s) for new messages...
[INFO] Found 1 DM(s) to check
[INFO] ✓ NEW MESSAGE from user123: Message ID changed (cache detected change)
[INFO] Found new message from TestUser#1234
[INFO] Generated reply: "Thanks for the message!"
[INFO] Message sent successfully

[After 30 seconds]  
[INFO] Checking 1 DM(s) for new messages...
[INFO] No new messages from user123 (message ID unchanged)
```

## Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| "Failed to get latest message ID" | DOM structure changed | Update selectors in `getLatestMessageId()` |
| Sidebar disappears | Polling too aggressive | Increase `dmCheckInterval` to 60000+ |
| DM re-checked every time | Wrong min interval | Verify `dmCheckMinInterval = 30000` |
| Duplicate replies | Message ID inconsistent | Fix `getLatestMessageId()` hash logic |
| Cache not saving | Permission issue | Check `data/` folder writable |
| Bot doesn't detect any DMs | Polling never finds DMs | Verify `getUnreadDMs()` returns results |
| Memory grows over time | Cache not cleaned up | Add cache pruning to clean old entries |

## Success Criteria

All of the following must be TRUE for system to be considered working:

- [ ] Bot detects new DMs without opening every DM every cycle
- [ ] Same message doesn't trigger multiple replies
- [ ] Sidebar remains visible and responsive
- [ ] Polling occurs at human-like intervals (60 seconds)
- [ ] Cache file persists correctly
- [ ] Message IDs are consistent
- [ ] Bot waits 5 minutes between consecutive replies to same user
- [ ] CPU/Memory usage is minimal
- [ ] No error spam in logs

---

**Ready to test!** Run: `node bot.js`
