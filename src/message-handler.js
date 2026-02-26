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
  async handleDM(userId, userMessage, options = {}) {
    try {
      logger.info(`Message from ${userId}: "${userMessage}"`);

      const { hasImageAttachment = false } = options;

      // SAFEGUARD: Check for underage claims
      if (this.aiHandler.isUnderage(userMessage)) {
        logger.warn(`⚠️  UNDERAGE CLAIM DETECTED from ${userId}: "${userMessage}"`);
        const blockMessage = `im only talking to ppl 18+`;
        
        // Mark as permanently closed - NEVER respond again after this
        this.conversationManager.markPermanentlyClosed(userId);
        
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
        const blockMessage = `im not into that`;
        
        // Mark as permanently closed - NEVER respond again after this
        this.conversationManager.markPermanentlyClosed(userId);
        
        return {
          userId,
          message: blockMessage,
          source: 'safeguard_illegal',
          hasOFLink: false,
          closeChat: true
        };
      }

      // If the user sent an image attachment, short-circuit the funnel and
      // use the \"blurred/ISP\" message from the funnel doc.
      if (hasImageAttachment) {
        logger.info(`🖼️  Image attachment detected from ${userId} - using image redirect flow`);

        const ofLink = process.env.OF_LINK;
        const baseMessage = `oh thats blurred for me, maybe my ISP is blocking it, maybe send it here? :3`;

        let finalMessage = baseMessage;
        let hasOFLink = false;

        if (ofLink) {
          const linkMessage = this.templateMatcher.getOFLinkMessage(ofLink);
          finalMessage = `${baseMessage}\n\n${linkMessage}`;
          hasOFLink = true;
        }

        if (hasOFLink) {
          // Mark that we sent the OF link so refusal/close logic still works.
          this.conversationManager.markOFLinkSent(userId);
          logger.info(`📤 OF LINK SENT (image redirect) to ${userId}`);
        }

        return {
          userId,
          message: finalMessage,
          source: 'image_redirect',
          hasOFLink,
          closeChat: true
        };
      }

      // INTENT CLASSIFICATION (LLM-based, for OF-link decisions and funnel logic)
      const intentResult = await this.aiHandler.classifyIntent(userMessage);
      if (intentResult) {
        logger.info(
          `Intent for ${userId}: primary="${intentResult.primary_intent}", confidence=${intentResult.confidence.toFixed(
            2
          )}, secondary=[${intentResult.secondary_intents.join(', ')}]`
        );
      } else {
        logger.info(`Intent for ${userId}: classifier unavailable or failed (fallback to heuristics)`);
      }

      // CRITICAL: Check if we've already sent the OF link to this user
      // If yes, check if they're refusing or permanently blocked
      const conversationData = this.conversationManager.getConversationState(userId);
      
      if (conversationData && conversationData.permanentlyClosed) {
        logger.info(`🚫 User ${userId} permanently blocked - no more responses`);
        return null; // Permanently ignore them
      }
      
      if (conversationData && conversationData.hasOFLink) {
        // They already got the OF link - use intent or AI to check if they're refusing
        let isRefusing = false;
        if (intentResult && intentResult.primary_intent === 'refuse_of') {
          isRefusing = true;
          logger.info('🤖 Intent classifier: User is REFUSING OF');
        } else if (
          intentResult &&
          Array.isArray(intentResult.secondary_intents) &&
          intentResult.secondary_intents.includes('refuse_of')
        ) {
          isRefusing = true;
          logger.info('🤖 Intent classifier: User is REFUSING OF (secondary intent)');
        } else {
          // Fallback: old AI-based refusal detector
          isRefusing = await this.isRefusingOF(userMessage);
        }
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
      let isAvoiding = false;
      if (intentResult && intentResult.primary_intent === 'avoid_of') {
        isAvoiding = true;
        logger.info('🤖 Intent classifier: User is AVOIDING OF');
      } else if (
        intentResult &&
        Array.isArray(intentResult.secondary_intents) &&
        intentResult.secondary_intents.includes('avoid_of')
      ) {
        isAvoiding = true;
        logger.info('🤖 Intent classifier: User is AVOIDING OF (secondary intent)');
      } else {
        // Fallback: legacy heuristic
        isAvoiding = this.isAvoidingOF(userMessage);
      }

      if (isAvoiding) {
        // Per funnel rules: do NOT push the OF link unless they explicitly ask for sext/pics/meetup/call.
        // If they want to keep chatting here, we just continue normally.
        logger.info(`User ${userId} is avoiding OF - continuing without OF link`);
      }

      let response;
      let source;
      let shouldSendLink = false;

      // ALWAYS use AI for responses (template is just context)
      // Template matching helps provide context to the AI, but we never skip AI
      const match = await this.templateMatcher.findMatch(userMessage);
      
      if (match && match.confidence >= 0.5) {
        logger.info(`\n=== STAGE 1: GENERATING RESPONSE ===`);
        logger.info(`Template matched: ${match.templateId} (using AI with this context)`);
      } else {
        logger.info(`\n=== STAGE 1: GENERATING RESPONSE ===`);
      }

      // ALWAYS call AI with the user message and system prompt (structured JSON)
      logger.info('Calling AI to generate structured response...');
      const structured = await this.aiHandler.generateStructuredResponse(
        userMessage,
        this.templateMatcher.getSystemPrompt()
      );
      
      // Check if API keys are dead/exhausted or structured call failed
      if (!structured || !structured.reply) {
        logger.error('❌ Structured AI response failed or empty. Add more credits or generate new API key.');
        return null; // Skip this user entirely
      }
      
      response = structured.reply;
      source = 'ai_gemini';

      // Apply funnel rules to avoid inviting long, pointless conversations
      // (e.g. remove trailing phrases like "but we can chat here")
      response = this.applyFunnelResponseRules(response, userMessage);
      
      // Check if template indicated this should send OF link
      if (match && match.sendLink) {
        shouldSendLink = true;
        logger.info(`\n=== STAGE 2: TRIGGERING OF LINK ===`);
        logger.info(`🔗 Template has sendLink flag - OF link will be triggered`);
      }

      // Structured AI can explicitly request sending the OF link (only for sext/pics/meetup/call per prompt)
      if (structured.should_send_of_link === true) {
        shouldSendLink = true;
        logger.info(`\n=== STAGE 2: TRIGGERING OF LINK ===`);
        logger.info(`🤖 Structured AI requested OF link (explicit request detected)`);
      }

      // Fallback heuristic: explicit request patterns (pics/nudes, sexting, meetup, video call)
      // (TemplateMatcher.isSexualContent is intentionally request-pattern-only.)
      if (!shouldSendLink && this.templateMatcher.isSexualContent(userMessage)) {
        shouldSendLink = true;
        logger.info(`\n=== STAGE 2: TRIGGERING OF LINK ===`);
        logger.info(`🔥 Explicit request detected (heuristic) - OF link trigger activated`);
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
   * Apply simple post-processing rules to AI responses
   * to keep them short and avoid inviting long chats.
   */
  applyFunnelResponseRules(response, userMessage) {
    if (!response) return response;

    const original = response;
    const lower = response.toLowerCase();
    const patterns = [
      'but we can just chat here',
      'but we can chat here',
      'but we can just talk here',
      'but we can talk here',
      'but we can keep chatting here',
      "but i'm down to chat here",
      "but im down to chat here",
      "but i'm happy to chat here",
      "but im happy to chat here"
    ];

    let matchedPattern = null;

    for (const pattern of patterns) {
      const idx = lower.indexOf(pattern);
      if (idx !== -1) {
        // Trim everything from the start of the pattern onwards
        response = response.slice(0, idx);
        matchedPattern = pattern;
        break;
      }
    }

    // If no explicit phrase matched, fall back to a more generic pattern:
    // any clause starting with "but" that goes on to mention chatting/talking/vibing here/in the chat.
    if (!matchedPattern) {
      const softInviteRegexes = [
        /\bbut\b[^.!?]{0,120}\b(chat|talk|vibing)\b[^.!?]{0,60}\b(here|in the chat)\b/i,
        /\bbut\b[^.!?]{0,120}\b(here in (?:dms|discord)|keep this here)\b/i
      ];

      for (const re of softInviteRegexes) {
        const match = lower.match(re);
        if (match && typeof match.index === 'number') {
          response = response.slice(0, match.index);
          matchedPattern = re.toString();
          break;
        }
      }
    }

    // Clean up trailing commas/whitespace if we truncated
    response = response.replace(/[,\s]+$/u, '');

    // #region agent log
    fetch('http://127.0.0.1:7621/ingest/69741164-9fc4-4e86-b1ea-caba7a62d14c',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'X-Debug-Session-Id':'71a30f'
      },
      body:JSON.stringify({
        sessionId:'71a30f',
        location:'message-handler.js:applyFunnelResponseRules',
        message:'Funnel response post-processing',
        data:{
          userMessage,
          originalResponse:original,
          finalResponse:response,
          matchedPattern
        },
        hypothesisId:'H1',
        runId:'post-process',
        timestamp:Date.now()
      })
    }).catch(()=>{});
    // #endregion

    return response;
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

