import { TemplateMatcher } from './template-matcher.js';
import { IntentClassifier } from './intent-classifier.js';
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
    this.intentClassifier = new IntentClassifier();
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
   * Priority: Intent Classification → Template Matcher → AI (last resort)
   * Strategy: Minimize API calls by using scripts first
   */
  async handleDM(userId, userMessage) {
    try {
      logger.info(`Message from ${userId}: "${userMessage}"`);

      // Step 1: Classify intent (research-based, NO API call)
      const intentData = this.intentClassifier.classifyIntent(userMessage);
      logger.info(`Intent classified: ${intentData.intent} (confidence: ${(intentData.confidence * 100).toFixed(1)}%)`);

      let response;
      let source;
      let shouldSendLink = false;

      // Step 2: High-confidence intent matches (NO API call)
      if (intentData.confidence >= 0.4 && !intentData.requiresAI) {
        // Get funnel stage for this conversation
        const conversationState = this.conversationManager.getConversationState(userId);
        const messageCount = conversationState?.messageCount || 0;
        
        const funnelStage = this.intentClassifier.getFunnelStage(intentData, {
          messageCount: messageCount,
          hasOFLink: conversationState?.hasOFLink || false
        });

        logger.info(`Funnel stage: ${funnelStage.stage} (mention_of: ${funnelStage.mention_of})`);

        // Get response from intent classifier (script-based, NOT AI)
        response = this.intentClassifier.getSuggestedResponse(intentData, funnelStage);
        source = 'script_intent'; // Script response, not AI

        // Check if we should send OF link
        if (funnelStage.mention_of && (intentData.intent === 'HORNY_DIRECT' || 
            intentData.intent === 'COMPLIMENT_SEXUAL' || 
            intentData.intent === 'REQUEST_CONTENT' ||
            intentData.intent === 'INQUIRY_BUSINESS')) {
          shouldSendLink = true;
        }
      } 
      // Step 3: Fallback to template matching (NO API call)
      else {
        const match = this.templateMatcher.findMatch(userMessage);
        
        if (match && match.confidence >= 0.6) {
          response = match.response;
          source = match.source === 'training_data' ? 'script_training' : 'script_template';
          logger.info(`Template matched: ${match.templateId}`);
          
          if (match.sendLink) {
            shouldSendLink = true;
          }
        }
        // Step 4: Use AI (only if above fails)
        else {
          logger.info('No script match found, switching to Gemini AI...');
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

