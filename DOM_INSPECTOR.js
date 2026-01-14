/**
 * DOM Inspector Helper
 * 
 * Run this in Discord DevTools console to see what message selectors work
 * Open Discord, go to DevTools (F12), go to Console tab, paste this code
 */

console.log('=== DISCORD DOM INSPECTOR ===\n');

// Check for various message selectors
const selectors = [
  '[role="article"]',
  '[data-qa-type="message"]',
  '[class*="message"]',
  '[class*="container"]',
  '[role="main"] div',
  'main div',
  '[class*="chatContent"] div',
  '[class*="messageContent"]',
  'div[data-qa-type]',
  '[class*="Message"]',
];

console.log('Checking selectors for message elements...\n');

selectors.forEach(selector => {
  const elements = document.querySelectorAll(selector);
  if (elements.length > 0) {
    console.log(`✓ ${selector}: ${elements.length} element(s) found`);
    
    // Show first element's text content length
    const firstText = elements[0].textContent?.substring(0, 50) || '(empty)';
    console.log(`  First element text: "${firstText}..."`);
  }
});

// Try to find the chat container
console.log('\n\nLooking for chat containers...');
const chatContainers = [
  document.querySelector('[role="main"]'),
  document.querySelector('main'),
  document.querySelector('[class*="chatContent"]'),
  document.querySelector('[class*="chat"]'),
];

chatContainers.forEach((container, idx) => {
  if (container) {
    const childCount = container.querySelectorAll(':scope > *').length;
    console.log(`Container ${idx}: Found, ${childCount} direct children`);
    console.log(`  HTML: ${container.outerHTML.substring(0, 100)}...`);
  }
});

// Inspect actual message elements more deeply
console.log('\n\nDetailed message inspection:');
const messageElements = document.querySelectorAll('[role="article"]');
if (messageElements.length > 0) {
  messageElements.forEach((msg, idx) => {
    console.log(`\nMessage ${idx}:`);
    console.log(`  Classes: ${msg.className}`);
    console.log(`  HTML: ${msg.outerHTML.substring(0, 200)}...`);
    console.log(`  Text content: "${msg.textContent?.substring(0, 100)}..."`);
  });
} else {
  console.log('No [role="article"] elements found');
  
  // Try to find what does exist
  const allDivs = document.querySelectorAll('div[class]');
  const messageishDivs = Array.from(allDivs)
    .filter(div => div.textContent && div.textContent.length > 20 && div.textContent.length < 500)
    .slice(0, 5);
  
  console.log(`\nFound ${messageishDivs.length} potential message divs:`);
  messageishDivs.forEach((div, idx) => {
    console.log(`\nPotential message ${idx}:`);
    console.log(`  Classes: ${div.className}`);
    console.log(`  Text: "${div.textContent.substring(0, 80)}..."`);
  });
}

console.log('\n=== END INSPECTION ===');
