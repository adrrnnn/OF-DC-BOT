import { logger } from './logger.js';

/**
 * API Manager - Handles API key rotation and rate limit tracking
 * 
 * Strategy:
 * 1. Try Gemini first (free tier with rotation)
 * 2. Fall back to GPT Nano when Gemini exhausted
 * 3. Minimize API calls by using templates/intent first
 * 4. Only call AI when absolutely necessary
 */
export class APIManager {
  constructor() {
    // Load Gemini keys (free tier rotation)
    this.geminiKeys = [
      process.env.GEMINI_API_KEY_1,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3
    ].filter(key => key && key.length > 0);

    // Load GPT Nano key (fallback provider)
    this.gptNanoKey = process.env.OPENAI_API_KEY || null;

    // Track Gemini usage (MUST be initialized before logging)
    this.geminiStats = this.geminiKeys.map((key, index) => ({
      index: index,
      key: key,
      requests: 0,
      errors: 0,
      lastUsed: null,
      rateLimited: false,
      quotaExhausted: false
    }));

    if (this.geminiKeys.length === 0) {
      logger.warn('No Gemini API keys found - will use templates only until GPT Nano available');
    } else {
      logger.info(`✅ Gemini: ${this.geminiKeys.length} key(s) loaded`);
      this.geminiStats.forEach((stat, i) => {
        logger.info(`   Key ${i + 1}: Ready`);
      });
    }

    if (this.gptNanoKey) {
      logger.info('OpenAI: Available (will use as fallback)');
    } else {
      logger.warn('OpenAI: Not configured (add OPENAI_API_KEY to .env to enable)');
    }

    // Track which provider is active
    this.currentProvider = 'gemini'; // 'gemini' or 'gpt_nano'
    this.currentGeminiKeyIndex = 0;
    this.totalRequests = 0;
    this.totalErrors = 0;
  }

  /**
   * Get next available Gemini key or fallback to GPT Nano
   */
  getNextKey() {
    // Try Gemini first
    if (this.geminiKeys.length > 0) {
      const geminiKey = this.getNextGeminiKey();
      if (geminiKey) {
        this.currentProvider = 'gemini';
        return { key: geminiKey, provider: 'gemini' };
      }
    }

    // Fallback to GPT Nano
    if (this.gptNanoKey) {
      this.currentProvider = 'gpt_nano';
      logger.info('All Gemini keys exhausted - switching to OpenAI');
      return { key: this.gptNanoKey, provider: 'gpt_nano' };
    }

    logger.error('No API keys available (no Gemini, no OpenAI)');
    return null;
  }

  /**
   * Get next available Gemini key
   */
  getNextGeminiKey() {
    if (this.geminiKeys.length === 0) {
      return null;
    }

    const currentKey = this.geminiStats[this.currentGeminiKeyIndex];
    if (!currentKey.rateLimited && !currentKey.quotaExhausted) {
      return currentKey.key;
    }

    for (let i = 0; i < this.geminiStats.length; i++) {
      const stat = this.geminiStats[i];
      if (!stat.rateLimited && !stat.quotaExhausted) {
        logger.info(`🔄 Rotating Gemini key: ${this.currentGeminiKeyIndex} → ${i} (Key ${i + 1})`);
        this.currentGeminiKeyIndex = i;
        return stat.key;
      }
    }

    logger.warn('All Gemini keys rate limited or quota exhausted');
    return null;
  }

  /**
   * Record successful API call
   */
  recordSuccess() {
    if (this.currentProvider === 'gemini' && this.currentGeminiKeyIndex < this.geminiStats.length) {
      const stat = this.geminiStats[this.currentGeminiKeyIndex];
      stat.requests++;
      stat.lastUsed = Date.now();
      this.totalRequests++;

      if (this.totalRequests % 10 === 0) {
        logger.info(`Total API requests: ${this.totalRequests}`);
        this.logStatus();
      }
    }
  }

  /**
   * Record API error/rate limit
   */
  recordError(error) {
    if (this.currentProvider !== 'gemini') {
      logger.warn(`${this.currentProvider} error: ${error.message}`);
      return;
    }

    if (this.currentGeminiKeyIndex >= this.geminiStats.length) return;

    const stat = this.geminiStats[this.currentGeminiKeyIndex];
    stat.errors++;
    this.totalErrors++;

    const errorMsg = error.message?.toLowerCase() || '';
    
    if (errorMsg.includes('429') || errorMsg.includes('rate limit') || 
        errorMsg.includes('quota') || errorMsg.includes('too many')) {
      stat.rateLimited = true;
      logger.warn(`Gemini key ${this.currentGeminiKeyIndex} rate limited`);
    }

    if (errorMsg.includes('quota') || errorMsg.includes('exhausted')) {
      stat.quotaExhausted = true;
      logger.error(`Gemini key ${this.currentGeminiKeyIndex} quota exhausted`);
    }

    logger.error(`Gemini error on key ${this.currentGeminiKeyIndex}: ${error.message}`);
  }

  /**
   * Log current status
   */
  logStatus() {
    logger.info('=== API Status ===');
    logger.info(`Primary: Gemini (${this.geminiKeys.length} keys)`);
    this.geminiStats.forEach((stat, index) => {
      const status = stat.quotaExhausted ? 'EXHAUSTED' : 
                     stat.rateLimited ? 'RATE LIMITED' : 'ACTIVE';
      logger.info(`  Key ${index}: ${stat.requests} requests, ${stat.errors} errors [${status}]`);
    });
    logger.info(`Fallback: GPT Nano ${this.gptNanoKey ? '✓' : '✗'}`);
    logger.info(`Total requests: ${this.totalRequests}`);
  }

  /**
   * Check if any API is available
   */
  hasAvailableKeys() {
    const hasGemini = this.geminiStats.some(s => !s.quotaExhausted && !s.rateLimited);
    return hasGemini || !!this.gptNanoKey;
  }

  /**
   * Get status report
   */
  getStatus() {
    return {
      geminiKeys: this.geminiKeys.length,
      activeGeminiKeys: this.geminiStats.filter(s => !s.quotaExhausted && !s.rateLimited).length,
      gptNanoAvailable: !!this.gptNanoKey,
      currentProvider: this.currentProvider,
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors
    };
  }
}
