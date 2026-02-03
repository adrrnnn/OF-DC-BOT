# CHECKPOINT V6 - Message Collection & Extraction Refactor

**Date:** February 4, 2026  
**Status:** Pre-Contextual Response Fix

---

## What Was Just Fixed

### 1. **Message Collection System Simplified**
- ✅ Changed from 5-second to 10-second message collection timer
- ✅ Resets timer if new article detected during wait window
- ✅ Accumulates articles in queue during 10-second window
- ✅ Combines queued articles into single message at timeout

**Code Flow:**
```
Poll detects new article
  ↓
Compare HTML to lastSeenArticles
  ↓
If new → add to articleQueues
  ↓
Start/reset 10-second timer
  ↓
During wait: more articles → add to queue, reset timer
  ↓
Timer expires → combine queue → store in pendingCombinedMessages
  ↓
processDM uses pendingCombinedMessages (no re-extraction)
```

### 2. **Article Extraction Simplified**
- ✅ Extract only 1 article per poll (instead of 3-10)
- ✅ Store article HTML for duplicate detection via lastSeenArticles
- ✅ More lenient author validation (accept "dm_user" fallback)
- ✅ Only reject articles with zero content (no text after metadata removal)
- ✅ Bot messages still filtered by checking author name specifically

**Key Changes in browser-controller.js:**
- Lines 503-575: Extract loop now processes `processedCount < 1` (was `< 3`)
- Removed lastAuthor tracking logic (no longer needed with single-article approach)
- Removed message combination logic from extraction (now done in bot.js timer)
- Added `articleHTML` field to returned messages for comparison

### 3. **System Prompt Enhanced**
- ✅ Updated systemPrompt in templates.json to emphasize contextual responses
- ✅ Added critical rules: reference what user said, never ask questions back, avoid repetition
- ✅ Included examples of bad vs good responses
- ✅ Focused on listening/engagement vs generic replies

---

## Current Architecture (Working)

### Bot.js Changes
```javascript
this.articleQueues = new Map()              // Per-user article queue
this.lastSeenArticles = new Map()           // Per-user last seen article HTML
this.pendingCombinedMessages = new Map()    // Per-user combined message waiting for processDM
```

### checkDMForNewMessages Flow
1. Extract latest 1 article
2. Compare `article.articleHTML` to `lastSeenArticles.get(userId)`
3. If different (new article):
   - Add to `articleQueues[userId]`
   - Update `lastSeenArticles[userId]`
   - Call `startMessageCollectionTimer()`
4. Return true (timer will process)

### startMessageCollectionTimer Flow
1. Cancel existing timer for user (if any)
2. Set 10-second timeout
3. On timeout:
   - Combine all articles in `articleQueues[userId]` by joining content with spaces
   - Store combined message in `pendingCombinedMessages[userId]`
   - Clear `articleQueues[userId]`
   - Call `processDM()`

### processDM Flow
1. Check if `pendingCombinedMessages` has entry for user
2. If yes: use that combined message (no re-extraction)
3. If no: fallback to extracting via `getMessagesWithRetry()` (for initial/direct calls)
4. Continue normal message handling

---

## Current Test Results

### What Works ✅
- Bot detects new articles correctly
- Timer resets when user sends multiple lines
- Articles combine into single message
- Bot responds with context ("not much, just chilling tonight" vs generic "not much")
- 10-second wait allows multi-line collection
- No re-extraction during processing

### What's Broken ❌
- AI responses still too generic/dry despite new prompt
- Bot not fully leveraging training data conversation patterns
- Responses lack personality/engagement (e.g., "oh nice" instead of "thats cool, what kind")
- Still occasionally asks questions back despite prompt saying not to

**Example from logs:**
```
User: "i like playing games you know"
Bot: "yeah i play sometimes" ← Should reference WHAT game type or show more interest
```

---

## Next Steps (Not Yet Implemented)

### Issue to Fix
The system prompt is better but AI is not fully adopting the contextual response style from training data. Need to:

1. **Enhance AI prompt further** - Add more concrete examples from actual conversations
2. **Add conversation history context** - Give AI recent messages so it understands flow
3. **Implement personality embedding** - Make AI understand Yuki's specific conversational style
4. **Add response validation** - Filter AI responses that ask questions or are too dry

### Files Involved
- `config/templates.json` - systemPrompt (already updated, may need more work)
- `src/ai-handler.js` - May need to add conversation history to prompt
- `src/message-handler.js` - May need response filtering/validation

---

## Key Learnings

1. **Single article extraction is simpler** - No guessing about "is this a continuation line", just detect new articles
2. **Queue-based accumulation works** - Better than trying to extract multiple articles and combine them
3. **HTML comparison is reliable** - Discord article HTML includes unique IDs, perfect for duplicate detection
4. **Separation of concerns** - Extraction finds articles, timer accumulates them, processDM handles logic
5. **Training data shows patterns** - Real conversations have personality, engagement, context - templates alone aren't enough

---

## Code State

**Files Modified:**
- ✅ `bot.js` - Added message collection tracking maps, rewrote `startMessageCollectionTimer()`, updated `checkDMForNewMessages()`
- ✅ `src/browser-controller.js` - Extraction loop now gets 1 article, removed combination logic
- ✅ `config/templates.json` - Enhanced systemPrompt with contextual rules

**Files Untouched:**
- `src/message-handler.js`
- `src/ai-handler.js`
- `src/ai-provider.js`

---

## Rollback Info

If needed to revert to previous state, key changes were:
- bot.js: Lines 40-50, 287-340, 617-654
- browser-controller.js: Lines 503-590
- templates.json: systemPrompt field

All changes are additive (new maps) or replacement (timer/extraction logic), no deletions of working features.
