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
        logger.info('No template match found, switching to Gemini AI...');
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
      }

      // Build final response with OF link if needed
      let finalResponse = response;
      if (shouldSendLink) {
        const ofLink = process.env.OF_LINK;
        const linkMessage = this.templateMatcher.getOFLinkMessage(ofLink);
        finalResponse = `${response}\n\n${linkMessage}`;
        
        // Mark that we sent the link
        this.conversationManager.markOFLinkSent(userId);
        logger.info('OF link appended to response');
      }

      // Human-like delay before responding
      const delay = this.getRandomDelay();
      logger.info(`Waiting ${delay}ms before sending...`);
      await new Promise(r => setTimeout(r, delay));

      return {
        userId,
        message: finalResponse,
        source,
        hasOFLink: shouldSendLink
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
}

