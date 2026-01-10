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
    this.dmCheckInterval = parseInt(process.env.CHECK_DMS_INTERVAL) || 60000; // Changed: 60 seconds instead of 5
    this.lastChecked = 0;
    this.dmPollingInterval = null;
    this.healthCheckInterval = null;
    this.loginAttempts = 0;
    this.maxLoginAttempts = 3;
    this.inConversationWith = null; // Track which user we're currently waiting for follow-ups from
    this.lastPage = 'friends'; // Track current page to avoid unnecessary navigation
    this.dmCheckMinInterval = 30000; // Only re-check a DM every 30 seconds at minimum
  }

  /**
   * Start the bot with login and polling
   */
  async start() {
    try {
      console.clear();
      console.log('');
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
      this.loginAttempts++;

      if (this.loginAttempts < this.maxLoginAttempts) {
        logger.info(
          `Retrying login (${this.loginAttempts}/${this.maxLoginAttempts})...`
        );
        await new Promise((r) => setTimeout(r, 5000));
        return this.start();
      }

      process.exit(1);
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
          const dm = { userId: this.inConversationWith };
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

      // Open the DM
      const opened = await this.browser.openDM(userId);
      if (!opened) {
        return false;
      }

      // Get messages
      const messages = await this.browser.getMessages();
      if (messages.length === 0) {
        return false;
      }

      // Get latest USER message (not from us)
      const latestUserMessage = messages
        .reverse()
        .find(msg => msg.author !== 'You' && msg.author.toLowerCase() !== 'unknown');

      if (!latestUserMessage) {
        return false;
      }

      // Check if we already replied to this exact message
      if (this.conversationManager.getLastMessageId(userId) === latestUserMessage.content) {
        // Already replied to this message
        return false;
      }

      // New message found!
      logger.info(`New message found from ${username}: "${latestUserMessage.content}"`);
      return true;

    } catch (error) {
      logger.warn(`Error checking DM from ${dm.username || 'user'}: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if a DM has new messages from the user that we haven't replied to
   */
  async checkDMForNewMessages(dm) {
    try {
      const { userId, username } = dm;

      // Open the DM
      const opened = await this.browser.openDM(userId);
      if (!opened) {
        return false;
      }

      // Get messages
      const messages = await this.browser.getMessages();
      if (messages.length === 0) {
        return false;
      }

      // Get latest USER message (not from us)
      // Filter out: "You" (Discord's label), "unknown", and bot's own username
      const botUsername = this.browser.botUsername || 'You';
      const latestUserMessage = messages
        .reverse()
        .find(msg => 
          msg.author !== 'You' && 
          msg.author.toLowerCase() !== 'unknown' &&
          msg.author.toLowerCase() !== botUsername.toLowerCase()
        );

      if (!latestUserMessage) {
        return false;
      }

      // Check if we already replied to this exact message
      if (this.conversationManager.getLastMessageId(userId) === latestUserMessage.content) {
        // Already replied to this message
        return false;
      }

      // New message found!
      logger.info(`New message found from ${username}: "${latestUserMessage.content}"`);
      return true;

    } catch (error) {
      logger.warn(`Error checking DM from ${dm.username || 'user'}: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if a DM has new messages - simple version
   */
  async checkDMForNewMessagesOptimized(userId) {
    try {
      // Open the DM
      const opened = await this.browser.openDM(userId);
      if (!opened) {
        logger.warn(`Could not open DM with user ${userId}`);
        return false;
      }

      // Get messages from the DM
      const messages = await this.browser.getMessages();
      if (messages.length === 0) {
        return false;
      }

      // Find latest message from the user (not from us)
      // Filter out: "You" (Discord's label), "unknown", and bot's own username
      const botUsername = this.browser.botUsername || 'You';
      const latestUserMessage = messages
        .reverse()
        .find(msg => 
          msg.author !== 'You' && 
          msg.author.toLowerCase() !== 'unknown' &&
          msg.author.toLowerCase() !== botUsername.toLowerCase()
        );

      if (!latestUserMessage) {
        return false;
      }

      // Simple cache check: have we already replied to this?
      const lastSeenId = this.conversationManager.getLastMessageId(userId);
      
      // If this is a new message (content is different), it's new
      if (lastSeenId !== latestUserMessage.content) {
        logger.info(`✓ NEW MESSAGE from ${userId}: "${latestUserMessage.content.substring(0, 50)}..."`);
        return true;
      }

      return false;

    } catch (error) {
      logger.warn(`Error checking DM ${userId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Process an unread DM
   */
  async processDM(dm) {
    try {
      const { userId, username } = dm;

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

      // Get messages
      const messages = await this.browser.getMessages();
      if (messages.length === 0) {
        this.inConversationWith = null;
        return;
      }

      // Get latest USER message (not our own)
      // Filter out: "You" (Discord's label), "unknown", and bot's own username
      const botUsername = this.browser.botUsername || 'You';
      const latestUserMessage = messages
        .reverse()
        .find(msg => 
          msg.author !== 'You' && 
          msg.author.toLowerCase() !== 'unknown' &&
          msg.author.toLowerCase() !== botUsername.toLowerCase()
        );

      if (!latestUserMessage) {
        logger.debug('No user messages found');
        this.inConversationWith = null;
        return;
      }

      // Check if we already replied to this exact message in this conversation
      // If so, wait 5 minutes before replying to next message
      if (this.conversationManager.getLastMessageId(userId) === latestUserMessage.content) {
        logger.info(`Already replied to this message from ${username}, waiting for new message...`);
        return; // Don't clear inConversationWith yet - we're still waiting
      }

      logger.info(`User said: "${latestUserMessage.content}"`);

      // Handle the message
      const response = await this.messageHandler.handleDM(
        userId,
        latestUserMessage.content
      );

      let messageSent = false;
      if (response) {
        // Send response
        const sent = await this.browser.sendMessage(response.message);

        if (sent) {
          logger.info(
            `Response sent to ${username} (source: ${response.source}, hasOFLink: ${response.hasOFLink})`
          );
          
          // Track that we replied to this message (prevent double-replies)
          this.conversationManager.setLastMessageId(userId, latestUserMessage.content);
          messageSent = true;
        } else {
          logger.warn(`Failed to send response to ${username}`);
        }
      } else {
        logger.info(`No response generated for ${username}`);
      }

      // Wait 5 minutes in this conversation for follow-up messages
      if (messageSent) {
        logger.info(`Waiting 5 minutes in conversation with ${username}...`);
        await new Promise(r => setTimeout(r, 5 * 60 * 1000));

        // Return to friends list
        logger.info('Returning to friends list...');
        this.inConversationWith = null; // Clear flag when done waiting
        this.lastPage = 'dm'; // Will return to friends on next poll
        await this.browser.navigateToFriendsList();
        this.lastPage = 'friends';
      }

    } catch (error) {
      logger.error(`Error processing DM: ${error.message}`);
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
