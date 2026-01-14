/**
 * Test Message Extraction Logic
 * Tests the message parsing without needing Discord login
 */

// Simulate Discord DOM structure and test message extraction
const testMessageExtraction = () => {
  // Create mock DOM messages
  const mockMessages = [
    {
      fullText: `kuangg
You
3:45
hey there baby`,
      expected: { author: 'kuangg', content: 'hey there baby' }
    },
    {
      fullText: `kuangg
You
3:45 PM
wanna see my OF?`,
      expected: { author: 'kuangg', content: 'wanna see my OF?' }
    },
    {
      fullText: `John
14 January 2026
Monday
3:45 PM
hello world`,
      expected: { author: 'John', content: 'hello world' }
    },
    {
      fullText: `TestUser
15 декабря 2025
понедельник
14:30
Russian message test`,
      expected: { author: 'TestUser', content: 'Russian message test' }
    }
  ];

  console.log('Testing Message Extraction Logic...\n');

  mockMessages.forEach((test, idx) => {
    const lines = test.fullText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    let author = lines[0] || 'Unknown';
    let content = '';

    // Find the actual message by looking for non-timestamp/non-date lines
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];

      // Skip common metadata patterns
      const isTimestamp = /^\d{1,2}:\d{2}$/.test(line) || /^\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)$/.test(line);
      const isDate = /^\d{1,2}\s+\w+\s+\d{4}/.test(line);
      const isRussianDate = /^\d{1,2}\s+[а-яА-Я]+\s+\d{4}/.test(line);
      const isDayOfWeek = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)$/.test(line);
      const isTimeRange = /\d{1,2}:\d{2}.*\d{1,2}:\d{2}/.test(line);

      // If it's not metadata and has content, it's the message
      if (!isTimestamp && !isDate && !isRussianDate && !isDayOfWeek && !isTimeRange && line.length > 2) {
        content = line;
        break;
      }
    }

    author = author.replace(/\s*\d{1,2}:\d{2}.*$/, '').trim();

    const passed = author === test.expected.author && content === test.expected.content;
    const status = passed ? '✓ PASS' : '✗ FAIL';

    console.log(`Test ${idx + 1}: ${status}`);
    console.log(`  Input: "${test.fullText.replace(/\n/g, ' | ')}"`);
    console.log(`  Expected: author="${test.expected.author}", content="${test.expected.content}"`);
    console.log(`  Got:      author="${author}", content="${content}"`);
    if (!passed) {
      console.log(`  Lines parsed: ${JSON.stringify(lines)}`);
    }
    console.log();
  });
};

testMessageExtraction();
