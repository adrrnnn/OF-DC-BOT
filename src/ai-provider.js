import { logger } from './logger.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { default as OpenAI } from 'openai';

/**
 * Base AI Provider Interface
 */
export class AIProvider {
  constructor(name) {
    this.name = name;
  }

  async generateResponse(prompt, systemPrompt) {
    throw new Error('generateResponse must be implemented');
  }

  isAvailable() {
    throw new Error('isAvailable must be implemented');
  }

  getName() {
    return this.name;
  }
}

/**
 * Gemini Provider (Google Generative AI)
 */
export class GeminiProvider extends AIProvider {
  constructor(apiManager) {
    super('Gemini');
    this.apiManager = apiManager;
  }

  async generateResponse(prompt, systemPrompt) {
    try {
      const keyData = this.apiManager.getNextKey();
      if (!keyData || keyData.provider !== 'gemini') {
        throw new Error('No available Gemini keys');
      }

      const genAI = new GoogleGenerativeAI(keyData.key);
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-2.5-flash',
        systemInstruction: systemPrompt
      });

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      this.apiManager.recordSuccess();
      return this.cleanResponse(response);
    } catch (error) {
      this.apiManager.recordError(error);
      throw error;
    }
  }

  cleanResponse(text) {
    if (!text) return '';
    
    // Remove markdown code blocks
    text = text.replace(/```[\s\S]*?```/g, '');
    
    // Remove role prefixes
    text = text.replace(/^(Assistant|Bot|AI|Mistress|Girl):\s*/i, '');
    
    // Remove extra quotes
    text = text.replace(/^["']|["']$/g, '');
    
    // Clean up whitespace
    text = text.trim();
    
    return text;
  }

  isAvailable() {
    return this.apiManager.hasAvailableKeys();
  }
}

/**
 * GPT Nano Provider (OpenAI)
 */
export class GPTNanoProvider extends AIProvider {
  constructor(apiKey) {
    super('GPT Nano');
    this.apiKey = apiKey;
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async generateResponse(prompt, systemPrompt) {
    try {
      if (!this.apiKey || !this.client) {
        throw new Error('GPT Nano API key not configured');
      }

      const response = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 256
      });

      const message = response.choices[0]?.message?.content || '';
      return this.cleanResponse(message);
    } catch (error) {
      logger.error(`GPT Nano error: ${error.message}`);
      throw error;
    }
  }

  cleanResponse(text) {
    if (!text) return '';
    
    // Remove markdown code blocks
    text = text.replace(/```[\s\S]*?```/g, '');
    
    // Remove role prefixes
    text = text.replace(/^(Assistant|Bot|AI|Mistress|Girl):\s*/i, '');
    
    // Remove extra quotes
    text = text.replace(/^["']|["']$/g, '');
    
    // Clean up whitespace
    text = text.trim();
    
    return text;
  }

  isAvailable() {
    return !!this.apiKey;
  }
}

/**
 * AI Provider Factory
 */
export class AIProviderFactory {
  constructor(apiManager, gptNanoKey) {
    this.apiManager = apiManager;
    this.gptNanoKey = gptNanoKey;
    
    // Initialize providers
    this.geminiProvider = new GeminiProvider(apiManager);
    this.gptNanoProvider = gptNanoKey ? new GPTNanoProvider(gptNanoKey) : null;
    
    logger.info(`Gemini Provider: ✓ (${apiManager.geminiKeys.length} keys)`);
    logger.info(`GPT Nano Provider: ${this.gptNanoProvider ? '✓' : '✗'}`);
  }

  /**
   * Get next available provider (Gemini first, then GPT Nano)
   */
  getProvider() {
    // Check if we have available Gemini keys (not rate-limited/exhausted)
    const hasAvailableGemini = this.apiManager.geminiStats.some(s => !s.quotaExhausted && !s.rateLimited);
    
    if (hasAvailableGemini && this.geminiProvider.isAvailable()) {
      return this.geminiProvider;
    }

    // Fallback to GPT Nano
    if (this.gptNanoProvider?.isAvailable()) {
      logger.info('Gemini exhausted/rate-limited - using OpenAI');
      return this.gptNanoProvider;
    }

    logger.error('No AI providers available');
    return null;
  }

  /**
   * Generate response with automatic provider selection
   */
  async generateResponse(prompt, systemPrompt) {
    const provider = this.getProvider();
    if (!provider) {
      throw new Error('No AI providers available (no Gemini, no GPT Nano)');
    }

    return provider.generateResponse(prompt, systemPrompt);
  }

  /**
   * Get status of all providers
   */
  getStatus() {
    return {
      primary: {
        name: 'Gemini',
        available: this.geminiProvider.isAvailable(),
        keys: this.apiManager.geminiKeys.length,
        active: this.apiManager.geminiStats.filter(s => !s.quotaExhausted && !s.rateLimited).length
      },
      fallback: {
        name: 'GPT Nano',
        available: this.gptNanoProvider?.isAvailable() || false,
        configured: !!this.gptNanoKey
      }
    };
  }
}
