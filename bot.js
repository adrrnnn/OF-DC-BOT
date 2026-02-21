import dotenv from 'dotenv';
import { BrowserController } from './src/browser-controller.js';
import { MessageHandler } from './src/message-handler.js';
import { ConversationManager } from './src/conversation-manager.js';
import { DMCacheManager } from './src/dm-cache-manager.js';
import { ProfileLoader } from './src/profile-loader.js';
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
    // Define persistent state file location
    this.dataDir = path.join(process.cwd(), 'data');
    this.botStateFile = path.join(this.dataDir, 'bot-state.json');
    
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.browser = new BrowserController();
    this.conversationManager = new ConversationManager();
    this.dmCacheManager = new DMCacheManager(); // NEW: Cache DM states
    this.profileLoader = new ProfileLoader(); // Load active profile
    this.messageHandler = new MessageHandler(this.conversationManager, this.profileLoader.activeProfile);
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
    this.testAccounts = ['kuangg', 'noirpheus', 'rhynxprts']; // Test accounts - conversation resets on new greeting
    this.responsePending = {}; // Track which users have responses being sent
    this.closedConversations = new Set(); // Users with OF link sent - STOP responding
    this.hasRepliedOnce = new Map(); // Track which users have received their first bot reply (enables conversation mode) [PERSISTED]
    this.messageCollectionTimer = new Map(); // Track message collection timers for multi-line messages
    this.articleQueues = new Map(); // Queue of new articles accumulated during 10-second wait per user
    this.sentMessages = new Set(); // Track messages WE sent to avoid re-extracting them [PERSISTED]
    this.lastSeenArticles = new Map(); // Track last article we extracted per user to detect new ones [PERSISTED]
    this.pendingCombinedMessages = new Map(); // Store combined message waiting for processDM
    this.startupComplete = false; // Flag to prevent responding to old history on startup
    
    // Load persisted state on startup
    this.loadBotState();
  }

  /**
   * Load persistent bot state from disk
   * Restores: hasRepliedOnce, lastSeenArticles, sentMessages
   * This prevents re-processing old messages after bot restart
   */
  loadBotState() {
    try {
      if (fs.existsSync(this.botStateFile)) {
        const state = JSON.parse(fs.readFileSync(this.botStateFile, 'utf8'));
        
        if (state.hasRepliedOnce && typeof state.hasRepliedOnce === 'object') {
          this.hasRepliedOnce = new Map(Object.entries(state.hasRepliedOnce));
          logger.debug(`Loaded hasRepliedOnce for ${this.hasRepliedOnce.size} users`);
        }
        
        if (state.lastSeenArticles && typeof state.lastSeenArticles === 'object') {
          this.lastSeenArticles = new Map(Object.entries(state.lastSeenArticles));
          logger.debug(`Loaded lastSeenArticles for ${this.lastSeenArticles.size} users`);
        }
        
        if (state.sentMessages && Array.isArray(state.sentMessages)) {
          this.sentMessages = new Set(state.sentMessages);
          logger.debug(`Loaded ${this.sentMessages.size} tracked sent messages`);
        }
        
        logger.info('✅ Bot state restored from disk');
      }
    } catch (error) {
      logger.warn(`Failed to load bot state: ${error.message} - starting with fresh state`);
    }
  }

  /**
   * Save persistent bot state to disk
   * Preserves: hasRepliedOnce, lastSeenArticles, sentMessages
   * This ensures state survives bot restarts
   */
  saveBotState() {
    try {
      const state = {
        hasRepliedOnce: Object.fromEntries(this.hasRepliedOnce),
        lastSeenArticles: Object.fromEntries(this.lastSeenArticles),
        sentMessages: Array.from(this.sentMessages)
      };
      fs.writeFileSync(this.botStateFile, JSON.stringify(state, null, 2), 'utf8');
    } catch (error) {
      logger.warn(`Failed to save bot state: ${error.message}`);
    }
  }

  /**
   * Start periodic state saving (every 30 seconds)
   * Ensures bot state survives crashes and restarts
   */
  startPeriodicStateSave() {
    // Save state immediately
    this.saveBotState();
    
    // Then save every 30 seconds
    this.statesSaveInterval = setInterval(() => {
      this.saveBotState();
    }, 30000);
    
    logger.debug('Periodic state saving started (every 30 seconds)');
  }

  /**
   * Stop periodic state saving and force final save
   */
  stopPeriodicStateSave() {
    if (this.statesSaveInterval) {
      clearInterval(this.statesSaveInterval);
    }
    // Force final save on shutdown
    this.saveBotState();
    logger.debug('State saved on shutdown');
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
      if (this.profileLoader.activeProfile) {
        logger.info(`   Profile: ${this.profileLoader.activeProfile.name} (${this.profileLoader.activeProfile.age}, ${this.profileLoader.activeProfile.location})`);
      }
      logger.info('');

      // Step 1: Launch browser
      logger.info('[1/5] Launching browser...');
      const launched = await this.browser.launch();
      if (!launched) {
        throw new Error('Failed to launch browser');
      }
      // Inject bot reference into browser-controller so it can access sentMessages
      this.browser.setBot(this);
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

      // Step 5b: Start periodic state save (preserve sentMessages, hasRepliedOnce, lastSeenArticles)
      this.startPeriodicStateSave();

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

      // Mark startup as complete - now respond only to NEW messages
      this.startupComplete = false;

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
   * DM polling loop - checks for unread messages with health monitoring
   */
  startDMPolling() {
    this.messageCollectionTimer = new Map(); // Track collection timers per user
    let firstCheck = true; // Track if this is the first polling check
    let healthCheckCounter = 0; // Counter to run health checks periodically (every 10 checks)
    const HEALTH_CHECK_FREQUENCY = 10; // Run health check every 10 polling cycles
    
    this.dmPollingInterval = setInterval(async () => {
      try {
        if (!this.isRunning) {
          return;
        }

        // Periodic health check (every N polling cycles)
        healthCheckCounter++;
        if (healthCheckCounter >= HEALTH_CHECK_FREQUENCY) {
          healthCheckCounter = 0;
          const isHealthy = await this.browser.healthCheck();
          
          if (!isHealthy) {
            logger.error('[HEALTH CHECK FAILED] Browser is not responding - attempting restart');
            await this.restartBrowser();
            return; // Skip this polling cycle, next cycle will retry
          }
        }

        if (Date.now() - this.lastChecked < this.dmCheckInterval) {
          return;
        }

        this.lastChecked = Date.now();

        // If currently in conversation, check if it's still active (3 min timeout)
        if (this.inConversationWith) {
          // Check if conversation has timed out due to inactivity
          const isActive = this.conversationManager.isConversationActive(this.inConversationWith);
          
          if (!isActive) {
            logger.info(`⏱️  CONVERSATION TIMEOUT: No messages from user_${this.inConversationWith.substring(0, 8)} for 3 minutes - closing conversation and returning to friend list`);
            this.inConversationWith = null;
            // Continue to check other DMs
          } else {
            const dm = { userId: this.inConversationWith, username: `user_${this.inConversationWith.substring(0, 8)}` };
            const hasNewMessages = await this.checkDMForNewMessages(dm);
            
            if (hasNewMessages) {
              // New message from the user we're talking to
              // START COLLECTION TIMER: Wait a bit for more lines before responding
              this.startMessageCollectionTimer(dm);
            }
            return; // Don't check other DMs while in conversation
          }
        }

        // Get unread DMs
        const unreadDMs = await this.browser.getUnreadDMs();

        if (unreadDMs.length > 0) {
          logger.info(`Found ${unreadDMs.length} unread DM(s)`);

          // Check each DM to find which one has actual unread messages
          let dmWithUnread = null;
          for (const dm of unreadDMs) {
            const hasUnread = await this.browser.checkDMHasUnreadMessages(dm.userId);
            if (hasUnread) {
              dmWithUnread = dm;
              
              // Identify account type (test vs normal)
              const username = dm.username || dm.userId;
              const isTestAccount = this.testAccounts.includes(username.toLowerCase());
              const accountType = isTestAccount ? '[TEST ACCOUNT]' : '[NORMAL ACCOUNT]';
              
              // Check conversation state
              const isPermanentlyClosed = this.conversationManager.isPermanentlyClosed(dm.userId);
              const ofLinkSent = this.conversationManager.hasOFLinkBeenSent(dm.userId);
              
              let stateInfo = '';
              if (isPermanentlyClosed) {
                stateInfo = '(CLOSED FOREVER)';
              } else if (ofLinkSent) {
                stateInfo = '(OF LINK SENT - AWAITING RESPONSE)';
              } else {
                stateInfo = '(ACTIVE)';
              }
              
              logger.info(`✓ ${accountType} ${username} ${stateInfo} - Found unread message`);
              break;
            }
          }

          // Process the DM with unread, or first in list as fallback
          if (dmWithUnread) {
            await this.processDM(dmWithUnread);
          } else {
            logger.debug(`No DMs with confirmed unread, processing first in list`);
            await this.processDM(unreadDMs[0]);
          }
            
            // After first check completes, mark startup as complete
            // This prevents responding to old history that existed at boot time
            if (firstCheck) {
              firstCheck = false;
              this.startupComplete = true;
              logger.info('[Startup] First polling check complete - now accepting new messages');
            }
        } else {
          // Return to friends list if not already there
          if (this.lastPage !== 'friends') {
            await this.browser.navigateToFriendsList();
            this.lastPage = 'friends';
          }
          
          // Mark startup complete if no unread DMs found on first check
          if (firstCheck) {
            firstCheck = false;
            this.startupComplete = true;
            logger.info('[Startup] First polling check complete (no unread DMs) - now accepting new messages');
          }
        }

        // Production durability: Check if session restart needed
        // (Every 150 operations or 90 minutes - stays ahead of 2-hour browser degradation)
        await this.browser.checkAndRestartIfNeeded();

      } catch (error) {
        logger.error('DM polling error: ' + error.message);
        
        // Special handling for execution context errors
        if (error.message.includes('Execution context')) {
          logger.error('[CRITICAL] Execution context destroyed - browser may be stuck');
          // This will trigger on next health check
        }
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
      const messages = await this.browser.getMessagesWithRetry(1, 10, this.browser.botUsername, this.sentMessages);
      if (messages.length === 0) {
        return false;
      }

      // Get latest article from this polling cycle (should be 1 per extraction)
      const latestArticle = messages[0]; // Only 1 article per extraction now
      if (!latestArticle) {
        return false;
      }

      // Check if we already responded to this exact message
      const lastProcessed = this.conversationManager.getLastMessageId(userId);
      if (lastProcessed && lastProcessed === latestArticle.content) {
        logger.debug(`Already responded to "${latestArticle.content}" from ${username}, skipping timer`);
        return false;
      }

      // Check if this article is different from the last one we saw
      const lastSeenHTML = this.lastSeenArticles.get(userId);
      const currentHTML = latestArticle.articleHTML;
      
      if (lastSeenHTML === currentHTML) {
        // Same article as before - no new message
        logger.debug(`No new articles for ${username}`);
        return false;
      }
      
      // CRITICAL: Check if this message was already processed during startup
      // If it has OF link (user engaging or old message), mark conversation as closed to prevent re-processing
      if (latestArticle.hasOFLink && !this.conversationManager.isConversationActive(userId)) {
        logger.info(`🔗 Detected OF link for ${username} - marking conversation closed (no active conversation)`);
        this.closedConversations.add(userId);
        this.lastSeenArticles.set(userId, currentHTML);
        return false;
      }

      // NEW ARTICLE DETECTED - add to queue
      logger.info(`New article from ${username}: "${latestArticle.content}"`);
      
      // Initialize queue if needed
      if (!this.articleQueues.has(userId)) {
        this.articleQueues.set(userId, []);
      }
      
      // Add article to queue (remove articleHTML from stored version)
      const { articleHTML, ...articleData } = latestArticle;
      this.articleQueues.get(userId).push(articleData);
      
      // Update last seen article
      this.lastSeenArticles.set(userId, currentHTML);
      
      // Start/reset the collection timer
      this.startMessageCollectionTimer(dm);
      
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

      // DURING STARTUP: Just scan and mark messages as processed, don't respond yet
      // This prevents bot from replying to old history on first boot
      if (!this.startupComplete) {
        logger.debug(`Startup mode: Scanning DM from ${username || userId} but not responding yet`);
        const messages = await this.browser.getMessagesWithRetry(10, 10, this.browser.botUsername, this.sentMessages);
        
        // Mark all messages as processed so they won't trigger responses later
        if (messages.length > 0) {
          let seenSet = this.lastSeenArticles.get(userId);
          if (!seenSet) {
            seenSet = new Set();
            this.lastSeenArticles.set(userId, seenSet);
          }
          
          for (const msg of messages) {
            seenSet.add(msg.content);
            // CRITICAL: Check if message contains OF link during startup
            // If so, close the conversation to prevent re-processing
            if (msg.hasOFLink) {
              logger.info(`🔗 Startup: Detected OF link for ${username || userId} - closing conversation to prevent re-processing`);
              this.closedConversations.add(userId);
            }
          }
          logger.debug(`[Startup] Marked ${messages.length} messages as seen for ${userId}`);
        }
        return; // Don't respond during startup
      }

      // If username missing (happens when continuing conversation), extract from latest message
      if (!username && userId) {
        const messages = await this.browser.getMessagesWithRetry(1, 10, this.browser.botUsername, this.sentMessages);
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

      // Check if we have a pending combined message from the timer
      let latestUserMessage = null;
      
      if (this.pendingCombinedMessages.has(userId)) {
        // Use the combined message from the timer
        latestUserMessage = this.pendingCombinedMessages.get(userId);
        this.pendingCombinedMessages.delete(userId);
        logger.debug(`Using pending combined message: "${latestUserMessage.content}"`);
      } else {
        // Fallback: Extract messages normally (for first message or direct calls)
        const messages = await this.browser.getMessagesWithRetry(1, 10, this.browser.botUsername, this.sentMessages);
        if (messages.length === 0) {
          logger.warn(`No messages found in DM with ${username}`);
          this.inConversationWith = null;
          return;
        }

        logger.debug(`Found ${messages.length} message(s): ${JSON.stringify(messages)}`);

        // Get latest USER message (not our own)
        const botUsername = this.browser.botUsername || 'You';
        logger.debug(`Bot username: ${botUsername}`);
        
        latestUserMessage = messages
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
      }

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
      
      // Record that the user sent a message (resets 3-minute idle timer)
      this.conversationManager.recordUserMessage(userId);
      
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

      // Identify account type for cycling logging
      const isTestAccount = this.testAccounts.includes(extractedUsername.toLowerCase());
      const accountType = isTestAccount ? '[TEST ACCOUNT]' : '[NORMAL ACCOUNT]';
      logger.debug(`Account classification: ${accountType}`);

      // CRITICAL: Check if OF link was already sent to this user
      const ofLinkAlreadySent = this.conversationManager.hasOFLinkBeenSent(userId);
      const isPermanentlyClosed = this.conversationManager.isPermanentlyClosed(userId);
      
      // If permanently closed, never respond (hard stop)
      if (isPermanentlyClosed) {
        logger.info(`🔒 ${extractedUsername} conversation CLOSED FOREVER (OF link sent + closing response sent) - skipping all messages`);
        this.inConversationWith = null;
        return;
      }
      
      // OF link was sent and user is refusing - send ONE LAST RESPONSE then close forever
      if (ofLinkAlreadySent && !isTestAccount && this.messageHandler.isRefusingOF(cleanMessageText)) {
        logger.info(`🔗 User ${extractedUsername} refusing OF after link sent - sending final goodbye message`);
        
        // Mark message as processed to prevent re-processing
        this.conversationManager.setLastMessageId(userId, cleanMessageText);
        
        // Send one final response
        const finalMessage = this.messageHandler.getFinalGoodbyeMessage();
        await this.browser.sendMessage(finalMessage);
        logger.info(`✅ Final response sent to ${extractedUsername}: "${finalMessage}"`);
        
        // Mark conversation as permanently closed
        this.conversationManager.markPermanentlyClosed(userId);
        this.inConversationWith = null;
        return;
      }
      
      if (ofLinkAlreadySent && !isTestAccount) {
        // Regular user - OF link sent and NOT refusing, conversation is DONE
        logger.info(`🔗 OF link already sent to ${extractedUsername} (regular user) - conversation closed, not responding`);
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
          
          // Track this message as one WE sent (so we don't extract it back later)
          this.sentMessages.add(response.message);
          
          // CRITICAL: Mark this user as having received their first reply
          // This enables conversation mode (batching, multiple messages, etc.)
          if (!this.hasRepliedOnce.has(userId)) {
            this.hasRepliedOnce.set(userId, true);
            logger.info(`📝 First reply sent to ${extractedUsername} - conversation mode ENABLED`);
          }
          
          // CRITICAL: Mark OF link as sent if this response includes it
          if (response.hasOFLink) {
            this.conversationManager.markOFLinkSent(userId);
            if (!isTestAccount) {
              logger.info(`🔗 OF link sent to regular user ${extractedUsername} - conversation closed`);
            } else {
              logger.info(`🔗 OF link sent to test account ${extractedUsername} - conversation can continue on greeting`);
            }
          }
          
          // SAFEGUARD: If this was an underage or illegal content response, mark permanently closed
          if (response.source === 'safeguard_age' || response.source === 'safeguard_illegal') {
            this.conversationManager.markPermanentlyClosed(userId);
            logger.info(`🚫 SAFEGUARD TRIGGERED (${response.source}): ${extractedUsername} - conversation permanently closed`);
          }
          
          messageSent = true;
          
          // CRITICAL: Cancel the message collection timer for this user
          // Prevents the timer from reprocessing the same message we just responded to
          if (this.messageCollectionTimer.has(userId)) {
            clearTimeout(this.messageCollectionTimer.get(userId));
            this.messageCollectionTimer.delete(userId);
            logger.debug(`🗑️  Cleared message collection timer for ${extractedUsername} (response sent)`);
          }
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
   * Start message collection timer - accumulates new articles for 10 seconds
   * Gets called every 5 seconds during polling; only processes when timer expires
   */
  startMessageCollectionTimer(dm) {
    const { userId, username } = dm;
    
    // Record that user sent a message (resets 3-min idle timer)
    this.conversationManager.recordUserMessage(userId);
    
    // If timer already running, cancel it and restart (user sent another message)
    if (this.messageCollectionTimer.has(userId)) {
      clearTimeout(this.messageCollectionTimer.get(userId));
      logger.debug(`⏱️  Timer reset for ${username} (new article detected)`);
    }
    
    logger.debug(`⏱️  Message collection timer started for ${username} (10 second wait)`);
    
    // Wait 10 seconds to collect all multi-line message articles
    const timerId = setTimeout(async () => {
      logger.debug(`⏱️  Message collection timeout - processing DM from ${username}`);
      this.messageCollectionTimer.delete(userId);
      
      // CRITICAL: Check if we already responded to this user
      // If responsePending is set, a response is in flight - don't reprocess
      if (this.responsePending[userId]) {
        logger.debug(`⏱️  Response already pending for ${username}, skipping collection timer reprocess`);
        this.articleQueues.delete(userId);
        return;
      }
      
      // Combine all accumulated articles
      const accumulatedArticles = this.articleQueues.get(userId) || [];
      if (accumulatedArticles.length > 0) {
        // Combine articles from same user into one message
        const combinedContent = accumulatedArticles
          .map(article => article.content)
          .join(' ');
        
        logger.debug(`Combined ${accumulatedArticles.length} articles into 1 message: "${combinedContent}"`);
        
        // Store the combined message for processDM to use
        this.pendingCombinedMessages.set(userId, {
          author: accumulatedArticles[0].author,
          content: combinedContent,
          hasOFLink: accumulatedArticles.some(a => a.hasOFLink)
        });
        
        // Clear the queue
        this.articleQueues.delete(userId);
        
        // Process the DM
        await this.processDM(dm);
      }
    }, 10000); // 10 second wait
    
    this.messageCollectionTimer.set(userId, timerId);
  }

  /**
   * Restart browser when it gets into a bad state
   * Gracefully closes old browser and launches new one with login
   */
  async restartBrowser() {
    logger.error('[BROWSER RECOVERY] Initiating browser restart...');
    
    try {
      // Temporarily stop polling
      if (this.dmPollingInterval) {
        clearInterval(this.dmPollingInterval);
        this.dmPollingInterval = null;
      }
      
      // Close old browser
      try {
        logger.info('Closing old browser instance...');
        await this.browser.close();
        logger.info('Old browser closed');
      } catch (err) {
        logger.warn(`Error closing old browser: ${err.message}`);
      }
      
      // Create new browser instance
      logger.info('Launching new browser instance...');
      this.browser = new BrowserController();
      this.browser.setBot(this);
      
      const launched = await this.browser.launch();
      if (!launched) {
        throw new Error('Failed to launch new browser');
      }
      
      logger.info('New browser launched, logging in...');
      
      // Re-login with stored cookies or fresh login
      const cookiesLoaded = await this.browser.loadCookies();
      if (cookiesLoaded) {
        logger.info('Cookies loaded from disk, attempting auto-login...');
        await this.browser.page.goto('https://discord.com/channels/@me', {
          waitUntil: 'domcontentloaded',
          timeout: 15000
        }).catch(err => logger.warn(`Auto-login navigation failed: ${err.message}`));
      } else {
        logger.info('No cookies found, waiting for manual login...');
        await this.browser.login(process.env.DISCORD_EMAIL, process.env.DISCORD_PASSWORD);
      }
      
      logger.info('[BROWSER RECOVERY] Browser restart complete - resuming operations');
      
      // Resume polling
      this.startDMPolling();
      
      return true;
    } catch (error) {
      logger.error(`[BROWSER RECOVERY FAILED] ${error.message}`);
      logger.error('Bot may need manual restart');
      // Attempt to restart polling anyway - next health check will catch it if still broken
      this.startDMPolling();
      return false;
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
    
    // Clear message collection timers
    if (this.messageCollectionTimer) {
      for (const [userId, timerId] of this.messageCollectionTimer.entries()) {
        clearTimeout(timerId);
      }
      this.messageCollectionTimer.clear();
    }

    // Stop periodic state save and force final save
    this.stopPeriodicStateSave();

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
