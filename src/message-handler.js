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
  constructor(conversationManager, activeProfile) {
    this.templateMatcher = new TemplateMatcher(activeProfile);
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

      // SAFEGUARD: Check for underage claims
      if (this.aiHandler.isUnderage(userMessage)) {
        logger.warn(`⚠️  UNDERAGE CLAIM DETECTED from ${userId}: "${userMessage}"`);
        const blockMessage = `im only talking to ppl 18+`;
        return {
          userId,
          message: blockMessage,
          source: 'safeguard_age',
          hasOFLink: false,
          closeChat: true
        };
      }

      // SAFEGUARD: Check for illegal/harmful requests
      if (this.aiHandler.isIllegalRequest(userMessage)) {
        logger.warn(`⚠️  ILLEGAL/HARMFUL REQUEST from ${userId}: "${userMessage}"`);
        this.conversationManager.endConversation(userId);
        return null; // Don't respond to illegal requests
      }

      // CRITICAL: Check if we've already sent the OF link to this user
      // If yes, check if they're refusing or permanently blocked
      const conversationData = this.conversationManager.getConversationState(userId);
      
      if (conversationData && conversationData.permanentlyClosed) {
        logger.info(`🚫 User ${userId} permanently blocked - no more responses`);
        return null; // Permanently ignore them
      }
      
      if (conversationData && conversationData.hasOFLink) {
        // They already got the OF link - check if they're refusing
        if (this.isRefusingOF(userMessage)) {
          logger.info(`👋 REFUSAL DETECTED from ${userId}: "${userMessage.substring(0, 50)}..."`);
          logger.info(`User refusing OF after link sent - sending LAST RESPONSE before closing`);
          const finalMessage = this.getFinalGoodbyeMessage();
          logger.info(`Final goodbye message: "${finalMessage}"`);
          
          // Mark as permanently closed - never respond again
          this.conversationManager.markPermanentlyClosed(userId);
          
          const delay = this.getRandomDelay();
          await new Promise(r => setTimeout(r, delay));
          
          return {
            userId,
            message: finalMessage,
            source: 'final_goodbye',
            hasOFLink: false,
            closeChat: true
          };
        }
        
        // They're not refusing, just ignore the message
        logger.info(`⏭️  OF link already sent to ${userId} - User still replying but not refusing - IGNORING (conversation closing)`);
        return null; // Don't respond at all
      }

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
        // Aggressive redirect - they're trying to avoid OF
        logger.info(`User ${userId} trying to avoid OF - sending aggressive redirect (OF link trigger)`);
        const ofLink = process.env.OF_LINK;
        const redirectMessage = `nah baby all the fun stuff is on my OF hehe\nits free to sub :3\n${ofLink}\nlmk when u do ok? <33`;
        
        // Mark that we sent link - DO NOT end conversation, keep record for restart detection
        this.conversationManager.markOFLinkSent(userId);
        
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

      // ALWAYS use AI for responses (template is just context)
      // Template matching helps provide context to the AI, but we never skip AI
      const match = this.templateMatcher.findMatch(userMessage);
      
      if (match && match.confidence >= 0.5) {
        logger.info(`Template matched: ${match.templateId} (using AI with this context)`);
      }

      // ALWAYS call AI with the user message and system prompt
      logger.info('Calling AI to generate response...');
      response = await this.aiHandler.generateResponse(
        userMessage,
        this.templateMatcher.getSystemPrompt()
      );
      source = 'ai_gemini';
      
      // Check if template indicated this should send OF link
      if (match && match.sendLink) {
        shouldSendLink = true;
        logger.info(`🔗 Template has sendLink flag - OF link will be triggered`);
      }
      
      // Check if user message contains sexual content (independent of template)
      if (this.templateMatcher.isSexualContent(userMessage)) {
        shouldSendLink = true;
        logger.info(`🔥 Sexual/explicit content detected from ${userId} - OF link trigger activated`);
      }
      
      // Check if AI response mentions OF/OnlyFans
      if (response && this.mentionsOnlyFans(response)) {
        shouldSendLink = true;
        logger.info(`🔗 AI response mentions OnlyFans for ${userId} - OF link trigger activated`);
      }

      // Build final response with OF link if needed
      let finalResponse = response;
      let closeChat = false;
      if (shouldSendLink) {
        const ofLink = process.env.OF_LINK;
        const linkMessage = this.templateMatcher.getOFLinkMessage(ofLink);
        finalResponse = `${response}\n\n${linkMessage}`;
        
        // Mark that we sent the link - DO NOT end conversation, keep record for restart detection
        // The conversation record must persist so hasOFLinkBeenSent() can find it on bot restart
        this.conversationManager.markOFLinkSent(userId);
        closeChat = true;
        logger.info(`📨 SENDING OF LINK MESSAGE for ${userId}`);
        logger.info(`Status: CONVERSATION PREPARING TO CLOSE - awaiting user acceptance or refusal`);
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
   * STRICT: Only flag if explicitly mentioning OnlyFans/OF/exclusive content
   */
  mentionsOnlyFans(response) {
    if (!response) return false;
    const lower = response.toLowerCase();
    // ONLY match explicit OnlyFans/OF mentions - NOT vague words like "there"
    const ofKeywords = [
      'onlyfans',
      /\bof\b.*(?:content|exclusive|pics|subscription|link|subscribe)/i,
      'exclusive content',
      'my of',
      'my onlyfans'
    ];
    
    return ofKeywords.some(kw => {
      if (typeof kw === 'string') {
        return lower.includes(kw);
      } else if (kw instanceof RegExp) {
        return kw.test(lower);
      }
      return false;
    });
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

  /**
   * Detect if user is refusing to use OnlyFans after link was sent
   * Examples: "i dont use OF", "i wont make an account", "no thanks", etc
   */
  isRefusingOF(message) {
    if (!message) return false;
    const lower = message.toLowerCase();
    
    // Keywords that indicate refusal to use OF
    const refusalKeywords = [
      "i don't use",
      "i dont use",
      "i won't make",
      "i wont make",
      "won't make an account",
      "wont make an account",
      "not making an account",
      "not gonna join",
      "not going to join",
      "no onlyfans",
      "no of",
      "cant afford",
      "can't afford",
      "too expensive",
      "pass on that",
      "nah im good",
      "im good",
      "i'm good",
      "no thanks",
      "nope",
      "not interested",
      "not really",
      "not for me",
      "not my thing",
      "skip",
      "never",
      "not happening"
    ];
    
    return refusalKeywords.some(kw => lower.includes(kw));
  }

  /**
   * Get a final goodbye message for users who refuse OF
   */
  getFinalGoodbyeMessage() {
    const messages = [
      "okay well thats where im at, lmk when you do :p",
      "no worries babe but thats the only place i do this stuff",
      "nah im only on OF now honestly",
      "i know but thats how it is :3",
      "totally understand but thats the only spot i use",
      "all good but OF is where its at for me"
    ];
    
    return messages[Math.floor(Math.random() * messages.length)];
  }
}

