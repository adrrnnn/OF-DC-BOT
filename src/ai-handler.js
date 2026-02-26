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
    this.openaiKey = openaiKey;
    
    // Initialize provider factory with both providers
    this.providerFactory = new AIProviderFactory(this.apiManager, openaiKey);
    this.trainingExamples = this.loadTrainingExamples();
    this.intents = this.loadIntents();
    
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
   * Load intent definitions for classification
   */
  loadIntents() {
    const paths = [
      path.join(process.cwd(), 'config', 'intents.json'),
      path.join(process.cwd(), 'intents.json')
    ];

    for (const filePath of paths) {
      if (fs.existsSync(filePath)) {
        try {
          const data = fs.readFileSync(filePath, 'utf8');
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed.intents)) {
            logger.info(`Loaded ${parsed.intents.length} intents from ${filePath}`);
            return parsed.intents;
          }
        } catch (error) {
          logger.warn(`Failed to load intents from ${filePath}: ${error.message}`);
        }
      }
    }

    logger.warn('No intents.json found for intent classification');
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
   * Build system prompt for intent classification
   */
  buildIntentClassifierPrompt() {
    if (!this.intents || this.intents.length === 0) {
      return `You are an intent classifier for Discord DMs.

You must classify the user's message into a small set of intents relevant to an OnlyFans funnel.

Return ONLY valid JSON with this exact shape:
{
  "primary_intent": "other",
  "secondary_intents": [],
  "confidence": 0.0
}

primary_intent must be a short lowercase string.
secondary_intents is an array of zero or more additional intent strings.
confidence is a number between 0 and 1.`;
    }

    const intentsDescription = this.intents.map((intent) => {
      const name = intent.name || 'other';
      const description = intent.description || '';
      const examples = Array.isArray(intent.examples) ? intent.examples : [];
      const examplesText = examples.length
        ? `Examples: ${examples.map((e) => `"${e}"`).join(', ')}`
        : '';
      return `- ${name}: ${description}${examplesText ? '\n  ' + examplesText : ''}`;
    }).join('\n\n');

    return `You are an intent classifier for Discord DMs for an OnlyFans funnel.

You MUST classify the user's message into exactly one PRIMARY intent from this list,
and zero or more SECONDARY intents (optional). Use the definitions and examples carefully:

${intentsDescription}

Return ONLY valid JSON with this exact shape and nothing else:
{
  "primary_intent": "<one_of_intent_names>",
  "secondary_intents": ["optional_additional_intents"],
  "confidence": 0.0
}

Rules:
- primary_intent must be exactly one of the intent names listed above.
- secondary_intents can be empty or contain other relevant intent names.
- confidence is a number between 0 and 1 representing how sure you are.
- Do NOT include any explanation text, comments, or extra fields. Only the JSON object.`;
  }

  /**
   * Classify user intent using the LLM via proxy
   * Returns: { primary_intent, secondary_intents, confidence } or null
   */
  async classifyIntent(userMessage) {
    try {
      const proxyUrl = process.env.API_PROXY_URL;
      if (!proxyUrl) {
        logger.error('❌ API_PROXY_URL not configured in .env (intent classifier)');
        return null;
      }

      const systemPrompt = this.buildIntentClassifierPrompt();

      logger.info(`Making INTENT classification request via proxy: ${proxyUrl}`);

      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessage, systemPrompt })
      });

      if (!response.ok) {
        logger.error(`❌ Proxy error (intent): ${response.status}`);
        return null;
      }

      const data = await response.json();

      if (data.error) {
        logger.error(`❌ API error from proxy (intent): ${data.error}`);
        return null;
      }

      const raw = (data.response || '').trim();
      if (!raw) {
        logger.warn('Intent classifier returned empty response');
        return null;
      }

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        logger.warn(`Failed to parse intent JSON: ${err.message} | raw="${raw.slice(0, 120)}..."`);
        return null;
      }

      const primary = typeof parsed.primary_intent === 'string' ? parsed.primary_intent : 'other';
      const secondary = Array.isArray(parsed.secondary_intents) ? parsed.secondary_intents : [];
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;

      const result = {
        primary_intent: primary,
        secondary_intents: secondary,
        confidence
      };

      logger.info(
        `Intent classified: primary="${result.primary_intent}", confidence=${result.confidence.toFixed(
          2
        )}, secondary=[${result.secondary_intents.join(', ')}]`
      );

      return result;
    } catch (error) {
      logger.error(`❌ Intent classification failed - ${error.message}`);
      return null;
    }
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
   * Build system prompt wrapper for structured JSON replies
   */
  buildStructuredReplyPrompt(systemPrompt) {
    const base = systemPrompt || '';
    return `${base}

=== RESPONSE FORMAT (CRITICAL) ===
You are chatting as the girl character described above.

You MUST respond using ONLY a valid JSON object with this exact shape and field names:
{
  "reply": "string - the exact message you will send back in chat, in the girl's style",
  "should_send_of_link": false,
  "intent": "string - short label like greeting, neutral_small_talk, sexual_request, explicit_photo_request, social_media_request, avoid_of, refuse_of, other",
  "is_avoid_of": false,
  "is_refuse_of": false,
  "notes": "string - optional short reasoning, can be empty"
}

Rules:
- reply: 1-2 short sentences in the girl's voice (casual, lowercase, emojis like before).
- should_send_of_link: true ONLY if the user is clearly asking to sext / talk dirty / roleplay, asking for pics/nudes/videos, or asking to meet up / hook up / come over, or asking for a video/voice call. Otherwise false.
- intent: pick the MOST relevant high-level intent (greeting, neutral_small_talk, sexual_request, explicit_photo_request, social_media_request, avoid_of, refuse_of, other).
- is_avoid_of: true ONLY if they are clearly trying to avoid or not use OnlyFans and keep chatting here.
- is_refuse_of: true ONLY if they clearly reject or refuse using OnlyFans after it was offered.
- notes: optional, can be empty, but MUST be a string.

Special handling rules (CRITICAL):
- If they ask for SOCIAL MEDIA or CONTACT (snapchat, snap, insta, instagram, twitter, tiktok, phone number, \"text me\", etc.):
  - intent MUST be \"social_media_request\".
  - should_send_of_link MUST be false.
  - reply MUST be a short, firm decline like:
    - \"i dont really use snap or insta\"
    - \"i keep my contact pretty private tbh\"
    - \"nah i dont really give out my socials\"
  - DO NOT say or imply that you want to keep chatting here (no phrases like \"we can chat here\", \"we can keep talking here\", \"im happy to chat here\", \"vibing in the chat\", etc.).
  - DO NOT invite them to continue the conversation or make it longer; just decline and stop.

- If they ask for a CALL (voice or video: call, vc, video call, facetime, discord call, etc.):
  - intent MUST be \"social_media_request\" or \"other\" depending on context.
  - should_send_of_link MUST be false unless they are ALSO clearly asking for sexual content / spicy calls that should be redirected to OF.
  - reply MUST be a short, gentle decline like:
    - \"oh i dont really do calls\"
    - \"not really doing calls rn\"
    - \"im not doing calls here tbh\"
  - Again, DO NOT add anything like \"but we can chat here\" or invite more small talk; just decline.

These policies are more important than being friendly or keeping the conversation going. It is better to give a very short decline than to invite more chatting.

- If they say they are sending or have sent a PIC / PHOTO / IMAGE (for example: \"sent you a pic\", \"sending a pic\", \"here's a photo\", \"here's a pic of...\", \"check this pic I sent\"), treat it like an explicit photo request:
  - intent should usually be \"explicit_photo_request\".
  - should_send_of_link MUST be true.
  - reply SHOULD look like the funnel rule: \"oh thats blurred for me, maybe my ISP is blocking it, maybe send it here? :3\" (you can paraphrase lightly but keep the meaning).
  - Do NOT invite more chatting in Discord in that reply; keep it focused on handling the pic briefly and then stopping.

Do NOT include any extra fields.
Do NOT output explanations or markdown.
Output ONLY the JSON object.`;
  }

  /**
   * Generate structured response (reply + flags) using proxy server
   * Returns: { reply, should_send_of_link, intent, is_avoid_of, is_refuse_of, notes }
   */
  async generateStructuredResponse(userMessage, systemPrompt) {
    try {
      // SAFEGUARD: Check user message first
      if (this.isUnderage(userMessage) || this.isIllegalRequest(userMessage)) {
        logger.warn(`⚠️  Blocked unsafe user message from reaching AI (structured): "${userMessage}"`);
        return null; // Let message handler deal with it
      }

      const proxyUrl = process.env.API_PROXY_URL;
      if (!proxyUrl) {
        logger.error('❌ API_PROXY_URL not configured in .env (structured response)');
        return null;
      }

      const finalSystemPrompt = this.buildStructuredReplyPrompt(systemPrompt);

      logger.info(`Making STRUCTURED AI request via proxy: ${proxyUrl}`);

      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessage, systemPrompt: finalSystemPrompt })
      });

      if (!response.ok) {
        logger.error(`❌ Proxy error (structured): ${response.status}`);
        return null;
      }

      const data = await response.json();

      if (data.error) {
        logger.error(`❌ API error from proxy (structured): ${data.error}`);
        return null;
      }

      let raw = (data.response || '').trim();
      if (!raw) {
        logger.warn('Structured response: empty AI response');
        return null;
      }

      // SAFEGUARD: Check AI response for illegal content even in JSON
      if (this.isIllegalResponse(raw)) {
        logger.warn(`⚠️  AI generated unsafe structured response, rejecting: "${raw}"`);
        return null;
      }

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        logger.warn(`Failed to parse structured reply JSON: ${err.message} | raw="${raw.slice(0, 120)}..."`);
        // Fallback: treat raw text as reply only
        return {
          reply: raw,
          should_send_of_link: false,
          intent: 'other',
          is_avoid_of: false,
          is_refuse_of: false,
          notes: 'unparsed_structured_json'
        };
      }

      const reply = typeof parsed.reply === 'string' && parsed.reply.trim().length > 0
        ? parsed.reply.trim()
        : raw;
      const shouldSendOfLink = typeof parsed.should_send_of_link === 'boolean'
        ? parsed.should_send_of_link
        : false;
      const intent = typeof parsed.intent === 'string' ? parsed.intent : 'other';
      const isAvoidOf = typeof parsed.is_avoid_of === 'boolean' ? parsed.is_avoid_of : false;
      const isRefuseOf = typeof parsed.is_refuse_of === 'boolean' ? parsed.is_refuse_of : false;
      const notes = typeof parsed.notes === 'string' ? parsed.notes : '';

      const result = {
        reply,
        should_send_of_link: shouldSendOfLink,
        intent,
        is_avoid_of: isAvoidOf,
        is_refuse_of: isRefuseOf,
        notes
      };

      logger.info(
        `Structured reply: intent="${result.intent}", should_send_of_link=${result.should_send_of_link}, is_avoid_of=${result.is_avoid_of}, is_refuse_of=${result.is_refuse_of}`
      );

      return result;
    } catch (error) {
      logger.error(`❌ Structured response generation failed - ${error.message}`);
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
