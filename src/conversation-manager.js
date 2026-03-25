import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

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
    const now = Date.now();
    this.conversations.set(userId, {
      startTime: now,
      lastUserMessageTime: now,  // Track when user last sent a message
      lastMessageId: null,
      messageCount: 0,
      ofLinkSent: false
    });
    this.saveState();
  }

  /**
   * Check if conversation is still active
   * Closes after 3 minutes (180 seconds) of inactivity from the user
   */
  isConversationActive(userId) {
    const conv = this.conversations.get(userId);
    if (!conv) return false;

    // Never auto-delete the record while we're waiting post-OF or after a hard close.
    // Otherwise idle timeout would wipe ofLinkSent / permanentlyClosed and break funnel state.
    if (conv.permanentlyClosed || conv.ofLinkSent) {
      return true;
    }

    // 3 minutes idle timeout: if no messages from user for 3+ minutes, close conversation
    const threeMinutes = 3 * 60 * 1000; // 180000 ms
    const timeSinceLastUserMessage = Date.now() - (conv.lastUserMessageTime || conv.startTime);

    if (timeSinceLastUserMessage > threeMinutes) {
      this.endConversation(userId);
      return false;
    }
    return true;
  }

  /**
   * Update the last time user sent a message
   * Call this whenever a new message arrives from the user
   */
  recordUserMessage(userId) {
    const conv = this.conversations.get(userId);
    if (conv) {
      conv.lastUserMessageTime = Date.now();
      this.saveState();
    }
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
      logger.info(`\n=== STAGE 1-2: OF LINK CONFIRMED SENT ===`);
      logger.info(`📤 OF LINK SENT to ${userId}`);
      logger.info(`⚠️ Conversation status: PREPARING TO CLOSE (awaiting user response or rejection)`);
      logger.info(`🔄 Next: If user refuses → FINAL GOODBYE message sent`);
      logger.info(`🔄 Next: If user accepts/clicks → Conversation ends silently`);
      this.saveState();
    }
  }

  hasOFLinkBeenSent(userId) {
    const conv = this.conversations.get(userId);
    return conv ? conv.ofLinkSent : false;
  }

  /**
   * After the OF link was sent, empty DOM extractions (e.g. only bot messages visible)
   * temporarily skip the DM. After two such skips, permanently close so we stop looping.
   * @returns {{ closed: boolean, skipCount: number }}
   */
  recordEmptyExtractionAfterOF(userId) {
    const conv = this.conversations.get(userId);
    if (!conv || !conv.ofLinkSent || conv.permanentlyClosed) {
      return { closed: false, skipCount: conv?.emptyExtractionSkipsAfterOF || 0 };
    }
    conv.emptyExtractionSkipsAfterOF = (conv.emptyExtractionSkipsAfterOF || 0) + 1;
    logger.info(
      `📊 Post-OF empty extraction skip #${conv.emptyExtractionSkipsAfterOF} for ${userId}`
    );
    if (conv.emptyExtractionSkipsAfterOF >= 2) {
      this.markPermanentlyClosed(userId);
      this.saveState();
      return { closed: true, skipCount: conv.emptyExtractionSkipsAfterOF };
    }
    this.saveState();
    return { closed: false, skipCount: conv.emptyExtractionSkipsAfterOF };
  }

  /** Reset skip counter when we successfully read messages from the DM again. */
  resetEmptyExtractionSkipsAfterOF(userId) {
    const conv = this.conversations.get(userId);
    if (conv && conv.emptyExtractionSkipsAfterOF) {
      conv.emptyExtractionSkipsAfterOF = 0;
      this.saveState();
    }
  }

  markPermanentlyClosed(userId) {
    const conv = this.conversations.get(userId);
    if (conv) {
      conv.permanentlyClosed = true;
      logger.info(`🔒 CONVERSATION PERMANENTLY CLOSED for ${userId} - No more responses will be sent`);
      this.saveState();
    }
  }

  isPermanentlyClosed(userId) {
    const conv = this.conversations.get(userId);
    return conv ? conv.permanentlyClosed : false;
  }

  getConversationState(userId) {
    const conv = this.conversations.get(userId);
    
    if (!conv) {
      return null;
    }
    
    // If conversation has been idle for more than 10 minutes, treat it as new
    // BUT: if OF link was already sent, NEVER reset it - that user is done
    const tenMinutes = 10 * 60 * 1000;
    const timeSinceStart = Date.now() - conv.startTime;
    
    if (timeSinceStart > tenMinutes && !conv.ofLinkSent) {
      // Reset the conversation ONLY if link wasn't sent
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

