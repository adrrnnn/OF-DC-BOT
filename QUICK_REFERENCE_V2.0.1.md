# v2.0.1 Quick Reference - Message Parsing Fixes

## What Was Fixed

| Issue | Symptom | Fix |
|-------|---------|-----|
| **Author Parsing** | Messages showed `author=Unknown` instead of actual username | Implemented DOM-first extraction + text parsing with better regex |
| **Race Condition** | First `getMessages()` returned `articles=0`, then 50 on retry | Added smart retry loop that waits for articles to load (max 5 sec) |
| **Bot Username** | Bot showed as `You` instead of actual name | Use `.env BOT_USERNAME` first, then DOM fallback |
| **OF Link Detection** | `hasOFLink=false` even when user mentioned "onlyfans" | Added regex detection during message extraction phase |

## Key Code Changes

### 1. Author Extraction (getMessages)
```javascript
// OLD: Regex only
const authorMatch = firstLine.match(/^([^\—\[\d:]+)/);

// NEW: DOM-first with text parsing fallback
const headerSpan = article.querySelector('[class*="username"], [class*="author"], strong');
if (headerSpan?.textContent) {
  author = headerSpan.textContent.trim();
} else if (firstLine.includes('—')) {
  author = firstLine.split('—')[0].trim();
}
```

### 2. Race Condition Fix (openDM)
```javascript
// OLD: Fixed 1500ms timeout
await new Promise(r => setTimeout(r, 1500));

// NEW: Smart retry loop (max 5 seconds)
let articlesLoaded = false;
for (let i = 0; i < 10; i++) {
  await new Promise(r => setTimeout(r, 500));
  const count = await this.page.evaluate(() => 
    document.querySelectorAll('[role="article"]').length
  );
  if (count > 0) {
    articlesLoaded = true;
    break;
  }
}
```

### 3. Bot Username (getBotUsername)
```javascript
// OLD: Only DOM detection
const username = await this.page.evaluate(/* ... */);

// NEW: Priority chain (.env → DOM → fallback)
const envUsername = process.env.BOT_USERNAME;
if (envUsername && envUsername !== 'Unknown' && envUsername !== 'You') {
  return envUsername;
}
// fallback to DOM
const username = await this.page.evaluate(/* ... */);
if (username && username !== 'Unknown' && username !== 'You') {
  return username;
}
return 'Bot'; // ultimate fallback
```

### 4. OF Link Detection
```javascript
// NEW: Added to message extraction
const hasOFLink = /onlyfans|of\s*link|my\s*link|check\s*me\s*out/i.test(
  content + ' ' + fullText
);
msgs.push({ author, content, hasOFLink });
```

## Files Modified
- `src/browser-controller.js` - 92 insertions, 47 deletions

## Testing

Run the bot and monitor logs for:
```
✓ author shows correct username (not "Unknown")
✓ "Article check 1/10: found X articles" appears once
✓ botUsername shows actual account name (not "You")
✓ hasOFLink=true when messages mention onlyfans
```

## Backward Compatibility
✅ All changes are fully backward compatible
✅ No database changes required
✅ Works with existing .env setup
✅ No configuration changes needed

## Commits
- **208dd2a** - Fix message parsing bugs
- **602ebbe** - Add v2.0.1 documentation

