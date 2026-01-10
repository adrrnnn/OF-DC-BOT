import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Parse Reddit training data into structured conversations
 * Used to extract intents and responses for template matching
 */
export class TrainingDataParser {
  /**
   * Parse all Reddit training files
   */
  static parseRedditData() {
    const trainingDir = path.join(process.cwd(), 'Training data', 'Reddit Training Data');
    const conversations = [];

    if (!fs.existsSync(trainingDir)) {
      console.warn('⚠️  Training data directory not found');
      return conversations;
    }

    const files = fs.readdirSync(trainingDir).filter(f => f.endsWith('.txt'));

    for (const file of files) {
      const filePath = path.join(trainingDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = this.parseConversation(content);
      conversations.push(...parsed);
    }

    return conversations;
  }

  /**
   * Parse single conversation text
   */
  static parseConversation(text) {
    const conversations = [];
    const lines = text.split('\n');
    let current = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines and metadata
      if (!line || line.match(/^[\d:APM]+$/) || line.match(/^[A-Za-z]+ \d+/)) {
        continue;
      }

      // Check for username (indicates new message)
      if (line && !line.includes('  ') && i + 1 < lines.length) {
        if (current && current.message) {
          conversations.push(current);
        }
        current = {
          user: line,
          message: '',
          timestamp: new Date()
        };
      } else if (current) {
        current.message += (current.message ? ' ' : '') + line;
      }
    }

    if (current && current.message) {
      conversations.push(current);
    }

    return conversations.filter(c => c.message && c.message.length > 0);
  }

  /**
   * Extract intents from conversations
   */
  static extractIntents(conversations) {
    const intents = {};

    for (const conv of conversations) {
      const msg = conv.message.toLowerCase();

      // Categorize messages
      if (msg.match(/^(hey|hi|hello|hii|hiii|heyy|heyyy)/)) {
        if (!intents.greeting) intents.greeting = [];
        intents.greeting.push(conv.message);
      } else if (msg.match(/(pic|pics|nudes|naked|sexy|show|send)/i)) {
        if (!intents.flirty) intents.flirty = [];
        intents.flirty.push(conv.message);
      } else if (msg.match(/(how are you|hru|how you doing|what's up|whats up|sup|wassup)/i)) {
        if (!intents.greeting) intents.greeting = [];
        intents.greeting.push(conv.message);
      } else if (msg.match(/(onlyfans|OF|subscribe|check out)/i)) {
        if (!intents.ofPromo) intents.ofPromo = [];
        intents.ofPromo.push(conv.message);
      } else if (msg.length > 0) {
        if (!intents.general) intents.general = [];
        intents.general.push(conv.message);
      }
    }

    return intents;
  }

  /**
   * Generate template suggestions from intents
   */
  static generateTemplates(intents) {
    const templates = [];

    if (intents.greeting && intents.greeting.length > 0) {
      templates.push({
        id: 'greeting',
        variations: intents.greeting.slice(0, 10),
        keywords: ['hey', 'hi', 'hello', 'hii', 'hiii']
      });
    }

    if (intents.flirty && intents.flirty.length > 0) {
      templates.push({
        id: 'sexual_response',
        variations: intents.flirty.slice(0, 5),
        keywords: ['pic', 'nudes', 'sexy', 'show me', 'send']
      });
    }

    if (intents.ofPromo && intents.ofPromo.length > 0) {
      templates.push({
        id: 'funnel_response',
        variations: intents.ofPromo.slice(0, 5),
        keywords: ['onlyfans', 'OF', 'subscribe']
      });
    }

    return templates;
  }

  /**
   * Save templates to config
   */
  static saveTemplates(templates) {
    const configPath = path.join(process.cwd(), 'config', 'templates.json');
    const data = { templates };
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
    console.log(`✅ Saved ${templates.length} templates to ${configPath}`);
  }

  /**
   * Initialize training data
   */
  static initialize() {
    console.log('📚 Parsing training data...');
    const conversations = this.parseRedditData();
    console.log(`   Found ${conversations.length} conversations`);

    const intents = this.extractIntents(conversations);
    console.log(`   Extracted ${Object.keys(intents).length} intent categories`);

    const templates = this.generateTemplates(intents);
    this.saveTemplates(templates);

    return templates;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  TrainingDataParser.initialize();
}
