# Critical Fixes Applied - Bot Issues Resolved

## Issues Identified from Production Logs

### 1. ❌ Discord UI Button Text in Messages
**Problem:** Message extraction was including Discord button/menu text:
```
"content":"19:36четверг, 15 января 2026 г. в 19:36hi! how are you?:100:Нажмите, чтобы отреагировать:thumbsdown:Нажмите, чтобы отреагировать:thumbsup:Нажмите, чтобы отреагироватьДобавить реакциюИзменитьПереслатьЕщё"
```

**Root Cause:** `getMessages()` in `browser-controller.js` didn't filter Discord UI elements like:
- Emoji reaction buttons (`:100:`, `:thumbsup:`, `:thumbsdown:`)
- Menu items ("Нажмите, чтобы отреагировать", "Добавить реакцию", "Изменить", "Переслать", etc.)

**Fix Applied:** Enhanced regex patterns to remove:
- `:[emoji_name]:Текст:` patterns (reaction buttons)
- Cyrillic menu text ("Изменить", "Переслать", "Удалить", "Добавить реакцию")
- English menu text ("Edit", "Forward", "Delete", "Reply", "Copy")
- Extra whitespace cleanup

**Commit:** `8a14b97`

---

### 2. ❌ Broken AI Responses (Unnatural Emoji/Flirty Text)
**Problem:** AI generated unnatural responses like:
```
"Ooh, that's a tough one! I love a good rom-com hehe, maybe *Clueless*? :3"
```

This is forced emoji/cutesy speech, not natural conversation.

**Root Cause:** `systemPrompt` in `config/templates.json` explicitly instructed:
```
"You're playful, use lots of 'hehe', ':3', ':p', 'lol'"
"Be cute and flirty but tease"
"Match their energy - if they're horny, be flirty back"
```

This overrode the training data context and forced unnatural responses.

**Fix Applied:** Updated systemPrompt to:
```
"Be natural and conversational - like texting with a friend.
Don't use forced emoji or cutesy speak like 'hehe' ':3' ':p'
Match the conversation style from the training examples"
```

Now AI generates responses based on training data examples instead of forced personality.

**Commit:** `00ef95b`

---

### 3. ⚠️ Bot Responding to Itself
**Problem:** Bot was extracting its own responses as user messages and responding to them:
```
[INFO] "author":"undefined"
[INFO] Processing DM from undefined
[INFO] "New message found from undefined"
```

**Root Cause:** Author extraction was failing (returning undefined), and message deduplication wasn't catching the bot's own messages.

**Status:** PARTIALLY FIXED - Message extraction now properly extracts authors, but need to verify the deduplication logic is working.

**Related Fix:** Improved author extraction in `getMessages()` - now checks DOM selectors first, with better fallback parsing.

---

### 4. ⚠️ Duplicate Responses Sent
**Problem:** Bot sent multiple responses to the same message:
```
[11:37:45.121Z] Attempting to send: "Ooh, that's a tough one! I'm a total sucker for a good rom-com..."
[11:37:45.676Z] Attempting to send: "Ooh, that's a hard one! I love anything cute and romantic..."
```
555ms apart - violates "1 message per 1 message" rule.

**Root Cause:** Message deduplication logic may not be working properly, or multiple AI requests were fired simultaneously.

**Status:** NEEDS INVESTIGATION - The fixes above should help, but this needs testing to confirm.

---

## Summary of Changes

| File | Change | Purpose |
|------|--------|---------|
| `src/browser-controller.js` | Enhanced `getMessages()` DOM cleaning | Remove Discord UI button/menu text from extracted messages |
| `config/templates.json` | Updated `systemPrompt` | Natural responses instead of forced emoji/flirty speak |

## Testing Recommendations

1. **Run with test messages** to verify:
   - ✅ No UI button text in extracted messages
   - ✅ AI responses are natural (no "hehe", ":3", ":p")
   - ✅ Only 1 response per message sent
   - ✅ No "undefined" authors

2. **Check logs for:**
   ```
   [DEBUG] Extraction result: articles=XX, extracted=YY
   [DEBUG] getMessages: Extracted N message(s): [{"author":"username","content":"actual message"}]
   ```
   Should show only actual message content, no button text.

3. **Monitor AI responses** for natural language without forced emoji.

---

## Commit History

```
00ef95b - fix: Remove forced emoji/cutesy speech from AI systemPrompt
8a14b97 - fix: Clean Discord UI button text from message extraction
```

All fixes applied and committed to main branch.
