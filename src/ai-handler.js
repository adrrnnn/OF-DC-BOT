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
    
    // Get OpenAI key if available
    const openaiKey = process.env.OPENAI_API_KEY || null;
    
    // Initialize provider factory with both providers
    this.providerFactory = new AIProviderFactory(this.apiManager, openaiKey);
    this.trainingExamples = this.loadTrainingExamples();
    
    logger.info(`AI Handler initialized`);
    if (this.apiManager.geminiKeys.length === 0) {
      logger.warn('No Gemini API keys - using templates only');
    } else {
      logger.info(`Primary: Gemini (${this.apiManager.geminiKeys.length} keys)`);
    }
    if (openaiKey) {
      logger.info(`Fallback: OpenAI ✓`);
    } else {
      logger.info(`Fallback: OpenAI (waiting for API key)`);
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
    try {
      // Build natural prompt using training context
      const conversationContext = this.buildConversationContext();
      
      const prompt = `You are responding in a Discord DM conversation. Be natural, casual, and conversational - like texting with a friend.

${conversationContext}

${systemPrompt}

The user just said: "${userMessage}"

Respond naturally in 1-2 short sentences. Keep it casual and friendly, like you're texting.`;

      const provider = this.providerFactory.getProvider();
      
      if (!provider) {
        logger.warn('No AI providers available - using contextual fallback');
        return this.getContextualFallbackResponse(userMessage);
      }

      logger.info(`Making AI request using ${provider.getName()}`);
      
      // Use the provider to generate response
      const response = await provider.generateResponse(prompt, systemPrompt);
      return response;

    } catch (error) {
      logger.warn(`AI error (${error.message.substring(0, 100)}) - attempting OpenAI...`);
      
      // If first attempt failed, force try OpenAI directly
      if (this.providerFactory.gptNanoProvider && this.providerFactory.gptNanoProvider.isAvailable()) {
        try {
          logger.info(`Forcing OpenAI fallback...`);
          const prompt = `You are a real flirty girl on Discord. Read what they're actually asking and respond to it directly. Keep responses 1-2 short sentences. Use lowercase, casual texting with emojis (hehe, lol, 💕, 😊, 😏, etc). Match their energy and tone. Be playful and flirty but ALWAYS address what they asked. The user just said: "${userMessage}". Respond naturally.`;
          const response = await this.providerFactory.gptNanoProvider.generateResponse(prompt, systemPrompt);
          logger.info(`✅ OpenAI succeeded after Gemini failed`);
          return response;
        } catch (openaiError) {
          logger.warn(`OpenAI also failed: ${openaiError.message.substring(0, 100)}`);
        }
      }
      
      return this.getContextualFallbackResponse(userMessage);
    }
  }

  /**
   * Contextual fallback responses based on user message
   */
  getContextualFallbackResponse(userMessage) {
    const msg = userMessage.toLowerCase();
    
    // Greetings
    if (/^(hi|hey|hello|hii|hiii|heyy|heyyy|yo|sup|wassup|whats up|what's up|how u|hru)/.test(msg)) {
      return ['hiii 💕', 'hey there 😊', 'whats up', 'hiiii', 'heyyy cutie', 'yo 😏'][Math.floor(Math.random() * 6)];
    }
    
    // Questions
    if (/\?/.test(msg)) {
      return ['tell me more hehe', 'ooh interesting 😊', 'i like that 💕', 'hehe yeah 😏'][Math.floor(Math.random() * 4)];
    }
    
    // Flirty/sexual content
    if (/(trade|pics|pic|nudes|meet|hook up|horny|sexy|cum)/.test(msg)) {
      return ['hmm depends hehe', 'interesting 😏', 'tell me more', 'ooh i like where this is going 😊'][Math.floor(Math.random() * 4)];
    }
    
    // Default casual responses
    return ['hehe sounds cool 💕', 'nice tell me about it', 'ooh tell me more 😊', 'hehe yeah 😏'][Math.floor(Math.random() * 4)];
  }

  /**
   * Fallback responses (no API needed) - should match template style
   */
  getFallbackResponse() {
    const fallbacks = [
      'hiii 💕',
      'hey there 😊',
      'whats up',
      'hiiii',
      'heyyy cutie',
      'yo 😏',
      'heyy whatchu up to',
      'tell me more hehe',
      'nice tell me about it',
      'thats cool tell me more',
      'interesting hehe',
      'ooh tell me more 😊'
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
