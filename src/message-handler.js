import { TemplateMatcher } from './template-matcher.js';
import { AIHandler } from './ai-handler.js';
import { logger } from './logger.js';

/**
 * Message Handler - Implements the 3-stage conversion funnel
 * 
 * Priority:
 * 1. Intent Classification (research-based horny person responses)
 * 2. Template Matching (training data + hardcoded templates)
 * 3. AI Fallback (Gemini for complex messages)
 * 
 * Stage 1: Initial conversation (greetings, personal questions)
 * Stage 2: Request detection (asks for pics, sexting, meetup) -> Send OF link
 * Stage 3: End conversation (after link sent or refused)
 */
export class MessageHandler {
  constructor(conversationManager) {
    this.templateMatcher = new TemplateMatcher();
    this.aiHandler = new AIHandler();
    this.conversationManager = conversationManager;
    
    // Human-like delay
    this.responseDelay = {
      min: parseInt(process.env.RESPONSE_DELAY_MIN) || 2000,
      max: parseInt(process.env.RESPONSE_DELAY_MAX) || 5000
    };
  }

  /**
   * Handle incoming DM - implements conversion funnel
   * Priority: Template Matcher → AI (no intent classifier)
   * Strategy: Use pre-written scripts first, AI only when no template matches
   */
  async handleDM(userId, userMessage) {
    try {
      logger.info(`Message from ${userId}: "${userMessage}"`);

      // CRITICAL: Check if message contains a link (user clicked OF link or sent their own)
      const hasLink = /https?:\/\/|www\.|\.com|\.io|\.co/i.test(userMessage);
      if (hasLink) {
        logger.info(`🔗 Link detected in message from ${userId} - assuming user is engaging with OF link`);
        // Return null to close conversation (no response needed)
        this.conversationManager.endConversation(userId);
        return null; // Don't send a response, just end conversation
      }

      // Check if user is trying to chat on Discord instead of OF - REDIRECT AGGRESSIVELY
      if (this.isAvoidingOF(userMessage)) {
        logger.info(`User ${userId} trying to avoid OF - sending aggressive redirect`);
        const ofLink = process.env.OF_LINK;
        const redirectMessage = `nah baby all the fun stuff is on my OF hehe\nits free to sub :3\n${ofLink}\nlmk when u do ok? <33`;
        
        // Mark that we sent link and end conversation
        this.conversationManager.markOFLinkSent(userId);
        this.conversationManager.endConversation(userId);
        
        const delay = this.getRandomDelay();
        await new Promise(r => setTimeout(r, delay));
        
        return {
          userId,
          message: redirectMessage,
          source: 'aggressive_redirect',
          hasOFLink: true,
          closeChat: true
        };
      }

      let response;
      let source;
      let shouldSendLink = false;

      // PRIORITY 1: Try template matching FIRST (word-by-word triggers)
      const match = this.templateMatcher.findMatch(userMessage);
      
      if (match && match.confidence >= 0.5) {
        // Template found - use it
        response = match.response;
        source = match.source === 'training_data' ? 'script_training' : 'script_template';
        logger.info(`Template matched: ${match.templateId}`);
        
        if (match.sendLink) {
          shouldSendLink = true;
        }
      } 
      // PRIORITY 2: Use AI (only if template doesn't match)
      else {
        logger.info('No template match found, switching to AI...');
        response = await this.aiHandler.generateResponse(
          userMessage,
          this.templateMatcher.getSystemPrompt()
        );
        source = 'ai_gemini';
        
        // Check if user message contains sexual content keywords
        if (this.templateMatcher.isSexualContent(userMessage)) {
          shouldSendLink = true;
          logger.info('Sexual content detected - should send OF link');
        }
        
        // Check if AI response mentions OF/OnlyFans
        if (response && this.mentionsOnlyFans(response)) {
          shouldSendLink = true;
          logger.info('AI response mentions OnlyFans - should send OF link');
        }
      }

      // Build final response with OF link if needed
      let finalResponse = response;
      let closeChat = false;
      if (shouldSendLink) {
        const ofLink = process.env.OF_LINK;
        const linkMessage = this.templateMatcher.getOFLinkMessage(ofLink);
        finalResponse = `${response}\n\n${linkMessage}`;
        
        // Mark that we sent the link AND close conversation
        this.conversationManager.markOFLinkSent(userId);
        this.conversationManager.endConversation(userId);
        closeChat = true;
        logger.info('OF link appended to response - CLOSING CHAT');
      }

      // Human-like delay before responding
      const delay = this.getRandomDelay();
      logger.info(`Waiting ${delay}ms before sending...`);
      await new Promise(r => setTimeout(r, delay));

      return {
        userId,
        message: finalResponse,
        source,
        hasOFLink: shouldSendLink,
        closeChat: closeChat
      };

    } catch (error) {
      logger.error('Message handling failed: ' + error.message);
      return {
        userId,
        message: 'hehe sorry i got distracted :3 what were you saying?',
        source: 'fallback',
        hasOFLink: false
      };
    }
  }

  /**
   * Random delay to appear human
   */
  getRandomDelay() {
    return Math.floor(
      Math.random() * (this.responseDelay.max - this.responseDelay.min) + this.responseDelay.min
    );
  }

  /**
   * Check if response mentions OnlyFans/OF content
   * If AI mentions OF, we should send the link
   */
  mentionsOnlyFans(response) {
    if (!response) return false;
    const lower = response.toLowerCase();
    const ofKeywords = [
      'onlyfans', 'of ', 'exclusive content', 'my content', 'there', 'over there',
      'see more', 'check out', 'come see', 'talk there', 'dm there',
      'subscribe', 'membership', 'see it all'
    ];
    return ofKeywords.some(kw => lower.includes(kw));
  }

  /**
   * Detect if user is trying to avoid OF and chat on Discord instead
   * Examples: "i prefer to talk here", "lets chat on discord", "talk here", etc
   */
  isAvoidingOF(message) {
    if (!message) return false;
    const lower = message.toLowerCase();
    
    // Keywords that indicate user wants to chat on Discord/here instead of OF
    const avoidOFKeywords = [
      'prefer to talk here',
      'prefer to chat here',
      'talk here',
      'chat here',
      'prefer here',
      'prefer discord',
      'talk on discord',
      'chat on discord',
      'here is better',
      'like talking here',
      'like to talk here',
      'stay here',
      'just chat here',
      'just talk here',
      'dont wanna go',
      'not going to',
      'not going there'
    ];
    
    return avoidOFKeywords.some(kw => lower.includes(kw));
  }
}

