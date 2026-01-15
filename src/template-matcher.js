import fs from 'fs';
import path from 'path';

/**
 * Template Matcher - Matches user messages using training data and templates
 * Priority: 1) Training data examples, 2) Hardcoded templates, 3) AI fallback
 */
export class TemplateMatcher {
  constructor() {
    this.config = this.loadTemplates();
    this.templates = this.config.templates || [];
    this.ofLinkMessage = this.config.ofLinkMessage || '';
    this.systemPrompt = this.config.systemPrompt || '';
    
    // Load training data if available
    this.trainingData = this.loadTrainingData();
  }

  /**
   * Load templates from config
   */
  loadTemplates() {
    const templatesPath = path.join(process.cwd(), 'config', 'templates.json');
    if (!fs.existsSync(templatesPath)) {
      console.warn('templates.json not found');
      return { templates: [] };
    }

    try {
      const data = fs.readFileSync(templatesPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to load templates:', error.message);
      return { templates: [] };
    }
  }

  /**
   * Load training data from training-data.json
   */
  loadTrainingData() {
    // Try multiple possible paths
    const paths = [
      path.join(process.cwd(), 'Bot', 'config', 'training-data.json'),
      path.join(process.cwd(), 'config', 'training-data.json'),
      path.join(process.cwd(), 'training-data.json')
    ];

    for (const filePath of paths) {
      if (fs.existsSync(filePath)) {
        try {
          const data = fs.readFileSync(filePath, 'utf8');
          return JSON.parse(data);
        } catch (error) {
          console.error(`Failed to load training data from ${filePath}:`, error.message);
        }
      }
    }

    console.warn('Training data not found');
    return { conversation_examples: [] };
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
   * Find matching template based on user message (legacy template system)
   * Returns: { templateId, response, sendLink, followUp } or null
   */
  findMatch(userMessage) {
    const msg = userMessage.toLowerCase().trim();

    // PRIORITY 1: Check exact phrase template matches FIRST (these are critical redirects)
    for (const template of this.templates) {
      for (const trigger of template.triggers) {
        const triggerLower = trigger.toLowerCase();
        
        // Exact phrase match - takes highest priority
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

    // PRIORITY 2: Try training data
    const trainingMatch = this.findTrainingDataMatch(userMessage);
    if (trainingMatch && trainingMatch.confidence > 0.4) {
      return trainingMatch;
    }

    // PRIORITY 3: Check hardcoded templates for word boundary/substring matches
    let bestTemplate = null;
    let bestTriggerLength = 0;

    for (const template of this.templates) {
      for (const trigger of template.triggers) {
        const triggerLower = trigger.toLowerCase();
        
        // Word boundary match (better than substring)
        const wordBoundaryPattern = `\\b${triggerLower}\\b`;
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

    // PRIORITY 3: No match - will use AI
    return null;
  }

  /**
   * Check if message is sexual/horny content (should send OF link)
   */
  isSexualContent(message) {
    const sexualKeywords = [
      'pussy', 'tits', 'boobs', 'ass', 'nudes', 'naked', 'horny', 
      'dick', 'cock', 'fuck', 'sex', 'nipples', 'feet', 'cum',
      'send pic', 'show me', 'can i see', 'want to see'
    ];
    const lower = message.toLowerCase();
    return sexualKeywords.some(kw => lower.includes(kw));
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
