import { GoogleGenerativeAI } from '@google/generative-ai';
import { APIManager } from './api-manager.js';
import { AIProviderFactory } from './ai-provider.js';
import { logger } from './logger.js';
import fs from 'fs';
import path from 'path';

/**
 * AI Handler - Multi-provider support (Gemini + GPT Nano)
 * Strategy: Only called when template/intent matching fails
 * Uses AIProviderFactory for automatic provider selection and fallback
 */
export class AIHandler {
  constructor() {
    this.apiManager = new APIManager();
    
    // Get GPT Nano key if available
    const gptNanoKey = process.env.GPT_NANO_API_KEY || null;
    
    // Initialize provider factory with both providers
    this.providerFactory = new AIProviderFactory(this.apiManager, gptNanoKey);
    this.trainingExamples = this.loadTrainingExamples();
    
    logger.info(`AI Handler initialized`);
    if (this.apiManager.geminiKeys.length === 0) {
      logger.warn('No Gemini API keys - using templates only');
    } else {
      logger.info(`Primary: Gemini (${this.apiManager.geminiKeys.length} keys)`);
    }
    if (gptNanoKey) {
      logger.info(`Fallback: GPT Nano ✓`);
    } else {
      logger.info(`Fallback: GPT Nano (waiting for API key)`);
    }
  }

  /**
   * Load training data examples to use as reference for natural responses
   */
  loadTrainingExamples() {
    const paths = [
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
   * Generate response using multi-provider system
   * Automatically tries Gemini first, falls back to GPT Nano if needed
   */
  async generateResponse(userMessage, systemPrompt) {
    // Check if any provider is available
    const status = this.providerFactory.getStatus();
    if (!status.primary.available && !status.fallback.available) {
      logger.warn('No available AI providers - using fallback');
      return this.getFallbackResponse();
    }

    try {
      // Build natural prompt using training context
      const conversationContext = this.buildConversationContext();
      
      const prompt = `You are responding in a Discord DM conversation. Be natural, casual, and conversational - like texting with a friend.

${conversationContext}

${systemPrompt}

The user just said: "${userMessage}"

Respond naturally in 1-2 short sentences. Keep it casual and friendly, like you're texting.`;

      logger.info(`Making AI request using ${this.providerFactory.getProvider().getName()}`);
      
      // Use provider factory - handles provider selection and fallback
      const response = await this.providerFactory.generateResponse(prompt, systemPrompt);
      
      return response;

    } catch (error) {
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

  /**
   * Get provider status
   */
  getStatus() {
    return this.providerFactory.getStatus();
  }
}
