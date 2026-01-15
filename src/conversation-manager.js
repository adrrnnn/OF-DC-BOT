import fs from 'fs';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');
const stateFile = path.join(dataDir, 'conversations.json');

// Ensure data directory
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * Simple Conversation Manager
 * Tracks: active conversations, last message replied to, OF link sent
 */
export class ConversationManager {
  constructor() {
    this.conversations = new Map();
    this.loadState();
  }

  loadState() {
    if (fs.existsSync(stateFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        this.conversations = new Map(Object.entries(data));
      } catch (e) {
        // Start fresh
      }
    }
  }

  saveState() {
    try {
      const data = Object.fromEntries(this.conversations);
      fs.writeFileSync(stateFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      // Ignore
    }
  }

  startConversation(userId) {
    this.conversations.set(userId, {
      startTime: Date.now(),
      lastMessageId: null,
      messageCount: 0,
      ofLinkSent: false
    });
    this.saveState();
  }

  isConversationActive(userId) {
    const conv = this.conversations.get(userId);
    if (!conv) return false;
    
    // Conversation stays active for 15 seconds, then moves to next in queue
    const fifteenSeconds = 15 * 1000;
    if (Date.now() - conv.startTime > fifteenSeconds) {
      this.endConversation(userId);
      return false;
    }
    return true;
  }

  // Track which message we last replied to (prevent double replies)
  setLastMessageId(userId, messageId) {
    const conv = this.conversations.get(userId);
    if (conv) {
      conv.lastMessageId = messageId;
      conv.messageCount++;
      this.saveState();
    }
  }

  getLastMessageId(userId) {
    const conv = this.conversations.get(userId);
    return conv ? conv.lastMessageId : null;
  }

  markOFLinkSent(userId) {
    const conv = this.conversations.get(userId);
    if (conv) {
      conv.ofLinkSent = true;
      this.saveState();
    }
  }

  hasOFLinkBeenSent(userId) {
    const conv = this.conversations.get(userId);
    return conv ? conv.ofLinkSent : false;
  }

  getConversationState(userId) {
    const conv = this.conversations.get(userId);
    
    if (!conv) {
      return null;
    }
    
    // If conversation has been idle for more than 10 minutes, treat it as new
    const tenMinutes = 10 * 60 * 1000;
    const timeSinceStart = Date.now() - conv.startTime;
    
    if (timeSinceStart > tenMinutes) {
      // Reset the conversation
      this.conversations.set(userId, {
        startTime: Date.now(),
        lastMessageId: null,
        messageCount: 0,
        ofLinkSent: false
      });
      this.saveState();
      return this.getConversationState(userId);
    }
    
    return {
      messageCount: conv.messageCount,
      hasOFLink: conv.ofLinkSent,
      startTime: conv.startTime,
      lastMessageId: conv.lastMessageId
    };
  }

  endConversation(userId) {
    this.conversations.delete(userId);
    this.saveState();
  }

  // Reset conversation for testing (clear state but keep conversation active)
  resetConversation(userId) {
    this.conversations.set(userId, {
      startTime: Date.now(),
      lastMessageId: null,
      messageCount: 0,
      ofLinkSent: false
    });
    this.saveState();
  }
}

