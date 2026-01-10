import { logger } from './logger.js';

/**
 * API Manager - Handles API key rotation and rate limit tracking
 * 
 * Strategy: Minimize API calls by using templates/intent first
 * Only call Gemini when absolutely necessary
 * Rotate between 3 free tier keys to maximize quota
 */
export class APIManager {
  constructor() {
    // Load API keys from env
    this.keys = [
      process.env.GEMINI_API_KEY_1,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3
    ].filter(key => key && key.length > 0);

    if (this.keys.length === 0) {
      logger.warn('No Gemini API keys found in .env');
    }

    // Track usage per key
    this.keyStats = this.keys.map((key, index) => ({
      index: index,
      key: key,
      requests: 0,
      errors: 0,
      lastUsed: null,
      rateLimited: false,
      quotaExhausted: false
    }));

    // Current key index
    this.currentKeyIndex = 0;
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.lastRotation = Date.now();
  }

  /**
   * Get next available API key
   * Rotates to next key if current is rate limited or quota exhausted
   */
  getNextKey() {
    if (this.keys.length === 0) {
      logger.error('No API keys available');
      return null;
    }

    // Check if current key is viable
    const currentKey = this.keyStats[this.currentKeyIndex];
    if (!currentKey.rateLimited && !currentKey.quotaExhausted) {
      return currentKey.key;
    }

    // Find next viable key
    for (let i = 0; i < this.keyStats.length; i++) {
      const stat = this.keyStats[i];
      if (!stat.rateLimited && !stat.quotaExhausted) {
        logger.info(`Rotating API key: ${this.currentKeyIndex} → ${i}`);
        this.currentKeyIndex = i;
        this.lastRotation = Date.now();
        return stat.key;
      }
    }

    // All keys exhausted
    logger.error('All API keys rate limited or quota exhausted');
    return null;
  }

  /**
   * Record successful API call
   */
  recordSuccess(keyIndex = this.currentKeyIndex) {
    if (keyIndex < this.keyStats.length) {
      this.keyStats[keyIndex].requests++;
      this.keyStats[keyIndex].lastUsed = Date.now();
      this.totalRequests++;

      // Log every 10th request
      if (this.totalRequests % 10 === 0) {
        logger.info(`Total API requests: ${this.totalRequests}`);
        this.logKeyStats();
      }
    }
  }

  /**
   * Record API error/rate limit
   */
  recordError(error, keyIndex = this.currentKeyIndex) {
    if (keyIndex >= this.keyStats.length) return;

    const stat = this.keyStats[keyIndex];
    stat.errors++;
    this.totalErrors++;

    // Detect rate limit vs other errors
    const errorMsg = error.message?.toLowerCase() || '';
    
    if (errorMsg.includes('429') || errorMsg.includes('rate limit') || 
        errorMsg.includes('quota') || errorMsg.includes('too many')) {
      stat.rateLimited = true;
      logger.warn(`API key ${keyIndex} rate limited. Rotating...`);
      
      // Try to use next key
      if (this.keys.length > 1) {
        this.getNextKey();
      }
    }

    if (errorMsg.includes('quota') || errorMsg.includes('exhausted')) {
      stat.quotaExhausted = true;
      logger.error(`API key ${keyIndex} quota exhausted`);
    }

    logger.error(`API Error on key ${keyIndex}: ${error.message}`);
  }

  /**
   * Log current key statistics
   */
  logKeyStats() {
    logger.info('=== API Key Statistics ===');
    this.keyStats.forEach((stat, index) => {
      const status = stat.quotaExhausted ? 'EXHAUSTED' : 
                     stat.rateLimited ? 'RATE LIMITED' : 'ACTIVE';
      logger.info(`Key ${index}: ${stat.requests} requests, ${stat.errors} errors [${status}]`);
    });
    logger.info(`Total: ${this.totalRequests} requests, ${this.totalErrors} errors`);
  }

  /**
   * Check if API is available for use
   */
  hasAvailableKeys() {
    return this.keyStats.some(stat => !stat.quotaExhausted && !stat.rateLimited);
  }

  /**
   * Get status report
   */
  getStatus() {
    return {
      totalKeys: this.keys.length,
      activeKeys: this.keyStats.filter(s => !s.quotaExhausted && !s.rateLimited).length,
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      currentKeyIndex: this.currentKeyIndex,
      keyStats: this.keyStats.map(s => ({
        index: s.index,
        requests: s.requests,
        errors: s.errors,
        status: s.quotaExhausted ? 'exhausted' : s.rateLimited ? 'rate_limited' : 'active'
      }))
    };
  }
}
