import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cookiesDir = path.join(process.cwd(), 'data');
const cookiesFile = path.join(cookiesDir, 'discord-cookies.json');

if (!fs.existsSync(cookiesDir)) {
  fs.mkdirSync(cookiesDir, { recursive: true });
}

export class BrowserController {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isLoggedIn = false;
    this.loginAttempts = 0;
    this.maxLoginAttempts = 3;
    this.healthCheckInterval = null;
    this.healthCheckCallback = null;
    this.bot = null;
    
    // Session restart tracking (production durability)
    this.operationCount = 0;
    this.sessionStartTime = null;
    this.maxOperationsPerSession = 150;  // Restart after 150 operations
    this.maxSessionDurationMs = 90 * 60 * 1000;  // 90 minutes - stays ahead of 2hr degradation
    this.isRestarting = false;  // Flag to prevent concurrent restart attempts
  }

  /**
   * Inject bot reference for accessing bot state (like sentMessages)
   */
  setBot(bot) {
    this.bot = bot;
  }

  /**
   * Launch browser with enhanced monitoring and error handling
   */
  async launch() {
    try {
      // Find Edge or Chrome executable (puppeteer-core requires explicit path)
      const edgePaths = [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ];
      const executablePath = edgePaths.find(p => fs.existsSync(p));
      if (!executablePath) {
        throw new Error('No browser found. Please ensure Microsoft Edge or Google Chrome is installed.');
      }

      this.browser = await puppeteer.launch({
        headless: false,
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          // REMOVED: --disable-dev-shm-usage was INCREASING memory usage by 15-40%
          // Use shared memory instead (standard optimization for non-container environments)
          '--disable-blink-features=AutomationControlled',
        ],
        defaultViewport: { width: 1920, height: 1080 },
      });

      this.page = await this.browser.newPage();

      // Set reasonable navigation timeout (60 seconds = 60000ms)
      // Prevents hanging indefinitely if Discord is slow or unresponsive
      this.page.setDefaultNavigationTimeout(60000);
      this.page.setDefaultTimeout(60000);

      // Set realistic user agent
      await this.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      );

      // Disable automation detection
      await this.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      // Add event listeners for monitoring (based on production best practices)
      this.setupBrowserMonitoring();

      // Initialize session tracking (production durability)
      this.resetSessionTracking();

      logger.info('Browser launched with stability monitoring');
      return true;
    } catch (error) {
      logger.error('Browser launch failed', { error: error.message });
      return false;
    }
  }

  /**
   * Setup browser and page event monitoring for production reliability
   * Detects browser crashes, disconnects, and page errors
   */
  setupBrowserMonitoring() {
    // Browser disconnect monitoring (detects crashes)
    this.browser.on('disconnected', () => {
      logger.error('Browser disconnected or crashed - needs restart');
      // Bot.js main loop will detect this and restart
    });

    // Page error monitoring
    this.page.on('error', (error) => {
      logger.error('Page error emitted', { message: error.message });
    });

    // Response monitoring (log suspicious responses)
    this.page.on('response', (response) => {
      if (!response.ok() && response.status() >= 500) {
        logger.warn(`Server error detected: [${response.status()}] ${response.url()}`);
      }
    });

    // Catch execution context destroyed errors
    this.page.on('error', (error) => {
      if (error.message.includes('Execution context was destroyed')) {
        logger.error('Execution context destroyed - page is likely stuck');
      }
    });
  }

  /**
   * Perform health check on browser - returns true if healthy, false if needs restart
   */
  async healthCheck() {
    try {
      // Try to evaluate a simple expression
      const result = await Promise.race([
        this.page.evaluate(() => true),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), 5000)
        )
      ]);

      return result === true;
    } catch (error) {
      logger.warn(`Health check failed: ${error.message}`);
      if (error.message.includes('Execution context')) {
        logger.error('Execution context destroyed - browser needs restart');
      }
      return false;
    }
  }

  /**
   * Clear page state and reset to a clean state
   * Useful after errors to ensure next operation starts fresh
   */
  async clearPageState() {
    try {
      logger.debug('Clearing page state...');
      // Navigate to blank page
      await this.page.goto('about:blank', { waitUntil: 'load' });
      logger.debug('Page cleared');
      return true;
    } catch (error) {
      logger.warn('Failed to clear page state', { error: error.message });
      return false;
    }
  }

  /**
   * Load existing cookies
   */
  async loadCookies() {
    try {
      if (fs.existsSync(cookiesFile)) {
        const cookies = JSON.parse(fs.readFileSync(cookiesFile, 'utf-8'));
        await this.page.setCookie(...cookies);
        logger.info('Cookies loaded');
        return true;
      }
      return false;
    } catch (error) {
      logger.warn('Cookie load failed, will do fresh login');
      return false;
    }
  }

  /**
   * Save cookies after successful login
   */
  async saveCookies() {
    try {
      const cookies = await this.page.cookies();
      fs.writeFileSync(cookiesFile, JSON.stringify(cookies, null, 2));
      logger.info('Cookies saved');
    } catch (error) {
      logger.warn('Failed to save cookies', { error: error.message });
    }
  }

  /**
   * Login to Discord with indefinite wait for auth/captcha/2FA
   */
  async login(email, password) {
    try {
      // Skip loading cached cookies - do fresh auth
      // const loaded = await this.loadCookies();
      // if (loaded) {
      //   ... cookie check ...
      // }

      // DISABLE timeouts during login - user may take time to complete 2FA/captcha
      this.page.setDefaultNavigationTimeout(0);
      this.page.setDefaultTimeout(0);

      // Go to Discord login
      logger.info('Navigating to Discord login (waiting for page to load)...');
      await this.page.goto('https://discord.com/login', {
        waitUntil: 'domcontentloaded',
      });
      logger.info('Discord login page loaded');

      // Wait for login form inputs to appear (no timeout - wait indefinitely)
      logger.info('Waiting for login form inputs...');
      await this.page.waitForSelector('input[name="email"]');
      await this.page.type('input[name="email"]', email, { delay: 50 });

      await this.page.waitForSelector('input[name="password"]');
      await this.page.type('input[name="password"]', password, { delay: 50 });

      // Click login
      await this.page.click('button[type="submit"]');

      // Wait for user to complete captcha/2FA - check every 2 seconds until done
      logger.info('Waiting for captcha/2FA completion...');
      
      let authenticated = false;
      while (!authenticated) {
        await new Promise(r => setTimeout(r, 2000)); // Check every 2 seconds

        try {
          // Check if Discord home page loaded (indicates successful auth)
          const isHome = await this.page.evaluate(() => {
            return document.querySelector('[class*="guilds"]') !== null;
          });

          if (isHome) {
            authenticated = true;
            logger.info('Authentication successful');
            break;
          }
        } catch (e) {
          // Continue checking
        }
      }

      // RE-ENABLE timeouts after login is complete
      this.page.setDefaultNavigationTimeout(60000);
      this.page.setDefaultTimeout(60000);

      this.isLoggedIn = true;
      await this.saveCookies();
      
      // Extract bot's own username from logged-in account
      this.botUsername = await this.getBotUsername();
      if (this.botUsername) {
        logger.info(`Detected bot username: ${this.botUsername}`);
      }
      
      // Wait for Discord to fully stabilize after auth before navigating
      // This prevents chunk loading errors when Puppeteer navigates too quickly
      logger.info('Waiting for Discord to fully initialize...');
      await new Promise(r => setTimeout(r, 2000));
      
      return true;
    } catch (error) {
      logger.error('Login failed', { error: error.message });
      this.isLoggedIn = false;
      return false;
    }
  }

  /**
   * Get the bot's own username from the logged-in Discord account
   * OPTIMIZED: Uses BOT_USERNAME from .env (set in start.bat) - skips expensive DOM queries
   */
  async getBotUsername() {
    try {
      // Use BOT_USERNAME from .env (set in start.bat by user)
      const envUsername = process.env.BOT_USERNAME;
      if (envUsername && envUsername !== 'Unknown' && envUsername !== 'You' && envUsername.trim().length > 0) {
        logger.info(`Bot username: ${envUsername} (from .env)`);
        return envUsername;
      }
      
      // Fallback if .env doesn't have it (rare case)
      logger.warn('BOT_USERNAME not found in .env, using fallback "Bot"');
      return 'Bot';
    } catch (error) {
      logger.warn('Error getting bot username:', error.message);
      return process.env.BOT_USERNAME || 'Bot';
    }
  }

  /**
   * Navigate to friends list (home) with enhanced stability
   * Uses timeout + retry pattern to handle race conditions on slow systems
   */
  async navigateToFriendsList(retryCount = 0, maxRetries = 3) {
    try {
      const timeoutMs = 15000; // 15 seconds per attempt
      
      // Wrap in Promise.race to enforce timeout
      await Promise.race([
        this.page.goto('https://discord.com/channels/@me', {
          waitUntil: 'domcontentloaded',
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Navigation timeout')), timeoutMs)
        )
      ]);

      // CRITICAL: After domcontentloaded, wait for React to render sidebar
      // Discord's React takes 1-3 seconds after HTML loads
      // Using waitForFunction to check for actual DM links, not just nav element
      logger.debug('Waiting for Discord sidebar React component to render...');
      
      try {
        await this.page.waitForFunction(() => {
          // Check if sidebar has DM links - this proves React rendered
          const dmLinks = document.querySelectorAll('a[href*="/channels/@me/"]');
          return dmLinks.length > 0;
        }, { timeout: 8000 }); // Wait up to 8 seconds for sidebar to render
        
        logger.info('Navigated to friends list - sidebar rendered');
        return true;
      } catch (sidebarError) {
        logger.warn('Sidebar did not render after navigation, trying fallback check');
        
        // Fallback: just check if we can see navigation elements
        await this.page.waitForSelector('nav, [role="navigation"]', { timeout: 3000 })
          .catch(() => logger.warn('Navigation/sidebar elements not found'));
        
        logger.info('Navigated to friends list (fallback)');
        return true;
      }
    } catch (error) {
      logger.error('Navigation failed', { error: error.message });
      
      // Retry logic: if network error or timeout, try again
      if (retryCount < maxRetries && 
          (error.message.includes('timeout') || 
           error.message.includes('net::ERR') ||
           error.message.includes('Execution context'))) {
        
        logger.warn(`Navigation retry ${retryCount + 1}/${maxRetries} after error: ${error.message}`);
        await new Promise(r => setTimeout(r, 2000)); // Wait 2 seconds before retry
        return this.navigateToFriendsList(retryCount + 1, maxRetries);
      }
      
      return false;
    }
  }

  /**
   * Get unread DMs - check which ones have new messages we haven't replied to
   * Enhanced with timeout and error recovery
   */
  async getUnreadDMs() {
    try {
      // Ensure we're on friends list but DON'T navigate (save the sidebar visibility)
      const currentUrl = this.page.url();
      if (!currentUrl.includes('/channels/@me')) {
        // Only navigate if we're not on friends list
        logger.debug('Not on friends list, navigating...');
        const navSuccess = await this.navigateToFriendsList();
        if (!navSuccess) {
          logger.warn('Navigation to friends list failed');
          return [];
        }
      }
      
      // Wait for sidebar to fully load with DM list
      // Use timeout to prevent indefinite hanging
      try {
        await Promise.race([
          this.page.waitForSelector('a[href*="/channels/@me/"]', { timeout: 5000 }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Sidebar load timeout')), 6000)
          )
        ]).catch((err) => {
          logger.warn(`Sidebar links check failed: ${err.message}`);
        });
      } catch (err) {
        logger.warn('Failed waiting for DM sidebar links');
      }

      await new Promise(r => setTimeout(r, 500));

      // Get all DM links from sidebar using multiple selector strategies
      // Wrapped in timeout to handle stuck queries
      const dmLinks = await Promise.race([
        this.page.evaluate(() => {
          const links = [];
          const seenIds = new Set();

          // Strategy 1: Direct href selector (most reliable)
          let allLinks = Array.from(document.querySelectorAll('a[href*="/channels/@me/"]'));
          
          // Strategy 2: If no links found, try to find them in the navigation area
          if (allLinks.length === 0) {
            // Look in the main nav area
            const nav = document.querySelector('nav, [role="navigation"]') || 
                       document.querySelector('[class*="sidebar"], [class*="nav"]');
            if (nav) {
              allLinks = Array.from(nav.querySelectorAll('a[href*="/channels/@me/"]'));
            }
          }

          // Strategy 3: Try to find by role and data attributes
          if (allLinks.length === 0) {
            allLinks = Array.from(document.querySelectorAll('[role="listitem"] a[href*="/channels"]'));
          }

          for (const link of allLinks) {
            try {
              const href = link.getAttribute('href');
              if (!href) continue;

              const match = href.match(/channels\/@me\/(\d{15,})/);
              if (!match || !match[1]) continue;

              const userId = match[1];
              if (seenIds.has(userId)) continue;
              seenIds.add(userId);

              const username = link.textContent?.trim() || 'User_' + userId.substring(0, 8);
              links.push({ userId, username });
            } catch (e) {
              // Skip
            }
          }

          return links;
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('DM extraction timeout')), 4000)
        )
      ]).catch((err) => {
        logger.warn(`DM link extraction failed: ${err.message}`);
        return [];
      });

      logger.debug(`Found ${dmLinks.length} total DMs in sidebar ${dmLinks.length > 0 ? `(${dmLinks.map(d => d.username).join(', ')})` : ''}`);

      // If still no DMs found, there might be an issue with the sidebar
      if (dmLinks.length === 0) {
        logger.warn('No DM links found in sidebar - sidebar may not be loading properly');
        return [];
      }

      // Return ALL DMs - let the main bot logic check which ones actually have new messages
      // This is more reliable than trying to detect Discord's unread indicators
      logger.info(`Found ${dmLinks.length} DM(s)`);
      return dmLinks;
    } catch (error) {
      logger.error('Failed to get unread DMs', { error: error.message });
      
      // Try to get back to friends list (error recovery)
      try {
        logger.debug('Attempting error recovery - navigating back to friends list');
        await this.clearPageState();
        await this.navigateToFriendsList();
      } catch (e) {
        logger.warn(`Error recovery failed: ${e.message}`);
      }
      return [];
    }
  }

  /**
   * Check if a DM has unread messages (assumes we're already navigating to it)
   */
  async checkDMHasUnreadMessages(userId) {
    try {
      // Navigate to the DM
      await this.page.goto(`https://discord.com/channels/@me/${userId}`, {
        waitUntil: 'domcontentloaded',
      });

      await new Promise(r => setTimeout(r, 500));

      // Get the last message
      const lastMessageInfo = await this.page.evaluate(() => {
        const messageElements = Array.from(document.querySelectorAll('[role="article"]'));
        if (messageElements.length === 0) return null;

        const lastMsg = messageElements[messageElements.length - 1];
        const allText = lastMsg.textContent?.trim() || '';
        
        // Get the actual message content (last line that's not a timestamp)
        const lines = allText.split('\n').filter(l => l.trim().length > 0);
        for (let i = lines.length - 1; i >= 0; i--) {
          // Skip timestamp lines
          if (!lines[i].match(/\d{1,2}:\d{2}/) && lines[i].length > 2) {
            return {
              content: lines[i],
              fullText: allText
            };
          }
        }

        return null;
      });

      if (!lastMessageInfo) {
        return false;
      }

      // If last message is from us ("You" or starts with our actions), no unread from user
      const isFromUs = lastMessageInfo.content.includes('You') || lastMessageInfo.fullText.startsWith('You');
      
      return !isFromUs; // Return true if NOT from us (i.e., from user)
    } catch (error) {
      logger.debug(`Error checking DM ${userId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Open DM with user - with enhanced stability and execution context recovery
   * Uses timeout + selector waits to ensure messages are loaded before returning
   */
  async openDM(userId, retryCount = 0, maxRetries = 2) {
    try {
      logger.debug(`Opening DM with ${userId} (attempt ${retryCount + 1}/${maxRetries + 1})`);
      
      // First, check if we can find the DM link in sidebar
      const linkExists = await this.page.evaluate((userId) => {
        const link = document.querySelector(`a[href*="/channels/@me/${userId}"]`);
        return link ? true : false;
      }, userId);

      if (linkExists) {
        // Try clicking the link (more stable than goto)
        await this.page.evaluate((userId) => {
          const link = document.querySelector(`a[href*="/channels/@me/${userId}"]`);
          if (link) link.click();
        }, userId);
        
        logger.debug(`Clicked DM link in sidebar for ${userId}`);
      } else {
        // Fallback to direct navigation if link not in sidebar
        logger.warn(`DM link not found in sidebar for ${userId}, using direct navigation`);
        
        try {
          await Promise.race([
            this.page.goto(`https://discord.com/channels/@me/${userId}`, {
              waitUntil: 'domcontentloaded',
            }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('DM navigation timeout')), 10000)
            )
          ]);
        } catch (gotoError) {
          logger.warn(`Direct navigation failed: ${gotoError.message}`);
          if (retryCount < maxRetries) {
            logger.warn(`Retrying DM open (${retryCount + 1}/${maxRetries})`);
            await new Promise(r => setTimeout(r, 1500));
            return this.openDM(userId, retryCount + 1, maxRetries);
          }
          throw gotoError;
        }
      }

      // Wait for page to settle
      await new Promise(r => setTimeout(r, 1000));

      // CRITICAL: Wait for messages/articles to load
      // This is where we detect if the page is stuck or didn't render
      logger.debug('Waiting for message articles to load...');
      
      let messagesLoaded = false;
      let waitAttempts = 0;
      const maxWaitAttempts = 15; // 15 * 400ms = 6 seconds max wait
      
      while (!messagesLoaded && waitAttempts < maxWaitAttempts) {
        try {
          await new Promise(r => setTimeout(r, 400));
          
          const articleCount = await this.page.evaluate(() => {
            return document.querySelectorAll('[role="article"]').length;
          }).catch(err => {
            logger.debug(`Article count check failed: ${err.message}`);
            return 0;
          });
          
          waitAttempts++;
          
          if (articleCount > 0) {
            messagesLoaded = true;
            logger.debug(`Messages loaded! Found ${articleCount} articles`);
            break;
          }
          
          if (waitAttempts % 3 === 0) {
            logger.debug(`Waiting for messages... attempt ${waitAttempts}/${maxWaitAttempts}`);
          }
        } catch (checkError) {
          logger.debug(`Error checking articles: ${checkError.message}`);
          if (checkError.message.includes('Execution context')) {
            logger.error('Execution context destroyed - page may be stuck');
            // Return false to trigger browser recovery at higher level
            return false;
          }
        }
      }

      // Check page status
      const pageStatus = await this.page.evaluate(() => {
        return {
          title: document.title,
          url: window.location.href,
          hasArticles: document.querySelectorAll('[role="article"]').length > 0,
          articleCount: document.querySelectorAll('[role="article"]').length,
        };
      }).catch(() => ({}));

      if (!messagesLoaded) {
        logger.warn(`Page opened but articles not loading. Status: ${JSON.stringify(pageStatus)}`);
        
        // If messages never loaded after full wait period, this is a stuck state
        if (retryCount < maxRetries) {
          logger.warn(`Message load failed, retrying... (${retryCount + 1}/${maxRetries})`);
          await new Promise(r => setTimeout(r, 2000));
          return this.openDM(userId, retryCount + 1, maxRetries);
        }
      }

      logger.info(`Successfully opened DM with ${userId}`);
      return true;
    } catch (error) {
      logger.error(`Failed to open DM ${userId}`, { error: error.message });
      
      // Special handling for Execution context errors
      if (error.message.includes('Execution context')) {
        logger.error('Execution context destroyed - browser may need restart');
        return false;
      }
      
      return false;
    }
  }

  /**
   * Reload current page to clear DOM/event listener accumulation
   * Called periodically or when memory threshold exceeded
   * Preserves Discord auth via cookies
   */
  async reloadPage(reason = 'periodic refresh') {
    try {
      logger.info(`[MEMORY] Reloading page (reason: ${reason})...`);
      
      const currentUrl = this.page.url();
      
      // Navigate to blank page first (clears all DOM/listeners)
      await this.page.goto('about:blank', { waitUntil: 'load' });
      
      // Brief pause to ensure cleanup
      await new Promise(r => setTimeout(r, 500));
      
      // Return to previous URL (preserves Discord session via cookies)
      await Promise.race([
        this.page.goto(currentUrl || 'https://discord.com/channels/@me', { waitUntil: 'domcontentloaded' }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Page reload timeout')), 10000)
        )
      ]);

      logger.info(`[MEMORY] ✅ Page reloaded successfully`);
      return true;
    } catch (error) {
      logger.warn(`[MEMORY] ⚠️ Page reload failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Get messages with retry logic for reliable extraction on fresh DM opens
   * CRITICAL: Retries up to 10 times if extraction fails, to ensure startup unread messages are captured
   */
  async getMessagesWithRetry(limit = 1, maxRetries = 10, botUsername = null, sentMessages = null) {
    let lastResult = [];
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const messages = await this.getMessages(limit, botUsername, sentMessages);
      
      if (messages.length > 0) {
        // Success! Return immediately
        logger.debug(`[Attempt ${attempt}/${maxRetries}] Extraction succeeded, found ${messages.length} message(s)`);
        return messages;
      }
      
      // Extraction failed (0 messages), retry after delay
      if (attempt < maxRetries) {
        const delayMs = 300 + (attempt * 50); // 350ms, 400ms, 450ms, etc.
        logger.debug(`[Attempt ${attempt}/${maxRetries}] Extraction failed, retrying in ${delayMs}ms...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    
    // All retries exhausted
    logger.warn(`[Extraction] Failed after ${maxRetries} attempts, returning empty`);
    return lastResult;
  }

  /**
   * Get messages from current DM
   */
  async getMessages(limit = 1, botUsername = null, sentMessages = null) {
    try {
      logger.debug('Attempting to extract messages from DOM...');
      
      const extractionResult = await this.page.evaluate((limit, botUsername, sentMessages) => {
        const msgs = [];
        const debug = {
          articlesFound: 0,
          messagesExtracted: 0,
          errors: [],
          articleDetails: [] // NEW: Log details of each article
        };
        
        // Get all article elements
        const articles = Array.from(document.querySelectorAll('[role="article"]'));
        debug.articlesFound = articles.length;
        
        // NEW DEBUG: Log first 3 articles to understand DOM structure
        for (let i = Math.max(0, articles.length - 3); i < articles.length; i++) {
          const article = articles[i];
          const innerText = (article.innerText || article.textContent).substring(0, 100);
          const firstSpan = article.querySelector('span[role="button"]')?.textContent || 'N/A';
          debug.articleDetails.push({
            index: i,
            innerTextPreview: innerText,
            authorSpan: firstSpan
          });
        }
        
        if (articles.length === 0) {
          debug.errors.push('No articles found');
          return { messages: msgs, debug };
        }

        // Extract ONLY the latest 1 article
        let processedCount = 0;
        
        for (let i = articles.length - 1; i >= 0 && processedCount < 1; i--) {
          const article = articles[i];
          try {
            let author = 'Unknown';
            let content = '';
            
            // Extract author
            const authorSpan = article.querySelector('span[role="button"]');
            if (authorSpan) {
              author = authorSpan.textContent.trim().split(/\s+/)[0];
            }
            
            // Extract content
            const allText = article.innerText || article.textContent;
            const lines = allText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            
            const contentLines = [];
            for (const line of lines) {
              // Skip ONLY metadata patterns
              if (/^\d{1,2}:\d{2}$/.test(line)) continue;
              if (/^\[\d{1,2}:\d{2}\]$/.test(line)) continue;
              if (/^\s*—\s*$/.test(line)) continue;
              if (/^(Edit|Delete|Reply|More)$/.test(line)) continue;
              if (author && line === author) continue;
              if (/г\.\s+в\s+\d{1,2}:\d{2}/.test(line)) continue;
              if (/^\d{1,2}\s+(January|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i.test(line)) continue;
              if (/^(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)/.test(line)) continue;
              
              contentLines.push(line);
            }
            
            if (contentLines.length > 0) {
              content = [...new Set(contentLines)].join(' ').trim();
            }
            
            // Only strip username if content starts with the author's name
            if (author && content.toLowerCase().startsWith(author.toLowerCase())) {
              content = content.replace(new RegExp(`^${author}\\s+`, 'i'), '').trim();
            }
            
            // Only add if there's actual content (message text)
            // Author validation happens in processDM
            if (content && content.length > 1) {
              // Skip bot messages by username
              if (botUsername && author && author.toLowerCase() === botUsername.toLowerCase()) {
                debug.errors.push('Message is from bot, skipping');
                processedCount++;
                continue;
              }
              
              // CRITICAL: Strip any leading [ ] or [ content ] prefixes for self-response check
              // These prefixes appear when we extract our own messages
              const normalizedContent = content.replace(/^\[\s*\]\s*/, '').trim();
              
              // Normalize content same way bot.js does: collapse spaces/newlines
              const fullyNormalizedContent = content
                .replace(/\r?\n/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
              const fullyNormalizedDirtyContent = normalizedContent
                .replace(/\r?\n/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
              
              // Skip messages that WE (the bot) just sent
              // These can come back with author="dm_user" when we lose author attribution
              // Check multiple normalized variants to catch multi-line messages
              if (sentMessages && Array.isArray(sentMessages) && sentMessages.length > 0) {
                let isOurMessage = false;
                for (const sentMsg of sentMessages) {
                  const sentNormalized = sentMsg
                    .replace(/\r?\n/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                  
                  if (content === sentMsg || 
                      normalizedContent === sentMsg ||
                      fullyNormalizedContent === sentMsg ||
                      fullyNormalizedContent === sentNormalized ||
                      fullyNormalizedDirtyContent === sentMsg ||
                      fullyNormalizedDirtyContent === sentNormalized) {
                    isOurMessage = true;
                    break;
                  }
                }
                
                if (isOurMessage) {
                  debug.errors.push('Message is from bot (in sentMessages), skipping');
                  processedCount++;
                  continue;
                }
              }
              
              // Use generic author if couldn't extract
              if (!author || author === 'Unknown') {
                author = 'dm_user';
              }
              
              msgs.push({ 
                author, 
                content, 
                hasOFLink: /onlyfans|of\s*link/i.test(content),
                articleHTML: article.outerHTML
              });
              debug.messagesExtracted++;
            }
            
            processedCount++;
            
          } catch (e) {
            debug.errors.push(`Error: ${e.message}`);
            processedCount++;
          }
        }

        return { messages: msgs, debug };
      }, limit, botUsername, sentMessages ? Array.from(sentMessages) : []);
      
      logger.debug(`Extraction result: articles=${extractionResult.debug.articlesFound}, extracted=${extractionResult.debug.messagesExtracted}, errors=${extractionResult.debug.errors.join('; ')}`);

      const messages = extractionResult.messages;

      if (messages.length === 0) {
        logger.debug('getMessages: No messages extracted - DOM may not have [role="article"] elements loaded');
      } else {
        logger.debug(`getMessages: Extracted ${messages.length} message(s): ${JSON.stringify(messages)}`);
      }
      
      return messages;
    } catch (error) {
      logger.error('Failed to get messages: ' + error.message);
      return [];
    }
  }

  /**
   * Send message in current DM
   */
  async sendMessage(text) {
    try {
      logger.info(`Attempting to send: "${text}"`);
      
      // Wait for input to be available
      await this.page.waitForFunction(() => {
        const input = document.querySelector('[class*="textinput"]') || 
                     document.querySelector('textarea') ||
                     document.querySelector('[contenteditable="true"]');
        return input !== null;
      }, { timeout: 5000 }).catch(() => {
        logger.debug('Input element not found immediately');
      });

      // Find and click the input
      const inputFound = await this.page.evaluate(() => {
        // Try multiple selectors for Discord's message input
        let input = document.querySelector('textarea[class*="input"]') ||
                   document.querySelector('[contenteditable="true"][role="textbox"]') ||
                   document.querySelector('textarea') ||
                   document.querySelector('[placeholder*="Message"]');
        
        if (input) {
          input.click();
          input.focus();
          return true;
        }
        return false;
      });

      if (!inputFound) {
        throw new Error('Could not find or focus message input');
      }

      // Wait a bit for focus to register
      await new Promise(r => setTimeout(r, 200));

      // Type the message character by character
      await this.page.keyboard.type(text, { delay: 50 });

      // Wait for text to be entered
      await new Promise(r => setTimeout(r, 300));

      // Press Enter to send
      await this.page.keyboard.press('Enter');

      // Wait for Discord to process
      await new Promise(r => setTimeout(r, 500));

      logger.info('Message sent successfully');
      return true;
    } catch (error) {
      logger.error('Failed to send message: ' + error.message);
      return false;
    }
  }

  /**
   * Close browser gracefully
   */
  async close() {
    try {
      if (this.browser) {
        await this.browser.close();
        logger.info('Browser closed');
      }
    } catch (error) {
      logger.error('Error closing browser', { error: error.message });
    }
  }

  /**
   * Check if browser is still alive
   */
  async isAlive() {
    try {
      if (!this.browser) return false;
      return await this.browser.version() !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      if (!this.browser || !this.isLoggedIn) return false;
      const alive = await this.isAlive();
      return alive;
    } catch (error) {
      logger.warn('Health check failed', { error: error.message });
      return false;
    }
  }

  /**
   * Start periodic health checks
   */
  startHealthCheck(callback) {
    this.healthCheckCallback = callback;
    this.healthCheckInterval = setInterval(async () => {
      const healthy = await this.healthCheck();
      if (callback) {
        callback(healthy);
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Stop health checks
   */
  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Get the latest message ID in current DM
   * Used for tracking if new messages arrived
   */
  async getLatestMessageId() {
    try {
      const messageId = await this.page.evaluate(() => {
        // Try to get message ID from the DOM
        // Discord stores message IDs in data attributes or element IDs
        const articles = Array.from(document.querySelectorAll('[role="article"]'));
        if (articles.length === 0) return null;

        const lastArticle = articles[articles.length - 1];
        
        // Try to get ID from data attributes
        let id = lastArticle.getAttribute('data-message-id') ||
                 lastArticle.getAttribute('data-id') ||
                 lastArticle.id;

        // If not found, try parent elements
        if (!id) {
          let parent = lastArticle;
          while (parent && !id) {
            parent = parent.parentElement;
            if (parent) {
              id = parent.getAttribute('data-message-id') ||
                   parent.getAttribute('data-id') ||
                   parent.id;
            }
          }
        }

        // Fallback: use message timestamp as unique identifier
        if (!id) {
          const timeElements = lastArticle.querySelectorAll('time');
          if (timeElements.length > 0) {
            const timeAttr = timeElements[0].getAttribute('datetime');
            if (timeAttr) {
              // Create a hash from the timestamp + content
              const content = lastArticle.textContent?.trim() || '';
              id = `${timeAttr}_${content.substring(0, 20).replace(/\s/g, '_')}`;
            }
          }
        }

        return id;
      });

      return messageId;
    } catch (error) {
      logger.debug('Failed to get latest message ID', { error: error.message });
      return null;
    }
  }

  /**
   * Get message count in current DM
   */
  async getMessageCount() {
    try {
      const count = await this.page.evaluate(() => {
        return document.querySelectorAll('[role="article"]').length;
      });
      return count;
    } catch (error) {
      logger.debug('Failed to get message count', { error: error.message });
      return 0;
    }
  }

  /**
   * Reset session tracking counters after browser initialization
   */
  resetSessionTracking() {
    this.operationCount = 0;
    this.sessionStartTime = Date.now();
    logger.debug('Session tracking reset - new session started');
  }

  /**
   * Increment operation counter and check if restart needed
   * Call this after each DM check or message operation
   * (Stays ahead of 2-hour failure by restarting at 90 minutes)
   */
  async checkAndRestartIfNeeded() {
    // Prevent concurrent restart attempts
    if (this.isRestarting) {
      logger.debug('Restart already in progress, skipping check');
      return;
    }

    this.operationCount++;
    const elapsedMs = Date.now() - this.sessionStartTime;
    const elapsedMins = Math.round(elapsedMs / 60000);

    // Check both operation count and time-based restart conditions
    const operationThresholdHit = this.operationCount >= this.maxOperationsPerSession;
    const timeThresholdHit = elapsedMs >= this.maxSessionDurationMs;

    if (operationThresholdHit || timeThresholdHit) {
      logger.info(
        `Session restart triggered | ops: ${this.operationCount}/${this.maxOperationsPerSession} | ` +
        `time: ${elapsedMins}mins/${Math.round(this.maxSessionDurationMs / 60000)}mins | ` +
        `reason: ${operationThresholdHit ? 'operation count' : 'time limit'}`
      );
      
      await this.restart();
    } else if (this.operationCount % 50 === 0) {
      // Log progress every 50 operations
      logger.debug(
        `Session health | ops: ${this.operationCount}/${this.maxOperationsPerSession} | ` +
        `time: ${elapsedMins}mins`
      );
    }
  }

  /**
   * Gracefully restart browser session with cached cookies
   * Closes current browser and reinitializes with Discord authentication preserved
   */
  async restart() {
    if (this.isRestarting) {
      logger.warn('Restart already in progress');
      return;
    }

    this.isRestarting = true;
    const startTime = Date.now();

    try {
      logger.info('Starting graceful session restart...');

      // Step 1: Close existing browser
      if (this.browser) {
        try {
          await this.browser.close();
          logger.debug('Previous browser instance closed');
        } catch (error) {
          logger.warn('Error closing browser', { error: error.message });
        }
      }

      // Step 2: Reset state
      this.browser = null;
      this.page = null;

      // Step 3: Relaunch browser
      const launchSuccess = await this.launch();
      if (!launchSuccess) {
        throw new Error('Browser relaunch failed');
      }

      // Step 4: Restore cookies (instant reconnection)
      logger.debug('Restoring Discord session from cached cookies...');
      const cookiesLoaded = await this.loadCookies();
      
      if (!cookiesLoaded) {
        logger.error('No cached cookies found - will require fresh login');
        // Note: If no cookies, caller should handle fresh login
        this.isLoggedIn = false;
      } else {
        // Step 5: Navigate to Discord with cookies
        try {
          await this.page.goto('https://discord.com/channels/@me', {
            waitUntil: 'domcontentloaded',
          });
          
          // Verify we're actually logged in
          const isAuthenticated = await this.page.evaluate(() => {
            return document.querySelector('[class*="guilds"]') !== null;
          });

          if (isAuthenticated) {
            this.isLoggedIn = true;
            logger.info('Discord session restored from cookies');
          } else {
            logger.warn('Cookie restore failed - user not authenticated');
            this.isLoggedIn = false;
          }
        } catch (navError) {
          logger.error('Failed to navigate after cookie restore', {
            error: navError.message
          });
          this.isLoggedIn = false;
        }
      }

      // Step 6: Reset session tracking
      this.resetSessionTracking();

      const restartDuration = Date.now() - startTime;
      logger.info(
        `Session restart completed successfully | ` +
        `duration: ${restartDuration}ms | ` +
        `new session started`
      );

    } catch (error) {
      logger.error('Session restart failed', {
        error: error.message,
        duration: Date.now() - startTime
      });
      // Set flag to indicate restart failed - caller should handle
      this.isLoggedIn = false;
    } finally {
      this.isRestarting = false;
    }
  }
}
