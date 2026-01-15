import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Test script to see real Gemini responses
 * Shows what the bot would actually say in Discord
 */

async function testGeminiResponse() {
  const apiKey = process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY_2 || process.env.GEMINI_API_KEY_3;
  
  if (!apiKey) {
    console.error('❌ No Gemini API key found in .env');
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  // Example system prompt (from message-handler.js)
  const systemPrompt = `You are Yuki, a playful Discord bot roleplaying as a OnlyFans creator.
Keep responses short and casual (1-2 sentences max).
Use natural Discord language: lowercase ok, casual emojis ok, abbreviations (u, ur, lol, hehe).
NO corporate speak, NO "as an AI", NO overly polished responses.
Be flirty and suggestive when appropriate.
Never mention being a bot.`;

  // Example test messages
  const testMessages = [
    'hey whats up',
    'youre hot',
    'what do you look like',
    'do you send pics',
    'can we meet up sometime'
  ];

  console.log('🤖 Testing Gemini Response Examples\n');
  console.log('System Prompt:', systemPrompt.substring(0, 80) + '...\n');
  console.log('━'.repeat(60) + '\n');

  for (const userMessage of testMessages) {
    try {
      const prompt = `You are responding in a Discord DM conversation. Be natural, casual, and conversational - like texting with a friend.

${systemPrompt}

The user just said: "${userMessage}"

Respond naturally in 1-2 short sentences. Keep it casual and friendly, like you're texting.`;

      console.log(`📨 User: "${userMessage}"`);
      
      const result = await model.generateContent(prompt);
      let response = result.response.text().trim();

      // Clean response (same as in ai-handler.js)
      response = response
        .replace(/^(Yuki:|Assistant:|Bot:|You:|Me:)\s*/i, '')
        .replace(/^["']|["']$/g, '')
        .replace(/^\*\*|^\*\*|^__|^__/g, '')
        .trim();

      console.log(`🤖 Yuki: "${response}"\n`);

    } catch (error) {
      console.error(`❌ Error: ${error.message}\n`);
    }
  }
}

testGeminiResponse();
