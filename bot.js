import dotenv from 'dotenv';
import { BrowserController } from './src/browser-controller.js';
import { MessageHandler } from './src/message-handler.js';
import { ConversationManager } from './src/conversation-manager.js';
import { DMCacheManager } from './src/dm-cache-manager.js';
import { logger } from './src/logger.js';
import fs from 'fs';
import path from 'path';

dotenv.config();

/**
 * Main Bot - Simplified Discord OnlyFans Bot v2.0
 * Cost-optimized: Templates first, AI only when needed
 * 
 * Bot Behavior:
 * 1. Logs into Discord (waits 120s for user to complete captcha/2FA)
 * 2. Sits idle on friends list, checking for unread messages (every 60 seconds)
 * 3. Opens DM when new message detected (uses cache to avoid checking all DMs)
 * 4. Replies ONCE per message per conversation
 * 5. Stays in conversation for up to 5 minutes (small talk)
 * 6. Sends OF link after sufficient interaction
 * 7. Closes conversation after link sent
 */
class DiscordOFBot {
  constructor() {
    this.browser = new BrowserController();
    this.conversationManager = new ConversationManager();
    this.dmCacheManager = new DMCacheManager(); // NEW: Cache DM states
    this.messageHandler = new MessageHandler(this.conversationManager);
    this.isRunning = false;
    this.dmCheckInterval = 60000; // Default, will be overridden in start()
    this.lastChecked = 0;
    this.dmPollingInterval = null;
    this.healthCheckInterval = null;
    this.loginAttempts = 0;
    this.maxLoginAttempts = 3;
    this.inConversationWith = null; // Track which user we're currently waiting for follow-ups from
    this.lastPage = 'friends'; // Track current page to avoid unnecessary navigation
    this.dmCheckMinInterval = 30000; // Only re-check a DM every 30 seconds at minimum
    this.lastResponseTime = new Map(); // Track when we last responded to each user for cooldown
    this.responseCooldown = 3500; // Minimum 3.5 seconds between responses to same user
    this.testAccounts = ['kuangg']; // Test accounts - conversation resets on new greeting
    this.responsePending = {}; // Track which users have responses being sent
    this.closedConversations = new Set(); // Users with OF link sent - STOP responding
    this.hasRepliedOnce = new Map(); // Track which users have received their first bot reply (enables conversation mode)
  }

  /**
   * Start the bot with login and polling
   */
  async start() {
    try {
      console.clear();
      console.log('');
      
      // Initialize dmCheckInterval from .env AFTER dotenv.config()
      if (process.env.CHECK_DMS_INTERVAL) {
        const parsed = parseInt(process.env.CHECK_DMS_INTERVAL);
        if (!isNaN(parsed)) {
          this.dmCheckInterval = parsed;
        }
      }
      
      logger.info('========================================');
      logger.info('   Discord OnlyFans Bot v2.0');
      logger.info('   Starting Initialization Sequence');
      logger.info('========================================');
      logger.info('');

      // Validate environment
      if (!process.env.DISCORD_EMAIL || !process.env.DISCORD_PASSWORD) {
        throw new Error('Missing DISCORD_EMAIL or DISCORD_PASSWORD in .env');
      }

      if (!process.env.OF_LINK) {
        throw new Error('Missing OF_LINK in .env');
      }

      if (!process.env.GEMINI_API_KEY_1) {
        logger.warn('Warning: No Gemini API key found - AI fallback will be limited');
      }

      logger.info('CONFIGURATION:');
      logger.info(`   Email: ${process.env.DISCORD_EMAIL}`);
      logger.info(`   OF Link: ${process.env.OF_LINK}`);
      logger.info(`   Check Every: ${this.dmCheckInterval}ms`);
      logger.info('');

      // Step 1: Launch browser
      logger.info('[1/5] Launching browser...');
      const launched = await this.browser.launch();
      if (!launched) {
        throw new Error('Failed to launch browser');
      }
      logger.info('      [OK] Browser launched');
      logger.info('');

      // Step 2: Login (with 120-second auth/captcha wait)
      logger.info('[2/5] Logging into Discord...');
      logger.info('      IMPORTANT: You have 120 seconds to:');
      logger.info('         1. Enter your email/password if prompted');
      logger.info('         2. Complete any captcha');
      logger.info('         3. Complete 2FA if enabled');
      logger.info('');
      const loginSuccess = await this.browser.login(
        process.env.DISCORD_EMAIL,
        process.env.DISCORD_PASSWORD
      );
      if (!loginSuccess) {
        throw new Error('Login failed - check credentials or complete captcha/2FA');
      }
      logger.info('      [OK] Successfully logged in');
      logger.info('');

      // Step 3: Navigate to friends list
      logger.info('[3/5] Navigating to friends list...');
      const navSuccess = await this.browser.navigateToFriendsList();
      if (!navSuccess) {
        throw new Error('Failed to navigate to friends list');
      }
      logger.info('      [OK] Friends list loaded');
      logger.info('');

      this.isRunning = true;

      // Step 4: Health monitoring (only check if browser is alive, don't auto-restart)
      logger.info('[4/5] Starting health monitoring...');
      this.startHealthCheck();
      logger.info('      [OK] Health checks active');
      logger.info('');

      // Step 5: Start DM polling loop
      logger.info('[5/5] Starting message polling...');
      this.startDMPolling();
      logger.info('      [OK] Message polling active');
      logger.info('');

      logger.info('========================================');
      logger.info('   [OK] BOT STARTED SUCCESSFULLY');
      logger.info('========================================');
      logger.info('');
      logger.info('STATUS: IDLE');
      logger.info('Monitoring Discord for new messages...');
      logger.info('');
      logger.info('WHAT THE BOT DOES:');
      logger.info('   1. Detects incoming DMs in Discord');
      logger.info('   2. Replies ONCE per conversation (no duplicates)');
      logger.info('   3. Keeps conversation open for 5 minutes');
      logger.info('   4. Sends OnlyFans link after engagement');
      logger.info('   5. Auto-recovers from browser crashes');
      logger.info('');
      logger.info('To stop the bot, press Ctrl+C');
      logger.info('');

      // Graceful shutdown
      process.on('SIGINT', () => this.stop());
      process.on('SIGTERM', () => this.stop());
    } catch (error) {
      logger.error('Failed to start bot: ' + error.message);
      console.log('');
      console.log('ERROR DETAILS:');
      console.log(error.stack);
      console.log('');
      logger.info('Browser will remain open. Fix the issue and reload Discord manually.');
      logger.info('To exit, press Ctrl+C');
      
      // Don't retry or exit - just keep the browser open indefinitely
      // User can fix the issue manually and reload
      return;
    }
  }

  /**
   * Health check - detects browser crashes (logs only, no auto-restart loop)
   */
  startHealthCheck() {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const isHealthy = await this.browser.healthCheck();
        if (!isHealthy && this.isRunning) {
          logger.error('Health check failed - browser may have crashed');
          logger.info('Attempting recovery...');
          // Only recover once, don't loop
          this.isRunning = false;
          await this.recoverFromCrash();
        }
      } catch (error) {
        logger.error('Health check error: ' + error.message);
      }
    }, 30000); // Check every 30 seconds

    logger.info('[OK] Health check started (every 30 seconds)');
  }

  /**
   * Recover from browser crash
   */
  async recoverFromCrash() {
    try {
      logger.info('Attempting recovery...');

      // Stop current polling
      if (this.dmPollingInterval) {
        clearInterval(this.dmPollingInterval);
        this.dmPollingInterval = null;
      }

      // Close old browser
      await this.browser.close();

      // Wait before restart
      await new Promise((r) => setTimeout(r, 3000));

      // Restart the bot
      logger.info('Restarting bot after crash...');
      this.loginAttempts = 0;
      await this.start();
    } catch (error) {
      logger.error('Recovery failed: ' + error.message);
      process.exit(1);
    }
  }

  /**
   * DM polling loop - checks for unread messages
   */
  startDMPolling() {
    this.dmPollingInterval = setInterval(async () => {
      try {
        if (!this.isRunning) {
          return;
        }

        if (Date.now() - this.lastChecked < this.dmCheckInterval) {
          return;
        }

        this.lastChecked = Date.now();

        // If currently in conversation, only check for messages from that user
        if (this.inConversationWith) {
          const dm = { userId: this.inConversationWith, username: `user_${this.inConversationWith.substring(0, 8)}` };
          const hasNewMessages = await this.checkDMForNewMessages(dm);
          
          if (hasNewMessages) {
            // New message from the user we're talking to
            await this.processDM(dm);
          }
          return; // Don't check other DMs while in conversation
        }

        // Get unread DMs
        const unreadDMs = await this.browser.getUnreadDMs();

        if (unreadDMs.length > 0) {
          logger.info(`Found ${unreadDMs.length} unread DM(s)`);

          // Process the first unread DM
          if (unreadDMs.length > 0) {
            await this.processDM(unreadDMs[0]);
          }
        } else {
          // Return to friends list if not already there
          if (this.lastPage !== 'friends') {
            await this.browser.navigateToFriendsList();
            this.lastPage = 'friends';
          }
        }
      } catch (error) {
        logger.error('DM polling error: ' + error.message);
      }
    }, this.dmCheckInterval);

    logger.info(`DM polling started (checking every ${this.dmCheckInterval}ms)`);
  }

  /**
   * Check if a DM has new messages from the user that we haven't replied to
   */
  async checkDMForNewMessages(dm) {
    try {
      const { userId, username } = dm;

      // Skip if response is already pending for this user (prevents re-processing same message)
      if (this.responsePending[userId]) {
        logger.debug(`Response pending for ${username}, skipping check`);
        return false;
      }

      // Open the DM
      const opened = await this.browser.openDM(userId);
      if (!opened) {
        return false;
      }

      // Get messages (with retry for startup unread messages)
      const messages = await this.browser.getMessagesWithRetry();
      if (messages.length === 0) {
        return false;
      }

      // Get latest USER message (not from us)
      // Filter out: "You" (Discord's label), "unknown", bot username, and invalid authors (timestamps)
      const botUsername = this.browser.botUsername || 'You';
      const latestUserMessage = messages
        .reverse()
        .find(msg => {
          const author = msg.author || '';
          
          // Skip invalid authors
          if (!author || author === 'You' || author.toLowerCase() === 'unknown') {
            return false;
          }
          
          // Skip bot's own messages
          if (author.toLowerCase() === botUsername.toLowerCase()) {
            return false;
          }
          
          // Skip timestamps in bracket format [HH:MM]
          if (/^\[\d{1,2}:\d{2}\]$/.test(author)) {
            return false;
          }
          
          // Skip if author is just numbers and time separators
          if (/^[\d:\[\]—\.\s]+$/.test(author)) {
            return false;
          }
          
          return true;
        });

      if (!latestUserMessage) {
        return false;
      }

      // Clean message text for consistent deduplication comparison
      let cleanContent = latestUserMessage.content;
      cleanContent = cleanContent.replace(/^\[\d{1,2}:\d{2}\]\s*/, '');
      cleanContent = cleanContent.replace(/^\d{1,2}:\d{2}\s*/, '');
      cleanContent = cleanContent.replace(/.*?—\s*/, '');
      cleanContent = cleanContent.replace(/^(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)[,\.]?\s+\d{1,2}\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)[,\.]?\s+\d{4}\s+г\.\s+в\s+\d{1,2}:\d{2}\s*/, '');
      cleanContent = cleanContent.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[,\.]?\s+\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)[,\.]?\s+\d{4}\s+at\s+\d{1,2}:\d{2}\s*/, '');
      cleanContent = cleanContent.trim();

      // Check if we already replied to this exact message (using cleaned content)
      if (this.conversationManager.getLastMessageId(userId) === cleanContent) {
        // Already replied to this message
        logger.debug(`Deduplication check passed: lastMessageId matches cleaned content`);
        return false;
      }

      // New message found!
      logger.info(`New message found from ${username}: "${cleanContent}"`);
      return true;

    } catch (error) {
      logger.warn(`Error checking DM from ${dm.username || 'user'}: ${error.message}`);
      return false;
    }
  }

  /**
   * Process an unread DM
   */
  async processDM(dm) {
    try {
      let { userId, username } = dm;

      // STOP PROCESSING: If OF link already sent to this user, skip
      if (this.closedConversations.has(userId)) {
        logger.debug(`Skipping ${userId} - OF link already sent, conversation closed`);
        return;
      }

      // If username missing (happens when continuing conversation), extract from latest message
      if (!username && userId) {
        const messages = await this.browser.getMessagesWithRetry();
        if (messages.length > 0) {
          const userMsg = messages.find(m => m.author && m.author !== this.browser.botUsername && m.author !== 'You');
          username = userMsg?.author || `user_${userId.substring(0, 8)}`;
        }
      }

      logger.info(`Processing DM from ${username}`);

      // Mark that we're in conversation with this user
      this.inConversationWith = userId;

      // Start conversation if new
      if (!this.conversationManager.isConversationActive(userId)) {
        this.conversationManager.startConversation(userId);
        logger.info(`New conversation started with ${username}`);
      }

      // Open the DM
      const opened = await this.browser.openDM(userId);
      if (!opened) {
        logger.warn(`Could not open DM with ${username}`);
        this.inConversationWith = null;
        return;
      }

      // Get messages (with retry for startup unread messages)
      const messages = await this.browser.getMessagesWithRetry();
      if (messages.length === 0) {
        logger.warn(`No messages found in DM with ${username}`);
        this.inConversationWith = null;
        return;
      }

      logger.debug(`Found ${messages.length} message(s): ${JSON.stringify(messages)}`);

      // Get latest USER message (not our own)
      // Filter out: "You" (Discord's label), "unknown", bot username, and invalid authors (timestamps, etc)
      const botUsername = this.browser.botUsername || 'You';
      logger.debug(`Bot username: ${botUsername}`);
      
      const latestUserMessage = messages
        .reverse()
        .find(msg => {
          const author = msg.author || '';
          
          // Skip invalid authors
          if (!author || author === 'You' || author.toLowerCase() === 'unknown') {
            return false;
          }
          
          // Skip bot's own messages
          if (author.toLowerCase() === botUsername.toLowerCase()) {
            return false;
          }
          
          // Skip timestamps in bracket format [HH:MM]
          if (/^\[\d{1,2}:\d{2}\]$/.test(author)) {
            return false;
          }
          
          // Skip if author is just numbers and time separators
          if (/^[\d:\[\]—\.\s]+$/.test(author)) {
            return false;
          }
          
          // Skip day-of-week words (Russian/English, with optional punctuation like comma)
          if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)[,\.]?$/i.test(author)) {
            return false;
          }
          
          return true;
        });

      if (!latestUserMessage) {
        logger.debug('No user messages found (all filtered as bot or unknown)');
        this.inConversationWith = null;
        return;
      }

      // Extract clean message text without timestamps for deduplication
      // Discord messages include various formats with timestamps and dates
      // We need to extract just the actual message text
      let cleanMessageText = latestUserMessage.content;
      
      // Remove [HH:MM] format timestamps at start
      cleanMessageText = cleanMessageText.replace(/^\[\d{1,2}:\d{2}\]\s*/, '');
      
      // Remove HH:MM format timestamps at start
      cleanMessageText = cleanMessageText.replace(/^\d{1,2}:\d{2}\s*/, '');
      
      // Remove em-dash separators and everything before them
      cleanMessageText = cleanMessageText.replace(/.*?—\s*/, '');
      
      // Remove Russian date/time patterns like "пятница, 16 января 2026 г. в 00:36"
      cleanMessageText = cleanMessageText.replace(/^(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)[,\.]?\s+\d{1,2}\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)[,\.]?\s+\d{4}\s+г\.\s+в\s+\d{1,2}:\d{2}\s*/, '');
      
      // Remove English date/time patterns
      cleanMessageText = cleanMessageText.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[,\.]?\s+\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)[,\.]?\s+\d{4}\s+at\s+\d{1,2}:\d{2}\s*/, '');
      
      // Clean up any remaining extra whitespace
      cleanMessageText = cleanMessageText.trim();

      // Check if we already replied to this exact message
      const lastProcessed = this.conversationManager.getLastMessageId(userId);
      if (lastProcessed && lastProcessed === cleanMessageText) {
        logger.info(`Already replied to this message from ${username}, waiting for new message...`);
        return; // Don't clear inConversationWith yet - we're still waiting
      }

      logger.info(`User said: "${cleanMessageText}"`);
      
      // CONVERSATION MODE BEHAVIOR:
      // If hasRepliedOnce is false: This is the first message - respond with latest message only, immediately
      // If hasRepliedOnce is true: In conversation mode - can batch multiple messages, enable multi-turn logic
      const inConversationMode = this.hasRepliedOnce.has(userId) && this.hasRepliedOnce.get(userId);
      if (!inConversationMode) {
        logger.debug(`First message mode: Processing latest message only, no batching`);
      } else {
        logger.debug(`Conversation mode: Multi-turn enabled, can process follow-ups`);
      }
      
      // Use author from extracted message (more reliable than sidebar)
      const extractedUsername = latestUserMessage.author || username;
      if (!extractedUsername) {
        logger.warn('Could not determine username, skipping');
        this.inConversationWith = null;
        return;
      }

      // CRITICAL: Check if OF link was already sent to this user
      const ofLinkAlreadySent = this.conversationManager.hasOFLinkBeenSent(userId);
      const isTestAccount = this.testAccounts.includes(extractedUsername.toLowerCase());
      
      if (ofLinkAlreadySent && !isTestAccount) {
        // Regular user - conversation is DONE, don't respond
        logger.info(`OF link already sent to ${extractedUsername} (regular user) - conversation ended, not responding`);
        this.inConversationWith = null;
        return;
      }
      
      if (ofLinkAlreadySent && isTestAccount) {
        // Test account - check if this is a greeting (reset conversation if so)
        const isGreeting = /^(hey|hi|hello|yo|sup|watsup|what's up|whats up|wassup|hola|howdy|greetings)/i.test(cleanMessageText);
        if (isGreeting) {
          // Reset conversation for test account
          logger.info(`Test account ${extractedUsername} sent greeting after OF link - resetting conversation`);
          this.conversationManager.startConversation(userId);
        } else {
          // Not a greeting, treat as continuation (test account can continue after OF link)
          logger.info(`Test account ${extractedUsername} sent non-greeting after OF link - continuing conversation`);
        }
      }

      // Mark message as processed BEFORE handling to prevent race conditions
      this.conversationManager.setLastMessageId(userId, cleanMessageText);
      this.lastResponseTime.set(userId, Date.now());
      
      // Mark response as pending (prevents re-processing during wait-to-send period)
      this.responsePending[userId] = true;

      // Handle the message (generates exactly 1 response)
      const response = await this.messageHandler.handleDM(
        userId,
        latestUserMessage.content
      );

      let messageSent = false;
      
      // Check if conversation was ended (e.g., link detected)
      if (response === null) {
        logger.info(`🔗 Conversation ended: User engagement detected (link in message)`);
        this.inConversationWith = null;
        this.responsePending[userId] = false;
        // Don't navigate away, just release conversation lock
      } else if (response) {
        // Send exactly ONE response per user message
        const sent = await this.browser.sendMessage(response.message);

        if (sent) {
          logger.info(
            `✅ Response sent to ${extractedUsername} (source: ${response.source}, hasOFLink: ${response.hasOFLink})`
          );
          
          // CRITICAL: Mark this user as having received their first reply
          // This enables conversation mode (batching, multiple messages, etc.)
          if (!this.hasRepliedOnce.has(userId)) {
            this.hasRepliedOnce.set(userId, true);
            logger.info(`📝 First reply sent to ${extractedUsername} - conversation mode ENABLED`);
          }
          
          // CRITICAL: Mark OF link as sent if this response includes it
          if (response.hasOFLink) {
            this.conversationManager.markOFLinkSent(userId);
            this.closedConversations.add(userId); // CHEAP FIX: Stop processing this user entirely
            if (!isTestAccount) {
              logger.info(`🔗 OF link sent to regular user ${extractedUsername} - conversation closed`);
            } else {
              logger.info(`🔗 OF link sent to test account ${extractedUsername} - conversation can continue on greeting`);
            }
          }
          
          messageSent = true;
        } else {
          logger.warn(`Failed to send response to ${extractedUsername}`);
        }
      } else {
        logger.info(`No response generated for ${username}`);
      }

      // Clear pending flag after message is sent (or generation failed)
      this.responsePending[userId] = false;

      // Keep conversation open for potential follow-ups or signup confirmation
      if (messageSent) {
        logger.info(`Conversation open with ${extractedUsername} - waiting for follow-ups...`);
        // Keep conversation locked - don't release immediately
        // This prevents the same message from being processed multiple times
        // Lock will be released when: user sends new message, or timeout occurs
        // this.inConversationWith remains set
        // But conversation stays active for future messages
      }

    } catch (error) {
      logger.error(`Error processing DM: ${error.message}`);
      this.responsePending[userId] = false;
      this.inConversationWith = null;
    }
  }

  /**
   * Stop the bot gracefully
   */
  async stop() {
    logger.info('🛑 Stopping bot...');
    this.isRunning = false;

    // Clear intervals
    if (this.dmPollingInterval) {
      clearInterval(this.dmPollingInterval);
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Close browser
    this.browser.stopHealthCheck();
    await this.browser.close();

    logger.info('✅ Bot stopped');
    process.exit(0);
  }
}

// Start bot
console.log('');
console.log('Bot.js starting...');
console.log('');

const bot = new DiscordOFBot();
bot.start().catch((error) => {
  logger.error('Fatal error: ' + error.message);
  process.exit(1);
});
