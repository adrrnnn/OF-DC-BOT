const logger = require('./logger');

/**
 * Base AI Provider Interface
 */
class AIProvider {
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
class GeminiProvider extends AIProvider {
  constructor(apiManager) {
    super('Gemini');
    this.apiManager = apiManager;
    this.GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI;
  }

  async generateResponse(prompt, systemPrompt) {
    try {
      const keyData = this.apiManager.getNextKey();
      if (!keyData || keyData.provider !== 'gemini') {
        throw new Error('No available Gemini keys');
      }

      const genAI = new this.GoogleGenerativeAI(keyData.key);
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
class GPTNanoProvider extends AIProvider {
  constructor(apiKey) {
    super('GPT Nano');
    this.apiKey = apiKey;
    this.OpenAI = require('openai').default;
  }

  async generateResponse(prompt, systemPrompt) {
    try {
      if (!this.apiKey) {
        throw new Error('GPT Nano API key not configured');
      }

      const client = new this.OpenAI({
        apiKey: this.apiKey
      });

      const response = await client.chat.completions.create({
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
class AIProviderFactory {
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
    // Try Gemini first
    if (this.geminiProvider.isAvailable()) {
      return this.geminiProvider;
    }

    // Fallback to GPT Nano
    if (this.gptNanoProvider?.isAvailable()) {
      logger.warn('Falling back to GPT Nano');
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

module.exports = {
  AIProvider,
  GeminiProvider,
  GPTNanoProvider,
  AIProviderFactory
};

/**
 * GPT Nano Provider (OpenAI)
 */
export class GPTNanoProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.name = 'GPT Nano';
    this.model = 'gpt-4o-mini';
    this.baseURL = 'https://api.openai.com/v1';
  }

  async generateResponse(userMessage, systemPrompt, conversationContext) {
    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: `You are responding in a Discord DM conversation. Be natural, casual, and conversational - like texting with a friend.

${conversationContext}

${systemPrompt}

Respond naturally in 1-2 short sentences. Keep it casual and friendly, like you're texting.`
            },
            {
              role: 'user',
              content: userMessage
            }
          ],
          temperature: 0.7,
          max_tokens: 50
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'OpenAI API error');
      }

      const data = await response.json();
      let text = data.choices[0].message.content.trim();

      // Clean response
      text = text
        .replace(/^(Yuki:|Assistant:|Bot:|You:|Me:)\s*/i, '')
        .replace(/^["']|["']$/g, '')
        .replace(/^\*\*|^\*\*|^__|^__/g, '')  // Remove markdown emphasis
        .trim();

      return text;
    } catch (error) {
      throw error;
    }
  }
}

/**
 * Provider Factory
 */
export class AIProviderFactory {
  static createProvider(type, apiKey) {
    switch (type.toUpperCase()) {
      case 'GEMINI':
        return new GeminiProvider(apiKey);
      case 'GPT_NANO':
      case 'OPENAI':
        return new GPTNanoProvider(apiKey);
      default:
        throw new Error(`Unknown AI provider: ${type}`);
    }
  }
}
