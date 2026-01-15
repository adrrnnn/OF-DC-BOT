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
   * Navigate to friends list (home)
   */
  async navigateToFriendsList() {
    try {
      await this.page.goto('https://discord.com/channels/@me', {
        waitUntil: 'domcontentloaded',
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
          waitUntil: 'domcontentloaded',
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
   * Open DM with user
   */
  async openDM(userId) {
    try {
      // Instead of goto(), click the DM link in the sidebar
      // This is more reliable than direct navigation
      const clicked = await this.page.evaluate((userId) => {
        const link = document.querySelector(`a[href*="/channels/@me/${userId}"]`);
        if (link) {
          link.click();
          return true;
        }
        return false;
      }, userId);
      
      if (!clicked) {
        logger.warn(`DM link not found in sidebar for ${userId}, trying direct navigation`);
        // Fallback to goto if link not found
        await this.page.goto(`https://discord.com/channels/@me/${userId}`, {
          waitUntil: 'domcontentloaded',
          timeout: 10000, // Add explicit timeout
        });
      }
      
      // Wait for page to settle after click/navigation
      await new Promise(r => setTimeout(r, 1000));
      
      // Wait for messages to be visible - use a retry loop to ensure articles load
      logger.debug('Waiting for article elements to load...');
      let articlesLoaded = false;
      let waitAttempts = 0;
      const maxAttempts = 10; // Try for up to 5 seconds (10 * 500ms)
      
      while (!articlesLoaded && waitAttempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 500));
        
        const articleCount = await this.page.evaluate(() => {
          return document.querySelectorAll('[role="article"]').length;
        });
        
        logger.debug(`Article check ${waitAttempts + 1}/${maxAttempts}: found ${articleCount} articles`);
        
        if (articleCount > 0) {
          articlesLoaded = true;
          logger.debug('Articles loaded successfully');
        }
        
        waitAttempts++;
      }
      
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
            let author = 'Unknown';
            let content = '';
            
            // Get all text from the article
            const fullText = article.textContent?.trim() || '';
            
            if (!fullText || fullText.length < 3) {
              debug.errors.push('Empty or too short message');
              continue;
            }
            
            // Split by lines and filter empty lines
            const lines = fullText.split('\n')
              .map(l => l.trim())
              .filter(l => l.length > 0);
            
            if (lines.length === 0) continue;
            
            // Extract author from message header - CRITICAL FIX
            // Discord uses specific DOM structure for usernames
            const authorElement = article.querySelector('[class*="username"], [class*="author"], span[role="heading"]') ||
                                 article.querySelector('span[class*="userName"]') ||
                                 article.querySelector('[class*="headerText"]');
            
            if (authorElement?.textContent) {
              author = authorElement.textContent.trim();
            } else {
              // Fallback: extract from first line (more reliable than before)
              const firstLine = lines[0];
              // Look for username before timestamp separator (handles both — and em dash)
              const match = firstLine.match(/^([^——\d\[\]]+?)(?:—|—|$)/);
              if (match && match[1].trim().length > 0 && match[1].trim() !== 'четверг' && !/^[а-яё\s]+$/i.test(match[1].trim())) {
                author = match[1].trim();
              } else {
                // If no separator, take first meaningful word (skip timestamps and date words)
                const words = firstLine.split(/[\s—]+/).filter(w => {
                  // Skip timestamps (HH:MM format)
                  if (/^\d{1,2}:\d{2}/.test(w)) return false;
                  // Skip day of week and date markers (with optional punctuation like comma)
                  if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)[,\.]?$/i.test(w)) return false;
                  // Skip months in Russian/English (with optional punctuation)
                  if (/^(January|February|March|April|May|June|July|August|September|October|November|December|января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)[,\.]?$/i.test(w)) return false;
                  // Skip years
                  if (/^\d{4}$/.test(w)) return false;
                  // Skip г. (Russian abbreviation for "year")
                  if (/^г\.?$/.test(w)) return false;
                  // Skip в. (Russian abbreviation for "at/in")
                  if (/^в\.?$/.test(w)) return false;
                  // Skip brackets with times like [21:05]
                  if (/^\[\d{1,2}:\d{2}\]$/.test(w)) return false;
                  return true;
                });
                if (words.length > 0) {
                  author = words[0];
                }
              }
            }
            
            // Skip if author is still unknown or empty
            if (!author || author === 'Unknown' || author.length === 0) {
              debug.errors.push('Could not extract author');
              continue;
            }
            
            // Find actual message content by skipping metadata
            // CRITICAL FIX: Remove Discord UI button text and React menu items
            for (let i = lines.length - 1; i >= 0; i--) {
              let line = lines[i];
              
              // Skip timestamps like "15:09", "15:11", "19:36", "19:37"
              if (/^\d{1,2}:\d{2}/.test(line)) continue;
              
              // Skip dates in Russian or English
              if (/^\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December|января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i.test(line)) continue;
              
              // Skip day of week (Russian: понедельник, вторник, etc.)
              if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье|[а-я]{9,})/i.test(line)) continue;
              
              // Skip lines with only emoji or formatting
              if (/^[—\[\]◉○●\d:]+$/.test(line)) continue;
              
              // Skip lines that look like author info
              if (line === author) continue;
              
              // CRITICAL: Remove Discord UI elements - button text, emoji reactions, menus
              // Pattern: :emoji_name:Текст:emoji_name:Текст... (Discord reaction buttons)
              line = line.replace(/:[^\s:]+:(?:Нажмите|Click|Add).*?(?=:[^\s:]+:|$)/gi, '');
              
              // Remove React menu items: "Изменить", "Переслать", "Удалить", "Edit", "Forward", "Delete"
              line = line.replace(/\b(Изменить|Переслать|Удалить|Скопировать|Ответить|Edit|Forward|Delete|Copy|Reply|More|Ещё)\b/gi, '');
              
              // Remove emoji pattern like :thumbsup:, :thumbsdown:, :100:, etc
              line = line.replace(/:[a-z0-9_+-]+:/gi, '');
              
              // Remove "Нажмите, чтобы отреагировать" (Click to react text)
              line = line.replace(/Нажмите,?\s*чтобы\s+отреагировать/gi, '');
              
              // Remove "Добавить реакцию" (Add reaction)
              line = line.replace(/Добавить\s+реакцию/gi, '');
              
              // Clean up extra whitespace
              line = line.replace(/\s+/g, ' ').trim();
              
              // Found the actual message if there's content left
              if (line.length > 1) {
                content = line;
                break;
              }
            }
            
            // Fallback: if no content found, use the last non-empty line that's not metadata
            if (!content && lines.length > 1) {
              for (let i = lines.length - 1; i >= 1; i--) {
                let line = lines[i];
                
                // Clean UI elements first
                line = line.replace(/:[^\s:]+:(?:Нажмите|Click|Add).*?(?=:[^\s:]+:|$)/gi, '');
                line = line.replace(/\b(Изменить|Переслать|Удалить|Скопировать|Ответить|Edit|Forward|Delete|Copy|Reply|More|Ещё)\b/gi, '');
                line = line.replace(/:[a-z0-9_+-]+:/gi, '');
                line = line.replace(/Нажмите,?\s*чтобы\s+отреагировать/gi, '');
                line = line.replace(/Добавить\s+реакцию/gi, '');
                line = line.replace(/\s+/g, ' ').trim();
                
                if (line.length > 2 && line !== author && !/^\d{1,2}:\d{2}/.test(line)) {
                  content = line;
                  break;
                }
              }
            }
            
            // Clean up content - remove leading author name if present
            if (content && content.startsWith(author)) {
              content = content.substring(author.length).replace(/^[\s—\[\]]+/, '').trim();
            }
            
            // Double-check: if content is only UI text, skip it
            if (content && /^(Нажмите|Click|Edit|Forward|Delete|More|Ещё|Добавить|Изменить|Переслать|Удалить|Скопировать|Ответить|Reply|Copy)/.test(content)) {
              debug.errors.push('Content is only UI text');
              continue;
            }
            
            // Check for OF link in the message content
            const hasOFLink = /onlyfans|of\s*link|my\s*link|check\s*me\s*out/i.test(content + ' ' + fullText);
            
            // Only add if we have meaningful content
            if (content && content.length > 2) {
              msgs.push({ author, content, hasOFLink });
              debug.messagesExtracted++;
            }
          } catch (e) {
            debug.errors.push(`Error: ${e.message}`);
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
