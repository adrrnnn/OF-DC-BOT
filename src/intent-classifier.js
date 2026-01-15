import { logger } from './logger.js';

/**
 * Intent Classifier - Classifies user intents for proper funnel response
 * 
 * Research on horny people's first messages:
 * - Direct sexual language: "hey wanna see pics", "im horny", "lets sext"
 * - Compliments with intent: "youre so hot", "send nudes", "beautiful body"
 * - Question probing: "what do you do", "are you into", "do you sell"
 * - Context markers: Time of day (late night = horny), direct opener
 */
export class IntentClassifier {
  constructor() {
    this.intents = {
      HORNY_DIRECT: {
        keywords: [
          'horny', 'dick', 'cock', 'pussy', 'fuck', 'sex', 'cum', 'nudes', 'naked', 
          'strip', 'sext', 'jerk', 'masturbate', 'wet', 'hard', 'tits', 'boobs', 'ass',
          'send nudes', 'send pics', 'naked pic', 'nude pic', 'see you naked',
          'wanna fuck', 'lets fuck', 'lets sext', 'im so horny'
        ],
        confidence: 1.0,
        response_style: 'teasing_escalate',
        isSexting: true
      },
      
      COMPLIMENT_SEXUAL: {
        keywords: [
          'youre hot', 'youre beautiful', 'youre sexy', 'gorgeous', 'stunning',
          'you have a nice ass', 'nice body', 'love your curves', 'perfect body',
          'looking good', 'so fine', 'sexy girl', 'beautiful girl', 'hot girl'
        ],
        confidence: 0.95,
        response_style: 'flirty_acknowledge'
      },

      REQUEST_CONTENT: {
        keywords: [
          'show me', 'send pictures', 'send videos', 'can i see', 'can you send',
          'more pics', 'more content', 'exclusive content', 'see you',
          'pics of you', 'photos', 'videos', 'content creator', 'send picture',
          'send photo', 'picture', 'photo', 'image'
        ],
        confidence: 0.85,
        response_style: 'tease_direct',
        isContentRequest: true
      },

      SEXTING_REQUEST: {
        keywords: [
          'sext', 'dirty', 'roleplay', 'chat dirty', 'talk dirty', 'intimate',
          'describe yourself', 'turn me on', 'get me excited', 'get off', 'masturbate'
        ],
        confidence: 0.90,
        response_style: 'tease_direct',
        isSexting: true
      },

      MEETUP_REQUEST: {
        keywords: [
          'meet', 'meetup', 'hook up', 'hookup', 'in person', 'hang out', 'meet up',
          'come over', 'visit', 'where are you', 'location', 'city', 'nearby'
        ],
        confidence: 0.85,
        response_style: 'redirect',
        isSpecialRequest: true
      },

      REFUSED_OF: {
        keywords: [
          'no onlyfans', 'not interested', 'dont do onlyfans', 'wont pay', 'no thanks',
          'not my thing', 'not into that', 'dont care', 'whatever', 'no thanks'
        ],
        confidence: 0.90,
        response_style: 'end_conversation',
        isEndConversation: true
      },

      INQUIRY_BUSINESS: {
        keywords: [
          'what do you do', 'are you a model', 'whats your page', 'do you sell',
          'onlyfans', 'patreon', 'do you post', 'where do you post',
          'do you have', 'where can i see'
        ],
        confidence: 0.80,
        response_style: 'explain_offer'
      },

      PROBING_INTEREST: {
        keywords: [
          'are you into', 'do you like', 'whats your type', 'do you meet',
          'would you', 'would you ever', 'interested in', 'looking for'
        ],
        confidence: 0.75,
        response_style: 'curious_respond'
      },

      GREETING_NORMAL: {
        keywords: [
          'hi', 'hey', 'hello', 'whats up', 'hru', 'how are you', 'how you doing'
        ],
        confidence: 0.60,
        response_style: 'friendly_engage'
      }
    };
  }

  /**
   * Classify user message intent
   * Returns: { intent, confidence, style, followUp }
   */
  classifyIntent(userMessage) {
    const msg = userMessage.toLowerCase().trim();
    let bestMatch = null;
    let bestConfidence = 0;
    let bestIntentKey = null;

    // Check each intent category
    for (const [intentKey, intentData] of Object.entries(this.intents)) {
      for (const keyword of intentData.keywords) {
        // Check for phrase match
        if (msg.includes(keyword.toLowerCase())) {
          // Calculate confidence based on specificity and multiple matches
          let confidence = intentData.confidence;
          
          // Boost confidence if message is ONLY the keyword
          if (msg === keyword.toLowerCase()) {
            confidence = Math.min(1.0, confidence + 0.1);
          }
          
          // Boost if multiple keywords match for this intent
          let matchCount = 0;
          for (const kw of intentData.keywords) {
            if (msg.includes(kw.toLowerCase())) matchCount++;
          }
          
          if (matchCount > 1) {
            confidence = Math.min(1.0, confidence + (matchCount * 0.05));
          }

          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestMatch = intentData;
            bestIntentKey = intentKey;
          }
        }
      }
    }

    // If no match found, default to greeting
    if (!bestMatch) {
      bestIntentKey = 'GREETING_NORMAL';
      bestMatch = this.intents.GREETING_NORMAL;
      bestConfidence = 0.3; // Low confidence = might need AI
    }

    return {
      intent: bestIntentKey,
      confidence: bestConfidence,
      style: bestMatch.response_style,
      userMessage: msg,
      requiresAI: bestConfidence < 0.4 // Use AI if confidence is low
    };
  }

  /**
   * Get funnel stage based on intent and conversation history
   * Determines: should we mention OF? How direct? What to say?
   */
  getFunnelStage(intentData, conversationContext = {}) {
    const { intent, style } = intentData;
    const { messageCount = 0, hasOFLink = false } = conversationContext;

    // First message handling
    if (messageCount === 0) {
      if (intent === 'HORNY_DIRECT' || intent === 'COMPLIMENT_SEXUAL') {
        return {
          stage: 'immediate_response',
          mention_of: true,
          directness: 'high', // Be flirty but direct about OF
          nextAction: 'await_response'
        };
      }

      if (intent === 'REQUEST_CONTENT') {
        return {
          stage: 'immediate_response',
          mention_of: true,
          directness: 'very_high', // They asked directly
          nextAction: 'await_response'
        };
      }

      if (intent === 'INQUIRY_BUSINESS') {
        return {
          stage: 'answer_question',
          mention_of: true,
          directness: 'medium',
          nextAction: 'await_response'
        };
      }

      // Normal greeting on first message
      return {
        stage: 'first_message_greeting',
        mention_of: false,
        directness: 'low',
        nextAction: 'await_follow_up'
      };
    }

    // Multi-message conversation handling
    if (messageCount === 1) {
      // Second message - time to gently escalate if horny vibes
      if (style.includes('teasing') || style.includes('flirty')) {
        return {
          stage: 'escalate_gentle',
          mention_of: true,
          directness: 'medium',
          nextAction: 'await_response'
        };
      }

      // Keep conversation going
      return {
        stage: 'continue_conversation',
        mention_of: false,
        directness: 'low',
        nextAction: 'await_follow_up'
      };
    }

    // Later messages - ONLY mention OF if user shows explicit interest
    // Don't auto-mention just because of message count
    if (messageCount >= 2 && !hasOFLink) {
      // Only mention OF if conversation shows sexual/flirty indicators
      if (style.includes('teasing_escalate') || 
          style.includes('flirty_acknowledge') || 
          intent === 'HORNY_DIRECT' || 
          intent === 'COMPLIMENT_SEXUAL' ||
          intent === 'REQUEST_CONTENT') {
        return {
          stage: 'rapport_introduce_of',
          mention_of: true,
          directness: 'medium',
          nextAction: 'send_link'
        };
      }

      // Keep building rapport without OF mention yet
      return {
        stage: 'continue_conversation',
        mention_of: false,
        directness: 'low',
        nextAction: 'await_follow_up'
      };
    }

    // Already sent OF link
    return {
      stage: 'post_link',
      mention_of: false,
      directness: 'low',
      nextAction: 'await_response'
    };
  }

  /**
   * Get suggested response template based on intent and funnel stage
   */
  getSuggestedResponse(intentData, funnelStage) {
    const { intent, style } = intentData;
    const { stage, directness } = funnelStage;

    // Define response templates for each combination
    const templates = {
      HORNY_DIRECT: {
        immediate_response: [
          "hehe someone eager 😈 i do have exclusive content though if youre interested",
          "oh my hehe youre forward :p i have somewhere with more content if you wanna check",
          "someone seems excited hehe i post exclusive stuff elsewhere 😉"
        ]
      },

      COMPLIMENT_SEXUAL: {
        immediate_response: [
          "aww thank you babe 😊 i actually post exclusive stuff if you wanna see more",
          "youre too sweet :3 i do have content just not on here tho",
          "thankyouu! i have way more if youre interested 😉"
        ],
        escalate_gentle: [
          "youre making me blush hehe want me to show you more somewhere?",
          "you seem like youd like my exclusive content 😉"
        ]
      },

      REQUEST_CONTENT: {
        immediate_response: [
          "i have tons of content just not here :p want me to show you where?",
          "i do post exclusive content but on a different platform if youre interested",
          "hehe i have what youre looking for just not on discord 😉"
        ],
        tease_direct: [
          "maybe if you check out my other stuff first 😉"
        ]
      },

      INQUIRY_BUSINESS: {
        answer_question: [
          "i do onlyfans actually! i post exclusive content there :3 want the link?",
          "yeah i create content for onlyfans hehe want to check it out?",
          "i do content creation on onlyfans! its free to sub btw 😊"
        ]
      },

      GREETING_NORMAL: {
        first_message_greeting: [
          "hey! whats up 😊",
          "hi! how are you?",
          "hey there! whats going on?"
        ],
        continue_conversation: [
          "thats cool! so what brings you to chat?",
          "nice! whats up with you?",
          "thats awesome! tell me more"
        ],
        rapport_introduce_of: [
          "so you seem cool! i actually do content creation on onlyfans if youre interested 😊",
          "btw i post exclusive stuff on onlyfans if you ever want to check it out",
          "hehe fun chatting with you! check out my onlyfans sometime 😉"
        ]
      }
    };

    // Get matching templates
    const intentTemplates = templates[intent] || templates.GREETING_NORMAL;
    const stageTemplates = intentTemplates[stage] || intentTemplates[Object.keys(intentTemplates)[0]];
    
    if (Array.isArray(stageTemplates)) {
      return stageTemplates[Math.floor(Math.random() * stageTemplates.length)];
    }

    return stageTemplates || "hehe wats up?";
  }
}
