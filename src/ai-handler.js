import { GoogleGenerativeAI } from '@google/generative-ai';
import { APIManager } from './api-manager.js';
import { logger } from './logger.js';
import fs from 'fs';
import path from 'path';

/**
 * AI Handler - Uses Gemini FREE tier for response generation
 * Strategy: Only called when template/intent matching fails
 * Uses APIManager for smart key rotation and rate limit handling
 */
export class AIHandler {
  constructor() {
    this.apiManager = new APIManager();
    this.clientMap = new Map(); // Map of key -> GoogleGenerativeAI client
    this.trainingExamples = this.loadTrainingExamples();
    
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
   * Load training data examples to use as reference for natural responses
   */
  loadTrainingExamples() {
    const paths = [
      path.join(process.cwd(), 'Bot', 'config', 'training-data.json'),
      path.join(process.cwd(), 'config', 'training-data.json'),
      path.join(process.cwd(), 'training-data.json')
    ];

    for (const filePath of paths) {
      if (fs.existsSync(filePath)) {
        try {
          const data = fs.readFileSync(filePath, 'utf8');
          const parsed = JSON.parse(data);
          return parsed.conversation_examples || [];
        } catch (error) {
          logger.warn(`Failed to load training data from ${filePath}: ${error.message}`);
        }
      }
    }

    logger.warn('No training examples found for AI context');
    return [];
  }

  /**
   * Build conversation context from training examples
   */
  buildConversationContext() {
    if (this.trainingExamples.length === 0) {
      return '';
    }

    const examples = this.trainingExamples.slice(0, 5).map(example => {
      const response = example.good_responses[0] || 'Ok';
      return `When user says: "${example.user_message}"\nRespond like: "${response}"`;
    }).join('\n\n');

    return `Reference conversation style:\n${examples}\n`;
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

      // Build natural prompt using training context
      const conversationContext = this.buildConversationContext();
      
      const prompt = `You are responding in a Discord DM conversation. Be natural, casual, and conversational - like texting with a friend.

${conversationContext}

${systemPrompt}

The user just said: "${userMessage}"

Respond naturally in 1-2 short sentences. Keep it casual and friendly, like you're texting.`;

      logger.info(`Making AI request (key ${this.apiManager.currentKeyIndex + 1}/${this.apiManager.keys.length})`);
      
      const result = await model.generateContent(prompt);
      let response = result.response.text().trim();

      // Clean response
      response = response
        .replace(/^(Yuki:|Assistant:|Bot:|You:|Me:)\s*/i, '')
        .replace(/^["']|["']$/g, '')
        .replace(/^\*\*|^\*\*|^__|^__/g, '')  // Remove markdown emphasis
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
      'that sounds interesting',
      'oh really? tell me more',
      'haha youre funny',
      'hmm maybe',
      'thats cool',
      'lol what do you mean',
      'youre sweet'
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }
}
