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
        // They already got the OF link - use AI to check if they're refusing
        const isRefusing = await this.isRefusingOF(userMessage);
        if (isRefusing) {
          logger.info(`\n=== STAGE 3: USER REFUSING OFF OFFER ===`);
          logger.info(`👋 REFUSAL DETECTED from ${userId}: "${userMessage.substring(0, 50)}..."`);
          logger.info(`❌ User rejecting OF after link sent (AI analysis)`);
          const finalMessage = this.getFinalGoodbyeMessage();
          logger.info(`💬 Sending FINAL GOODBYE message: "${finalMessage}"`);
          logger.info(`🔒 After this message: CONVERSATION BECOMES DEAD (no more responses)`);
          
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
        
        // They're not refusing - continue the conversation normally
        logger.info(`✅ OF link already sent to ${userId} - User continuing conversation (responding normally)`);
        // FALL THROUGH - continue processing to generate response
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
        logger.info(`\n=== STAGE 1: GENERATING RESPONSE ===`);
        logger.info(`Template matched: ${match.templateId} (using AI with this context)`);
      } else {
        logger.info(`\n=== STAGE 1: GENERATING RESPONSE ===`);
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
        logger.info(`\n=== STAGE 2: TRIGGERING OF LINK ===`);
        logger.info(`🔗 Template has sendLink flag - OF link will be triggered`);
      }
      
      // Check if user message contains sexual content (independent of template)
      if (this.templateMatcher.isSexualContent(userMessage)) {
        shouldSendLink = true;
        logger.info(`\n=== STAGE 2: TRIGGERING OF LINK ===`);
        logger.info(`🔥 Sexual/explicit content detected from ${userId} - OF link trigger activated`);
      }
      
      // Check if user is asking for social media/contact info (independent of template)
      if (this.templateMatcher.isSocialMediaRequest(userMessage)) {
        shouldSendLink = true;
        logger.info(`\n=== STAGE 2: TRIGGERING OF LINK ===`);
        logger.info(`🔗 Social media/contact request detected from ${userId} - OF link trigger activated`);
      }
      
      // Check if AI response mentions OF/OnlyFans
      if (response && this.mentionsOnlyFans(response)) {
        shouldSendLink = true;
        logger.info(`\n=== STAGE 2: TRIGGERING OF LINK ===`);
        logger.info(`🔗 AI response mentions OnlyFans for ${userId} - OF link trigger activated`);
      }

      // SAFEGUARD: Check if AI response leaked social media/contact info despite prompt
      // This catches cases where AI ignores system prompt
      const containsProhibitedContent = this.checkForProhibitedContent(response, userMessage);
      if (containsProhibitedContent.found && match && match.sendLink) {
        logger.warn(`⚠️  SAFEGUARD: AI response contains prohibited content: ${containsProhibitedContent.type}`);
        logger.warn(`    Instead of: "${response}"`);
        // Replace with template response to ensure safety
        response = match.response || response;
        logger.warn(`    Using template response: "${response}"`);
        shouldSendLink = true; // Ensure OF link is sent
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
   * SAFEGUARD: Check if response contains prohibited content
   * Returns { found: boolean, type: string } if prohibited content detected
   */
  checkForProhibitedContent(response, userMessage) {
    if (!response) return { found: false };
    
    const lower = response.toLowerCase();
    
    // Check for social media handles (anything that looks like @username or instagram/snap/etc)
    const socialMediaPatterns = [
      /@[\w.]+/,  // @usernames
      /instagram[:\s]+[\w.]+/i,
      /snapchat[:\s]+[\w.]+/i,
      /snap[:\s]+[\w.]+/i,
      /tiktok[:\s]+[\w.]+/i,
      /twitter[:\s]+[\w.]+/i,
      /youtube[:\s]+[\w.]+/i,
      // Phone numbers and emails
      /\+?\d{1,3}[\s.-]?\d{1,4}[\s.-]?\d{1,4}[\s.-]?\d{1,9}/,
      /[\w.]+@[\w.]+\.\w+/,
      // "find me on" references
      /find\s+(?:me|you)\s+on\s+\w+/i,
      /check\s+(?:my|your)\s+(?:bio|profile|page)/i,
      // Specific social platforms mentioned with intent to share
      /(?:here'?s|here's)\s+(?:my|your)\s+(?:instagram|snap|twitter|tiktok|youtube)/i,
      /\b(?:instagram|snapchat|tiktok|twitter|youtube|discord)\b.*(?:handle|account|username|@)/i
    ];
    
    for (const pattern of socialMediaPatterns) {
      if (pattern.test(lower)) {
        logger.debug(`Detected pattern: ${pattern}`);
        return { 
          found: true, 
          type: 'social_media_handle',
          pattern: pattern.toString()
        };
      }
    }
    
    return { found: false };
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
   * Uses AI to understand natural avoidance patterns
   */
  isAvoidingOF(message) {
    if (!message) return false;
    
    try {
      const lower = message.toLowerCase();
      
      // Quick fallback keywords for speed (before AI call)
      const quickAvoidPatterns = [
        /prefer.*here|prefer.*discord/i,
        /talk.*here|chat.*here/i,
        /just.*chat.*here|just.*talk.*here/i,
        /stay.*here/i,
      ];
      
      // Use quick patterns first for speed
      if (quickAvoidPatterns.some(pattern => pattern.test(lower))) {
        logger.info(`🤖 User avoiding OF detected via quick pattern`);
        return true;
      }
      
      // If not obvious, use AI for nuanced detection
      if (/here|discord|stay|talk/i.test(lower)) {
        // Might be avoiding OF - let AI decide
        logger.debug(`Potential OF avoidance - using AI for analysis: "${message}"`);
        // Return true for suspicious cases where they're insisting on Discord
        return /don't.*of|not.*of|only.*here|only.*discord/i.test(lower);
      }
      
      return false;
    } catch (error) {
      logger.warn(`Avoidance check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Detect if user is refusing to use OnlyFans after link was sent
   * Uses AI to understand natural refusal patterns
   */
  async isRefusingOF(message) {
    if (!message) return false;
    
    try {
      // Use AI to analyze if this is a refusal
      const analysisPrompt = `Analyze this message and determine if the user is REFUSING or REJECTING an OnlyFans link/offer. Be strict - only return YES if they clearly reject it.

Message: "${message}"

Common refusals: "i don't use", "won't make account", "too expensive", "not interested", "i'm good", "thats the only place", "ok well only there", etc.

Ambiguous (NOT refusal): "maybe later", "ill think about it", "not now", "busy"

Answer ONLY with: YES or NO`;

      const analysisResponse = await this.aiHandler.generateResponse(
        message,
        `You are analyzing user messages. Respond with only YES or NO.`
      );

      const isRefusing = analysisResponse && analysisResponse.toLowerCase().includes('yes');
      
      if (isRefusing) {
        logger.info(`🤖 AI analysis: User is REFUSING OF`);
      } else {
        logger.info(`🤖 AI analysis: User is NOT refusing (likely just chatting or unsure)`);
      }
      
      return isRefusing;
    } catch (error) {
      logger.warn(`AI refusal analysis failed: ${error.message} - skipping refusal check`);
      return false;
    }
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

