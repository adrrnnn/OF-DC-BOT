import { TemplateMatcher } from './src/template-matcher.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Test template responses for appearance, pics, and meetup requests
 */

async function testTemplateRedirects() {
  const templateMatcher = new TemplateMatcher();
  
  const testMessages = [
    'what do you look like',
    'do you send pics',
    'can we meet up sometime'
  ];

  console.log('📋 Testing Template Redirects to OF Link\n');
  console.log('━'.repeat(60) + '\n');

  for (const message of testMessages) {
    const result = templateMatcher.findMatch(message);
    
    console.log(`📨 User: "${message}"`);
    if (result) {
      console.log(`✅ Template Match: ${result.templateId}`);
      console.log(`📝 Response: "${result.response}"`);
      console.log(`🔗 Sends OF Link: ${result.sendLink ? 'YES' : 'NO'}`);
    } else {
      console.log(`❌ No template match (would use Gemini)`);
    }
    console.log();
  }
}

testTemplateRedirects();
