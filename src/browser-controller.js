import puppeteer from 'puppeteer';
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
  }

  /**
   * Launch browser
   */
  async launch() {
    try {
      this.browser = await puppeteer.launch({
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled',
        ],
        defaultViewport: { width: 1920, height: 1080 },
      });

      this.page = await this.browser.newPage();

      // Set realistic user agent
      await this.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      );

      // Disable automation detection
      await this.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      logger.info('Browser launched');
      return true;
    } catch (error) {
      logger.error('Browser launch failed', { error: error.message });
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
   * Login to Discord with 120-second auth/captcha wait
   */
  async login(email, password) {
    try {
      // Skip loading cached cookies - do fresh auth
      // const loaded = await this.loadCookies();
      // if (loaded) {
      //   ... cookie check ...
      // }

      // Go to Discord login
      logger.info('Navigating to Discord login');
      await this.page.goto('https://discord.com/login', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // Enter credentials
      await this.page.waitForSelector('input[name="email"]', { timeout: 10000 });
      await this.page.type('input[name="email"]', email, { delay: 50 });

      await this.page.waitForSelector('input[name="password"]', { timeout: 10000 });
      await this.page.type('input[name="password"]', password, { delay: 50 });

      // Click login
      await this.page.click('button[type="submit"]');

      // Wait up to 120 seconds for user to complete captcha/2FA
      logger.info('Waiting for captcha/2FA (120 seconds)');
      
      let authenticated = false;
      for (let i = 0; i < 60; i++) {
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

      if (!authenticated) {
        throw new Error('Login timeout - captcha/2FA not completed');
      }

      this.isLoggedIn = true;
      await this.saveCookies();
      
      // Extract bot's own username from logged-in account
      this.botUsername = await this.getBotUsername();
      if (this.botUsername) {
        logger.info(`Detected bot username: ${this.botUsername}`);
      }
      
      return true;
    } catch (error) {
      logger.error('Login failed', { error: error.message });
      this.isLoggedIn = false;
      return false;
    }
  }

  /**
   * Get the bot's own username from the logged-in Discord account
   */
  async getBotUsername() {
    try {
      const username = await this.page.evaluate(() => {
        // Try to get username from user settings or profile
        // Discord stores username in several places - try them all
        
        // Method 1: Look for the current user indicator in DMs
        const userIndicator = document.querySelector('[aria-label*="Direct Messages"], [class*="currentUser"]');
        if (userIndicator?.textContent) {
          const text = userIndicator.textContent.trim();
          if (text && text.length > 0 && text !== 'Direct Messages') {
            return text;
          }
        }
        
        // Method 2: Check user menu dropdown
        const userMenu = document.querySelector('[class*="userMenu"], [class*="header"]');
        if (userMenu) {
          const username = userMenu.getAttribute('aria-label');
          if (username && !username.includes('Discord')) {
            return username;
          }
        }
        
        // Method 3: Look for "You" tag in message area (our messages are marked as "You")
        const ownMessages = Array.from(document.querySelectorAll('[role="article"]'))
          .filter(el => el.textContent.includes('You'));
        
        if (ownMessages.length > 0) {
          // Extract author from message header
          const authorSpan = ownMessages[0].querySelector('span[class*="username"], strong');
          if (authorSpan?.previousElementSibling?.textContent) {
            return authorSpan.previousElementSibling.textContent.trim();
          }
        }
        
        return null;
      });

      return username;
    } catch (error) {
      logger.warn('Could not detect bot username:', error.message);
      return null;
    }
  }

  /**
   * Navigate to friends list (home)
   */
  async navigateToFriendsList() {
    try {
      await this.page.goto('https://discord.com/channels/@me', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // Verify we're actually on the friends list page
      await this.page.waitForSelector('nav, [role="navigation"]', { timeout: 5000 }).catch(() => {
        logger.warn('Navigation/sidebar not found on friends list');
      });

      logger.info('Navigated to friends list');
      return true;
    } catch (error) {
      logger.error('Navigation failed', { error: error.message });
      return false;
    }
  }

  /**
   * Get unread DMs - check which ones have new messages we haven't replied to
   */
  async getUnreadDMs() {
    try {
      // Ensure we're on friends list but DON'T navigate (save the sidebar visibility)
      const currentUrl = this.page.url();
      if (!currentUrl.includes('/channels/@me')) {
        // Only navigate if we're not on friends list
        await this.page.goto('https://discord.com/channels/@me', {
          waitUntil: 'networkidle2',
          timeout: 30000,
        });
      }
      
      // Wait for sidebar to fully load with DM list
      await this.page.waitForSelector('a[href*="/channels/@me/"]', { timeout: 5000 }).catch(() => {
        logger.warn('DM sidebar links not found, sidebar may not be loaded');
      });

      await new Promise(r => setTimeout(r, 500));

      // Get all DM links from sidebar using multiple selector strategies
      const dmLinks = await this.page.evaluate(() => {
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
      });

      logger.debug(`Found ${dmLinks.length} total DMs in sidebar (${dmLinks.map(d => d.username).join(', ')})`);

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
      // Try to get back to friends list
      try {
        await this.navigateToFriendsList();
      } catch (e) {
        // Ignore
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
        waitUntil: 'networkidle2',
        timeout: 10000,
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
   * Open DM with user
   */
  async openDM(userId) {
    try {
      await this.page.goto(`https://discord.com/channels/@me/${userId}`, {
        waitUntil: 'networkidle2',
        timeout: 15000,
      });
      
      // Wait for messages to be visible
      await new Promise(r => setTimeout(r, 1500));
      
      // Debug: Check page status
      const pageDebug = await this.page.evaluate(() => {
        return {
          title: document.title,
          url: window.location.href,
          readyState: document.readyState,
          hasArticles: document.querySelectorAll('[role="article"]').length > 0,
          articlesCount: document.querySelectorAll('[role="article"]').length,
          hasChatArea: !!document.querySelector('[role="main"]'),
        };
      });
      logger.debug(`openDM - Page status: ${JSON.stringify(pageDebug)}`);
      
      // Make sure article elements are present
      try {
        await this.page.waitForSelector('[role="article"]', { timeout: 5000 }).catch(() => {
          // It's ok if there are no articles (no messages yet)
        });
      } catch (e) {
        // No messages visible yet, but that's ok
      }
      
      logger.info('Opened DM', { userId });
      return true;
    } catch (error) {
      logger.error('Failed to open DM', { error: error.message });
      return false;
    }
  }

  /**
   * Get messages from current DM
   */
  async getMessages(limit = 2) {
    try {
      logger.debug('Attempting to extract messages from DOM...');
      
      const extractionResult = await this.page.evaluate((limit) => {
        const msgs = [];
        const debug = {
          articlesFound: 0,
          messagesExtracted: 0,
          errors: []
        };
        
        // Get all article elements
        const articles = Array.from(document.querySelectorAll('[role="article"]'));
        debug.articlesFound = articles.length;
        
        if (articles.length === 0) {
          debug.errors.push('No articles found');
          return { messages: msgs, debug };
        }

        // Process last N articles
        for (const article of articles.slice(-limit)) {
          try {
            // Try to find author and message content
            let author = 'Unknown';
            let content = '';
            
            // Look for author in nested elements (Discord uses role="img" for avatar + name)
            const authorLink = article.querySelector('a[href*="/users/"]');
            if (authorLink) {
              author = authorLink.textContent?.trim() || 'Unknown';
            }
            
            // Discord message content is typically in a span or div with the message text
            // Look for common patterns
            const messageContent = article.querySelector('[class*="content"]') || 
                                 article.querySelector('div[class*="message"]') ||
                                 article.querySelector('span[class*="text"]');
            
            if (messageContent) {
              content = messageContent.textContent?.trim() || '';
            }
            
            // If still no content, try getting all text and parsing it
            if (!content || content.length < 3) {
              const allText = article.textContent?.trim() || '';
              if (allText.length > 0) {
                const lines = allText.split('\n')
                  .map(l => l.trim())
                  .filter(l => l.length > 2);
                
                // Try to identify message content (skip timestamps, usernames, etc)
                for (const line of lines) {
                  // Skip obvious metadata
                  if (/^\d{1,2}:\d{2}/.test(line) || /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(line)) {
                    continue;
                  }
                  // Skip obvious usernames (short, no spaces usually)
                  if (line === author || line.length < 3) {
                    continue;
                  }
                  // This is likely the message
                  content = line;
                  break;
                }
              }
            }
            
            // Only add if we have content
            if (content && content.length > 2 && author !== 'Unknown') {
              msgs.push({ author, content });
              debug.messagesExtracted++;
            } else if (content && content.length > 2) {
              // Add even if author is unknown, but we have content
              msgs.push({ author, content });
              debug.messagesExtracted++;
            }
          } catch (e) {
            debug.errors.push(`Error processing article: ${e.message}`);
          }
        }

        return { messages: msgs, debug };
      }, limit);
      
      logger.debug(`Extraction result: articles=${extractionResult.debug.articlesFound}, extracted=${extractionResult.debug.messagesExtracted}, errors=${extractionResult.debug.errors.join('; ')}`);

      const messages = extractionResult.messages;

      if (messages.length === 0) {
        logger.debug('getMessages: No messages extracted - DOM may not have [role="article"] elements loaded');
      } else {
        logger.debug(`getMessages: Extracted ${messages.length} message(s): ${JSON.stringify(messages.slice(0, 2))}`);
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
}
