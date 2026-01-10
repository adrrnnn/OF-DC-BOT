import { GoogleGenerativeAI } from '@google/generative-ai';
import { APIManager } from './api-manager.js';
import { logger } from './logger.js';

/**
 * AI Handler - Uses Gemini FREE tier for response generation
 * Strategy: Only called when template/intent matching fails
 * Uses APIManager for smart key rotation and rate limit handling
 */
export class AIHandler {
  constructor() {
    this.apiManager = new APIManager();
    this.clientMap = new Map(); // Map of key -> GoogleGenerativeAI client
    
    // Initialize clients for each key
    this.apiManager.keys.forEach(key => {
      this.clientMap.set(key, new GoogleGenerativeAI(key));
    });

    if (this.apiManager.keys.length === 0) {
      logger.warn('No Gemini API keys - using templates only');
    } else {
      logger.info(`AI ready: ${this.apiManager.keys.length} Gemini key(s)`);
      logger.info('API rotation enabled - will switch keys if rate limited');
    }
  }

  /**
   * Generate response using Gemini with smart key rotation
   */
  async generateResponse(userMessage, systemPrompt) {
    // No keys? Use fallback
    if (!this.apiManager.hasAvailableKeys()) {
      logger.warn('No available API keys - using fallback');
      return this.getFallbackResponse();
    }

    try {
      // Get next available key
      const apiKey = this.apiManager.getNextKey();
      if (!apiKey) {
        logger.error('All API keys exhausted');
        return this.getFallbackResponse();
      }

      const client = this.clientMap.get(apiKey);
      if (!client) {
        logger.error('Client not found for API key');
        return this.getFallbackResponse();
      }

      const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });

      const prompt = `${systemPrompt}

User says: "${userMessage}"

Respond as Yuki in 1-2 short sentences. Be flirty and playful. Use :3 :p hehe. Never explicit - tease only.`;

      logger.info(`Making AI request (key ${this.apiManager.currentKeyIndex + 1}/${this.apiManager.keys.length})`);
      
      const result = await model.generateContent(prompt);
      let response = result.response.text().trim();

      // Clean response
      response = response
        .replace(/^(Yuki:|Assistant:|Bot:)\s*/i, '')
        .replace(/^["']|["']$/g, '')
        .trim();

      // Record successful API call
      this.apiManager.recordSuccess();
      
      return response;

    } catch (error) {
      // Record the error
      this.apiManager.recordError(error);
      
      logger.warn(`AI error: ${error.message}`);
      return this.getFallbackResponse();
    }
  }

  /**
   * Fallback responses (no API needed)
   */
  getFallbackResponse() {
    const fallbacks = [
      'hehe thats interesting :3',
      'ooo really? tell me more hehe',
      'hahaha youre funny :p',
      'hmm maybe :3',
      'aww hehe',
      'lol wdym :p',
      'hehe youre sweet :3'
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }
}
