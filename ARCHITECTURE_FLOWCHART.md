# System Architecture Flowchart

## Overall System Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                     DISCORD BOT SYSTEM                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ bot.js - MAIN ORCHESTRATOR                                   │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │ • Polling loop (60 second intervals)                         │   │
│  │ • DMCacheManager instance                                    │   │
│  │ • Conversation state tracking                                │   │
│  │ • Message processing & routing                               │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│          ┌─────────────────────────────────────────────────┐        │
│          │                    POLLING LOOP                 │        │
│          ├─────────────────────────────────────────────────┤        │
│          │ Every 60 seconds:                               │        │
│          │ 1. Check if 60s has passed                      │        │
│          │ 2. If in conversation: only check that user     │        │
│          │ 3. Else: get cache list of DMs to check        │        │
│          │ 4. For each DM: extract message ID             │        │
│          │ 5. Compare with cached ID                       │        │
│          │ 6. If new: process DM                          │        │
│          │ 7. Return to friends list                       │        │
│          └─────────────────────────────────────────────────┘        │
│                    ↓                                                 │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ browser-controller.js - PUPPETEER INTERFACE                 │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │ • Puppeteer page control                                    │   │
│  │ • DOM navigation & queries                                  │   │
│  │ • getLatestMessageId() - NEW                                │   │
│  │   - Strategy 1: data-message-id attribute                   │   │
│  │   - Strategy 2: data-id attribute                           │   │
│  │   - Strategy 3: element id                                  │   │
│  │   - Fallback: timestamp + content hash                      │   │
│  │ • getMessageCount() - NEW                                   │   │
│  │   - Count [role="article"] elements                         │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ dm-cache-manager.js - STATE TRACKING                        │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │ • In-memory Map: userId → {state}                          │   │
│  │ • Persistent JSON: data/dm-cache.json                       │   │
│  │ • Per-DM tracks:                                            │   │
│  │   - lastMessageId: Message ID from last check              │   │
│  │   - lastCheckTime: Timestamp of last check                 │   │
│  │   - messageCount: Number of messages                        │   │
│  │   - hasNewMessages: Boolean flag                            │   │
│  │ • Key methods:                                              │   │
│  │   - getDMsToCheck(30000ms) → [userIds]                    │   │
│  │   - updateDMState(userId, id, count) → boolean             │   │
│  │   - shouldCheckDM(userId, 30000ms) → boolean               │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ conversation-manager.js - ACTIVE CONVERSATION TRACKING     │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │ • Track active conversation state                           │   │
│  │ • 5-minute conversation timeout                             │   │
│  │ • Message count per conversation                            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ message-handler.js - MESSAGE PROCESSING                    │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │ • Template matching                                         │   │
│  │ • Sexual content detection                                  │   │
│  │ • OnlyFans link appending                                   │   │
│  │ • Response generation                                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Message Detection Flow

```
                    POLLING CYCLE STARTS (Every 60 seconds)
                                  │
                                  ↓
                     Is it 60+ seconds since last check?
                                  │
                    ┌─────────────┴──────────────┐
                   NO                           YES
                    │                            │
              Exit & wait                        ↓
                    │            Are we in a conversation?
                    │                   │
                    │         ┌─────────┴──────────┐
                    │        YES                  NO
                    │         │                    │
                    │         ↓                    ↓
                    │    Check only          Get list of DMs
                    │    this user's DM      needing re-check
                    │         │              using cache
                    │         │                    │
                    │         └────────┬───────────┘
                    │                  ↓
                    │         For each DM to check:
                    │                  │
                    │                  ↓
                    │         1. Open DM conversation
                    │                  │
                    │                  ↓
                    │         2. Wait 500ms for load
                    │                  │
                    │         ↓──────────┐
                    │         │          │
         ┌──────────┴─────────┴──────────┘
         │
         ↓
    Extract message ID using multi-strategy approach:
    │
    ├─ Try: data-message-id attribute → Found? USE IT
    ├─ Try: data-id attribute → Found? USE IT
    ├─ Try: element id → Found? USE IT
    └─ Fallback: timestamp + content hash → ALWAYS WORKS
         │
         ↓
    Message ID obtained (never null)
         │
         ↓
    Count messages: [role="article"] count
         │
         ↓
    dmCacheManager.updateDMState(userId, messageId, count)
         │
         ├─ Compare messageId with cached lastMessageId
         ├─ If SAME → return FALSE (no new message)
         └─ If DIFFERENT → return TRUE (new message!)
                │
                ├─ TRUE: ✓ NEW MESSAGE detected!
                │         Update cache
                │         Call processDM()
                │         Break loop (process one at a time)
                │
                └─ FALSE: No new message
                          Mark as checked
                          Continue to next DM
         │
         ↓
    Return to friends list
         │
         ↓
    Wait 60 seconds, then REPEAT
```

---

## Cache State Transitions

```
                            CACHE STATES
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ↓                        ↓                        ↓
    UNINITIALIZED           INITIALIZED              UPDATED
    (DM not in cache)       (DM has state)           (State changed)
        │                        │                        │
        └────────────────────────┼────────────────────────┘
                                 │
                                 ↓
                    First poll for this DM
                                 │
                    ┌────────────┴────────────┐
                    │                        │
                    ↓                        ↓
            Extract message ID         (No re-check yet
            Count messages             within 30s min)
            Add to cache               │
            Return TRUE                ↓
            (Process DM)          Message ID same?
                    │                  │
                    │         ┌────────┴────────┐
                    │         │                 │
                    │        YES               NO
                    │         │                 │
                    │         ↓                 ↓
                    │    Return FALSE      Return TRUE
                    │    (No new message)  (New message!)
                    │         │                 │
                    └─────────┬─────────────────┘
                              │
                              ↓
                    Update lastCheckTime
                    Save cache to disk
                              │
                              ↓
                    Wait 30+ seconds
                    before re-checking
```

---

## Data Flow: From Detection to Reply

```
                    FULL REQUEST-REPLY CYCLE

1. DETECTION PHASE (happens every 60 seconds)
   ┌─────────────────────────────────────────┐
   │ Poll: Check which DMs need re-checking  │
   │ Cache: getDMsToCheck(30000) returns []  │
   │ Open: First DM from list                │
   │ Extract: getLatestMessageId()           │
   │ Compare: updateDMState() → TRUE         │
   └─────────────────────────────────────────┘
                       ↓

2. MESSAGE RETRIEVAL PHASE
   ┌─────────────────────────────────────────┐
   │ getMessages() → [{author, content}]     │
   │ Find latest user message (not "You")    │
   │ Extract: message text, author           │
   └─────────────────────────────────────────┘
                       ↓

3. PROCESSING PHASE
   ┌─────────────────────────────────────────┐
   │ messageHandler.processMessage(text)     │
   │ • Template matching                     │
   │ • Sexual content detection              │
   │ • Replace placeholders                  │
   │ → Generate response text                │
   └─────────────────────────────────────────┘
                       ↓

4. SENDING PHASE
   ┌─────────────────────────────────────────┐
   │ browser.sendMessage(responseText)       │
   │ → Message sent successfully ✓           │
   └─────────────────────────────────────────┘
                       ↓

5. STATE UPDATE PHASE
   ┌─────────────────────────────────────────┐
   │ conversationManager.startConversation() │
   │ • Set inConversationWith: userId        │
   │ • startTime: now                        │
   │ • messageCount: 1                       │
   │ • ofLinkSent: false                     │
   │ • Save to conversations.json            │
   └─────────────────────────────────────────┘
                       ↓

6. WAIT PHASE (5 minutes)
   ┌─────────────────────────────────────────┐
   │ Next 300 seconds of polling:            │
   │ • Check only this user's DM             │
   │ • Don't check other DMs                 │
   │ • Wait for follow-up message            │
   └─────────────────────────────────────────┘
                       ↓

7. TIMEOUT PHASE
   ┌─────────────────────────────────────────┐
   │ After 5 minutes:                        │
   │ • Clear inConversationWith              │
   │ • Resume normal multi-DM polling        │
   │ • Ready for new conversations           │
   └─────────────────────────────────────────┘
```

---

## Cache Persistence Model

```
         RUNTIME (In-Memory)           PERSISTENT (Disk)
               │                              │
         ┌─────┴──────────┐            ┌─────┴──────────┐
         │                │            │                │
         ↓                ↓            ↓                ↓
      Map Object      DMCacheManager   JSON File      Automatic Sync
    userId → state    (controller)    dm-cache.json   On each update
         │                │            │                │
         │ loadCache()    │            │                │
         ├────────────────→│────────────┤                │
         │                │            │                │
         │           updateDMState()   │                │
         │                ├─ Compare ID │                │
         │                ├─ Update Map │                │
         │                └─ Save to disk──────────────→│
         │                            │                │
         └──────────────────────────────┘              │
                   ↓                                    ↓
              BOT RESTART                    Cache persists!
         Load from disk, continue
```

---

## Performance Comparison

```
OLD APPROACH (Broken)
─────────────────────────────────────────────────────
Polling:  Every 5 seconds        12 times/minute
          × N DMs               × 3 DMs = 36 operations/min
          × 60 minutes          = 2,160 operations/hour
          
Behavior: Check EVERY DM EVERY cycle
          Look for red badge
          Sidebar collapses
          Discord detects pattern
          
Result:   ❌ Fails ❌

NEW APPROACH (Fixed)
─────────────────────────────────────────────────────
Polling:  Every 60 seconds        1 time/minute
          Cache filters         Avg 0.5 DMs/check
          Min 30s recheck      = 0.5-1 operations/min
                               = 30-60 operations/hour
          
Behavior: Selective checking
          Message ID comparison
          Sidebar stays visible
          Human-like pattern
          
Result:   ✅ Works ✅

Improvement: 97% fewer operations (2160 → 60)
```

---

## Integration Points Summary

```
┌─ bot.js ──────────────────────────────────────────────────────────┐
│                                                                    │
│  constructor()                                                    │
│  ├─ Import DMCacheManager from './src/dm-cache-manager.js'       │
│  └─ this.dmCacheManager = new DMCacheManager()                   │
│                                                                   │
│  this.dmCheckInterval = 60000         ← Polling every 60 seconds│
│  this.dmCheckMinInterval = 30000      ← Re-check every 30+ sec  │
│                                                                   │
│  startDMPolling()                                                │
│  ├─ Call: dmCacheManager.getDMsToCheck()                        │
│  ├─ For each DM: checkDMForNewMessagesOptimized(userId)        │
│  └─ Call: processDM() if new message                           │
│                                                                   │
│  checkDMForNewMessagesOptimized(userId)                         │
│  ├─ Call: browser.getLatestMessageId()                         │
│  ├─ Call: browser.getMessageCount()                            │
│  └─ Call: dmCacheManager.updateDMState()                       │
│                                                                   │
└────────────────────────────────────────────────────────────────────┘

┌─ browser-controller.js ────────────────────────────────────────────┐
│                                                                    │
│  getLatestMessageId()          ← NEW METHOD                      │
│  ├─ Try: document.querySelector('[data-message-id]')            │
│  ├─ Try: document.querySelector('[data-id]')                    │
│  ├─ Try: document.getElementById()                              │
│  └─ Fallback: timestamp + content hash                          │
│                                                                   │
│  getMessageCount()             ← NEW METHOD                      │
│  └─ document.querySelectorAll('[role="article"]').length        │
│                                                                   │
└────────────────────────────────────────────────────────────────────┘

┌─ dm-cache-manager.js ──────────────────────────────────────────────┐
│                                                                    │
│  export class DMCacheManager                                     │
│  ├─ this.dmCache = Map() [userId → state]                      │
│  ├─ Persistent file: data/dm-cache.json                         │
│  │                                                              │
│  ├─ getDMsToCheck(minInterval) → [userIds]                    │
│  ├─ updateDMState(userId, messageId, count) → boolean         │
│  ├─ shouldCheckDM(userId, minInterval) → boolean              │
│  ├─ loadCache() / saveCache()                                 │
│  └─ Other methods for cache management                         │
│                                                                   │
└────────────────────────────────────────────────────────────────────┘
```

---

## Execution Timeline

```
T=0ms      Bot starts
           ├─ Initialize browser
           ├─ Create DMCacheManager
           └─ Start polling interval

T=30s      First health check
           └─ Log status

T=60s      FIRST POLLING CYCLE
           ├─ getDMsToCheck() → get ALL uncached DMs
           ├─ Open each DM
           ├─ Extract message ID
           ├─ Add to cache (first check = new)
           ├─ Process message (reply)
           └─ Enter 5-min conversation wait

T=90s      SECOND POLLING CYCLE
           ├─ Conversation locked (still waiting)
           ├─ Check only locked user's DM
           └─ Skip other DMs

T=120s     THIRD POLLING CYCLE
           ├─ Still in conversation
           └─ Check locked user

...

T=300s     FOURTH POLLING CYCLE (5 minutes passed)
           ├─ Unlock conversation
           ├─ getDMsToCheck() → check others (been 240s)
           ├─ Check first DM again (message ID same? no new)
           ├─ Check second DM (new message!)
           ├─ Process second DM
           └─ Enter conversation wait for second user

T=360s     FIFTH POLLING CYCLE
           ├─ Locked to second user now
           └─ Repeat cycle

...
```

---

## Files Organization

```
DC Bot/
├── bot.js                          MAIN ORCHESTRATOR
│   ├─ Imports DMCacheManager ✓
│   ├─ Creates dmCacheManager instance ✓
│   ├─ Sets dmCheckInterval = 60000 ✓
│   ├─ Sets dmCheckMinInterval = 30000 ✓
│   ├─ Rewrote startDMPolling() ✓
│   └─ Added checkDMForNewMessagesOptimized() ✓
│
├── src/
│   ├── browser-controller.js       PUPPETEER INTERFACE
│   │   ├─ Added getLatestMessageId() ✓
│   │   └─ Added getMessageCount() ✓
│   │
│   ├── dm-cache-manager.js         STATE TRACKING (NEW ✓)
│   │   ├─ DMCacheManager class
│   │   ├─ In-memory Map
│   │   └─ JSON persistence
│   │
│   ├── conversation-manager.js     CONVERSATION STATE
│   │   └─ (Unchanged - already working)
│   │
│   └── message-handler.js          MESSAGE PROCESSING
│       └─ (Unchanged - already working)
│
├── data/
│   ├── conversations.json          Conversation history
│   └── dm-cache.json               DM cache (created by system)
│
├── .env                            Credentials
│
└── [Documentation]
    ├── IMPLEMENTATION_SUMMARY.md        What was built
    ├── VALIDATION_CHECKLIST.md         Verification checklist
    ├── TESTING_GUIDE.md                Test procedures
    ├── README_IMPLEMENTATION.md        Overview & instructions
    └── ARCHITECTURE_FLOWCHART.md       This file
```

---

**System is ready for deployment and testing!**
