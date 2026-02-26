import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import OpenAI from 'openai';

/**
 * Template Matcher - Matches user messages using training data and templates
 * Priority: 1) Training data examples, 2) Hardcoded templates, 3) AI fallback
 */
export class TemplateMatcher {
  constructor(activeProfile) {
    this.config = this.loadTemplates();
    this.templates = this.config.templates || [];
    this.ofLinkMessage = this.config.ofLinkMessage || '';
    this.systemPrompt = this.config.systemPrompt || '';
    this.activeProfile = activeProfile;
    
    // Build dynamic system prompt based on active profile
    if (this.activeProfile) {
      this.systemPrompt = this.buildSystemPrompt(this.activeProfile);
    }
    
    // Load training data if available
    this.trainingData = this.loadTrainingData();

    // Semantic embeddings for training data ( Phase 2 )
    this.semanticEmbeddings = this.loadSemanticEmbeddings();
    this.embeddingModel = 'text-embedding-3-small';
    this.openaiClient = null;
    const openaiKey = process.env.OPENAI_API_KEY || null;
    if (openaiKey) {
      try {
        this.openaiClient = new OpenAI({ apiKey: openaiKey });
        logger.info('OpenAI client initialized for semantic template matching');
      } catch (error) {
        logger.warn(`Failed to initialize OpenAI client for embeddings: ${error.message}`);
      }
    } else {
      logger.warn('OPENAI_API_KEY not set - semantic template matching will be disabled');
    }
  }

  /**
   * Build system prompt dynamically based on active profile
   */
  buildSystemPrompt(profile) {
    if (!profile) return this.systemPrompt;
    
    const name = profile.name || 'Yuki';
    const age = profile.age || '21';
    const location = profile.location || 'Unknown';
    
    return `YOU ARE ${name.toUpperCase()}. YOU ARE ${age} YEARS OLD. YOU ARE FROM ${location.toUpperCase()}.

You are texting on Discord as ${name}, a ${age}-year-old girl from ${location}. You're flirty, genuine, real. Casual, lowercase, light emojis, 1-2 sentences max.

ABOUT YOU (FACTUAL):
- Your name is: ${name}
- Your age is: ${age}
- You are from: ${location}
- Your hobbies: music, fashion, hanging out, vibing with people

INSTRUCTIONS FOR ANSWERING QUESTIONS ABOUT YOU:
When someone asks "how old are you" or "what's your age" → REPLY: "im ${age}" or "im ${age} btw" or just "${age}"
When someone asks "where are you from" → REPLY: "im from ${location}" or "${location}"
When someone asks "what do you do" or "what are your hobbies" → mention music, fashion, hanging out (don't push OF unless they ask)
When someone says "hey/hi/hello" → reply with a casual greeting (heyy, hi, whats up)

CRITICAL RULES:
1. ALWAYS answer their actual question - if they ask "how old are you" say your age
2. NEVER ignore what they asked or change the subject
3. NEVER ask them questions back - just respond to what they said
4. SHORT responses only - 1-2 sentences max
5. Casual lowercase language
6. Reference what they said - but DON'T echo back nicknames or pet names they use for themselves. Be natural.
7. Be genuine, not robotic
8. Add personality and warmth
9. Light emojis sometimes (not every message)
10. DONT mention OnlyFans unless they ask about it directly
11. BE YOURSELF - respond as ${name} would respond to a friend
12. SAFEGUARD - UNDERAGE: If someone says they're under 18, immediately respond with "oh wait are you under 18? sorry i only talk to people 18+" and STOP engaging. Do NOT continue the conversation.
13. SAFEGUARD - ILLEGAL: Never engage with requests about money transfers, bank info, illegal activities, or exploitation. Immediately refuse and end conversation.
14. NEVER use the user's name unless they explicitly tell you their name first. Don't assume or guess their name.

EXAMPLES OF GOOD RESPONSES:
Them: "hey whats up"
Good: "heyy not much just chilling :3"
Bad: "hey! how are you doing today?" ← asking question back
Bad: "im great thanks for asking" ← not referencing what they said

Them: "how old are you"
Good: "im ${age}"
Bad: "im great how are you" ← ignoring their question
Bad: "im ${age}, how old are you?" ← asking question back

Them: "im from texas"
Good: "oh nice ive always wanted to go"
Bad: "where are you from?" ← they literally just told you
Bad: "thats cool where abouts?" ← asking question back

Them: "what do you like to do"
Good: "music, fashion, hanging out with cool people"
Bad: "what do you like to do?" ← repeating their words
Bad: "i like lots of things, what about you?" ← asking question back

Them: "can i see pics"
Good: "hehe i have that kind of content just not here :3"
Bad: "do you want to see my pics?" ← answering with question
Bad: "maybe" ← too vague, not helpful

REMEMBER: You are ${name}, ${age}, from ${location}. Answer their questions directly and authentically as that person.`;
  }

  /**
   * Load templates from config
   */
  loadTemplates() {
    const templatesPath = path.join(process.cwd(), 'config', 'templates.json');
    if (!fs.existsSync(templatesPath)) {
      logger.warn('templates.json not found');
      return { templates: [] };
    }

    try {
      const data = fs.readFileSync(templatesPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.error('Failed to load templates: ' + error.message);
      return { templates: [] };
    }
  }

  /**
   * Load training data from training-data.json
   */
  loadTrainingData() {
    // Try multiple possible paths
    const paths = [
      path.join(process.cwd(), 'config', 'training-data.json'),
      path.join(process.cwd(), 'training-data.json')
    ];

    for (const filePath of paths) {
      if (fs.existsSync(filePath)) {
        try {
          const data = fs.readFileSync(filePath, 'utf8');
          return JSON.parse(data);
        } catch (error) {
          logger.error(`Failed to load training data from ${filePath}: ` + error.message);
        }
      }
    }

    logger.warn('Training data not found');
    return { conversation_examples: [] };
  }

  /**
   * Load precomputed semantic embeddings for training examples (if available)
   */
  loadSemanticEmbeddings() {
    try {
      const embeddingsPath = path.join(process.cwd(), 'data', 'training-embeddings.json');
      if (!fs.existsSync(embeddingsPath)) {
        logger.warn('training-embeddings.json not found - semantic matching will be skipped');
        return null;
      }

      const raw = fs.readFileSync(embeddingsPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) {
        logger.warn('training-embeddings.json has no entries - semantic matching will be skipped');
        return null;
      }

      logger.info(`Loaded ${parsed.entries.length} semantic training examples for template matching`);
      return parsed;
    } catch (error) {
      logger.warn(`Failed to load semantic embeddings: ${error.message}`);
      return null;
    }
  }

  /**
   * Calculate similarity between two strings using simple word overlap
   * Returns a score between 0 and 1
   */
  calculateSimilarity(msg1, msg2) {
    const words1 = new Set(msg1.toLowerCase().split(/\s+/));
    const words2 = new Set(msg2.toLowerCase().split(/\s+/));
    
    // Calculate Jaccard similarity
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  /**
   * Find matching response from training data
   * Uses similarity matching to find best example
   */
  findTrainingDataMatch(userMessage) {
    if (!this.trainingData?.conversation_examples || this.trainingData.conversation_examples.length === 0) {
      return null;
    }

    const msg = userMessage.toLowerCase().trim();
    let bestMatch = null;
    let bestScore = 0.3; // Minimum threshold for similarity

    // Find the training example most similar to user message
    for (const example of this.trainingData.conversation_examples) {
      const similarity = this.calculateSimilarity(msg, example.user_message);
      
      if (similarity > bestScore) {
        bestScore = similarity;
        bestMatch = example;
      }
    }

    if (bestMatch) {
      // Pick random response from the good responses
      const response = bestMatch.good_responses[
        Math.floor(Math.random() * bestMatch.good_responses.length)
      ];
      
      return {
        templateId: bestMatch.context || 'training_data',
        response: response,
        sendLink: false, // Training data responses don't trigger OF link by themselves
        followUp: false,
        confidence: bestScore,
        source: 'training_data'
      };
    }

    return null;
  }

  /**
   * Get semantic match using embeddings over training examples
   * Returns a match object similar to training data match or null
   */
  async findSemanticMatch(userMessage) {
    try {
      if (!this.semanticEmbeddings || !this.openaiClient) {
        return null;
      }

      const trimmed = (userMessage || '').trim();
      if (!trimmed) {
        return null;
      }

      const embedResponse = await this.openaiClient.embeddings.create({
        model: this.embeddingModel,
        input: trimmed
      });

      const userVector = embedResponse?.data?.[0]?.embedding;
      if (!userVector || !Array.isArray(userVector)) {
        logger.warn('Semantic match: no embedding returned for user message');
        return null;
      }

      let bestEntry = null;
      let bestScore = 0;

      const entries = this.semanticEmbeddings.entries || [];
      for (const entry of entries) {
        if (!Array.isArray(entry.embedding)) continue;
        const score = this.cosineSimilarity(userVector, entry.embedding);
        if (score > bestScore) {
          bestScore = score;
          bestEntry = entry;
        }
      }

      // Require reasonably high similarity to avoid random matches
      const MIN_SIMILARITY = 0.75;
      if (!bestEntry || bestScore < MIN_SIMILARITY) {
        return null;
      }

      const response = bestEntry.response || bestEntry.user_message || 'ok';
      const templateId = bestEntry.context || bestEntry.intent || 'semantic_training_data';

      logger.debug(
        `[Semantic Match] Matched context="${templateId}" with similarity=${bestScore.toFixed(2)}`
      );

      return {
        templateId,
        response,
        sendLink: false,
        followUp: false,
        confidence: bestScore,
        source: 'semantic_training_data'
      };
    } catch (error) {
      logger.warn(`Semantic match failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Cosine similarity between two equal-length vectors
   */
  cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return 0;
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      const va = a[i];
      const vb = b[i];
      dot += va * vb;
      normA += va * va;
      normB += vb * vb;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Find matching template based on user message
   * Returns: { templateId, response, sendLink, followUp } or null
   * 
   * PRIORITY ORDER:
   * 1. EXACT phrase matches (highest priority, especially redirects)
   * 2. REDIRECT templates with sendLink (pics, video call, meetup, sexual content)
   * 3. Semantic training-data match (embeddings)
   * 4. Training data matches (lexical)
   * 5. Regular templates
   */
  async findMatch(userMessage) {
    const msg = userMessage.toLowerCase().trim();

    // PRIORITY 1: Check EXACT phrase matches FIRST (these are critical redirects)
    for (const template of this.templates) {
      // Prioritize redirect templates in exact matching
      if (template.sendLink) {
        for (const trigger of template.triggers) {
          const triggerLower = trigger.toLowerCase();
          if (msg === triggerLower) {
            const response = template.responses[
              Math.floor(Math.random() * template.responses.length)
            ];
            return {
              templateId: template.id,
              response: response,
              sendLink: template.sendLink || false,
              followUp: template.followUp || false,
              confidence: 1.0,
              source: 'template_exact'
            };
          }
        }
      }
    }

    // PRIORITY 2: Check REDIRECT TEMPLATES FIRST (sendLink: true) with substring/word boundary matches
    // This ensures video call, meetup, pics requests trigger BEFORE "interested" template
    let bestRedirectTemplate = null;
    let bestRedirectTriggerLength = 0;

    for (const template of this.templates) {
      if (!template.sendLink) continue; // Skip non-redirects

      for (const trigger of template.triggers) {
        const triggerLower = trigger.toLowerCase();
        
        // Word boundary match
        const wordBoundaryPattern = `\\b${triggerLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`;
        if (new RegExp(wordBoundaryPattern).test(msg) && triggerLower.length > bestRedirectTriggerLength) {
          bestRedirectTemplate = { template, trigger };
          bestRedirectTriggerLength = triggerLower.length;
        }
      }
    }

    if (bestRedirectTemplate) {
      const response = bestRedirectTemplate.template.responses[
        Math.floor(Math.random() * bestRedirectTemplate.template.responses.length)
      ];

      logger.debug(`[Template Match] Redirect template matched: ${bestRedirectTemplate.template.id}`);
      return {
        templateId: bestRedirectTemplate.template.id,
        response: response,
        sendLink: bestRedirectTemplate.template.sendLink || false,
        followUp: bestRedirectTemplate.template.followUp || false,
        confidence: 0.85,
        source: 'template_redirect'
      };
    }

    // PRIORITY 3: Semantic training-data match (embeddings)
    const semanticMatch = await this.findSemanticMatch(userMessage);
    if (semanticMatch && semanticMatch.confidence > 0.6) {
      return semanticMatch;
    }

    // PRIORITY 4: Try lexical training data match
    const trainingMatch = this.findTrainingDataMatch(userMessage);
    if (trainingMatch && trainingMatch.confidence > 0.4) {
      return trainingMatch;
    }

    // PRIORITY 5: Check remaining hardcoded templates (non-redirect) for word boundary/substring matches
    let bestTemplate = null;
    let bestTriggerLength = 0;

    for (const template of this.templates) {
      if (template.sendLink) continue; // Already checked redirects

      for (const trigger of template.triggers) {
        const triggerLower = trigger.toLowerCase();
        
        // Word boundary match (ANY word in message that matches trigger)
        const wordBoundaryPattern = `\\b${triggerLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`;
        if (new RegExp(wordBoundaryPattern).test(msg) && triggerLower.length > bestTriggerLength) {
          bestTemplate = { template, trigger };
          bestTriggerLength = triggerLower.length;
        }
      }
    }

    if (bestTemplate) {
      const response = bestTemplate.template.responses[
        Math.floor(Math.random() * bestTemplate.template.responses.length)
      ];

      return {
        templateId: bestTemplate.template.id,
        response: response,
        sendLink: bestTemplate.template.sendLink || false,
        followUp: bestTemplate.template.followUp || false,
        confidence: 0.8,
        source: 'template_substring'
      };
    }

    // PRIORITY 6: No match - will use AI
    return null;
  }

  /**
   * Check if message is an explicit request that should trigger OF link
   * (pics/nudes, sexting/dirty talk, meetup/hookup, video/voice call).
   */
  isSexualContent(message) {
    if (!message) return false;

    const lower = message.toLowerCase();

    // Allow-list: clearly innocent "can I see your pet" style messages
    const safePetRequestPatterns = [
      /can i see (?:your\s+)?(?:cat|dog|pet|pets|kitty|kitten|puppy)/i,
      /can i see (?:a\s+)?picture of (?:your\s+)?(?:cat|dog|pet|pets|kitty|kitten|puppy)/i
    ];

    const isSafePetRequest = safePetRequestPatterns.some((re) => re.test(message));

    if (isSafePetRequest) {
      return false;
    }

    // Pattern-based requests like "can I see ..." / "show me ..." / "let's meet" etc.
    const explicitRequestPatterns = [
      /can i see (?:you|more|nudes?|pics?|a pic|boobs?|tits?|ass|pussy|dick|cock|cum|something sexy)/i,
      /want to see (?:you|more|nudes?|pics?|a pic|boobs?|tits?|ass|pussy|dick|cock|cum|something sexy)/i,
      /show me (?:you|more|nudes?|pics?|a pic|boobs?|tits?|ass|pussy|dick|cock|cum|something sexy)/i,
      /send (?:me )?(?:nudes?|pics?|a pic|video|vids?)/i,
      /trade (?:pics?|nudes?|photos?|vids?)/i,
      /(sext|talk dirty|chat dirty|roleplay|turn me on)/i,
      /(meet up|meetup|hook ?up|come over|netflix and chill|in person)/i,
      /(video call|voice call|discord call|facetime|vc|on camera|on video)/i
    ];

    const hasExplicitPattern = explicitRequestPatterns.some((re) => re.test(message));

    return hasExplicitPattern;
  }
  
  /**
   * Check if message is asking for social media/contact info
   * These should be treated like redirect templates and send OF link
   */
  isSocialMediaRequest(message) {
    const socialMediaKeywords = [
      'snap', 'snapchat', 'instagram', 'insta', 'twitter', 'tiktok', 'youtube',
      'phone', 'number', 'text me', 'dm me', 'email', 'contact',
      'add me', 'find me', 'where can i find',
      'your socials', 'socials',  'your handle', 'your username',
      'bio', 'link', 'links', 'url', 'website', 'page'
    ];
    const lower = message.toLowerCase();
    return socialMediaKeywords.some(kw => lower.includes(kw));
  }

  /**
   * Get the OF link message with link inserted
   */
  getOFLinkMessage(ofLink) {
    return this.ofLinkMessage.replace('{OF_LINK}', ofLink);
  }

  /**
   * Get system prompt for AI
   */
  getSystemPrompt() {
    return this.systemPrompt;
  }
}
