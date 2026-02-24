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
   * Generate response using proxy server (Cloudflare Workers)
   * Proxy forwards to Gemini/OpenAI with your API keys
   */
  async generateResponse(userMessage, systemPrompt) {
    try {
      // SAFEGUARD: Check user message first
      if (this.isUnderage(userMessage) || this.isIllegalRequest(userMessage)) {
        logger.warn(`⚠️  Blocked unsafe user message from reaching AI: "${userMessage}"`);
        return null; // Let message handler deal with it
      }

      const proxyUrl = process.env.API_PROXY_URL;
      if (!proxyUrl) {
        logger.error('❌ API_PROXY_URL not configured in .env');
        return null;
      }

      logger.info(`Making AI request via proxy: ${proxyUrl}`);

      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessage, systemPrompt }),
      });

      if (!response.ok) {
        logger.error(`❌ Proxy error: ${response.status}`);
        return null;
      }

      const data = await response.json();
      
      if (data.error) {
        logger.error(`❌ API error from proxy: ${data.error}`);
        logger.error(`❌ No API keys available. Add more credits or generate new API key.`);
        return null;
      }

      let responseText = data.response;

      // SAFEGUARD: Check AI response for illegal content
      if (this.isIllegalResponse(responseText)) {
        logger.warn(`⚠️  AI generated unsafe response, rejecting: "${responseText}"`);
        return null; // Reject the response
      }

      return responseText;

    } catch (error) {
      logger.error(`❌ API connection failed - ${error.message}`);
      logger.error(`❌ No API keys available. Add more credits or generate new API key.`);
      return null;
    }
  }

  /**
   * Validate if AI response is good enough (not too dry/generic)
   */
  isGoodResponse(response, userMessage) {
    if (!response || response.length < 3) {
      return false;
    }

    const lower = response.toLowerCase();
    const userLower = userMessage.toLowerCase();

    // Flag: Too many question marks (asking back)
    if ((lower.match(/\?/g) || []).length > 1) {
      return false;
    }

    // Flag: Response is just "ok" or "sure" or "yeah" (too minimal)
    if (/^(ok|sure|yeah|yep|nope|nah)$/i.test(response)) {
      return false;
    }

    // Flag: Generic responses (too dry)
    const genericPhrases = ['sounds good', 'that sounds', 'that is', 'that\'s', 'nice', 'okay', 'i see', 'interesting'];
    if (genericPhrases.some(phrase => lower.includes(phrase) && lower.length < 30)) {
      return false;
    }

    // Flag: Just repeating user's words back without adding anything
    const words = userLower.split(/\s+/).filter(w => w.length > 3);
    const repetitionCount = words.filter(w => lower.includes(w)).length;
    if (repetitionCount > words.length * 0.6 && lower.length < 25) {
      return false;
    }

    return true;
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
   * SAFEGUARD: Detect if user claims to be underage (under 18)
   */
  isUnderage(message) {
    if (!message) return false;
    const lower = message.toLowerCase();
    
    // Check for explicit age claims under 18
    const underage = /\b(im|i'm|i am|age|years old|yo|year old)\s+(\d{1,2})/i;
    const match = message.match(underage);
    
    if (match) {
      const age = parseInt(match[2]);
      if (age < 18) {
        logger.warn(`Detected underage claim: ${age} years old`);
        return true;
      }
    }

    // Check for direct statements
    const underageKeywords = [
      'im 13', 'im 14', 'im 15', 'im 16', 'im 17',
      "i'm 13", "i'm 14", "i'm 15", "i'm 16", "i'm 17",
      'age 13', 'age 14', 'age 15', 'age 16', 'age 17',
      '13 years old', '14 years old', '15 years old', '16 years old', '17 years old',
      '13 yo', '14 yo', '15 yo', '16 yo', '17 yo',
      'underage', 'minor', 'i am a minor'
    ];

    return underageKeywords.some(kw => lower.includes(kw));
  }

  /**
   * SAFEGUARD: Detect illegal/harmful user requests
   */
  isIllegalRequest(message) {
    if (!message) return false;
    const lower = message.toLowerCase();

    // Illegal/harmful keywords - ONLY ACTUAL CRIMES, not slang or terms of endearment
    const illegalKeywords = [
      'drug',
      'cocaine',
      'heroin',
      'meth',
      'crack',
      'weed supplier',
      'sell drug',
      'buy drug',
      'kill',
      'murder',
      'shoot',
      'stab',
      'harm you',
      'hurt you',
      'rape',
      'assault',
      'weapon',
      'gun',
      'knife',
      'bomb',
      'money transfer',
      'send money',
      'bank account',
      'credit card',
      'payment method',
      'prostitute',
      'escort',
      'blackmail',
      'extortion',
      'threaten',
      'threat',
      'fake id',
      'counterfeit'
    ];

    return illegalKeywords.some(kw => lower.includes(kw));
  }

  /**
   * SAFEGUARD: Check if AI response contains illegal/harmful content
   */
  isIllegalResponse(response) {
    if (!response) return false;
    const lower = response.toLowerCase();

    // AI should never mention these actual illegal things
    const illegalResponseKeywords = [
      'sell drug',
      'buy drug',
      'kill',
      'murder',
      'shoot',
      'stab',
      'i will harm',
      'i will hurt',
      'rape',
      'assault',
      'weapon',
      'gun',
      'bomb',
      'money transfer to',
      'send me money',
      'your bank account',
      'your credit card',
      'prostitute',
      'escort service',
      'blackmail',
      'extortion'
    ];

    return illegalResponseKeywords.some(kw => lower.includes(kw));
  }

  /**
   * Get provider status
   */
  getStatus() {
    return this.providerFactory.getStatus();
  }
}
