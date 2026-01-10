import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.join(process.cwd(), 'logs');

// Ensure logs directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logFile = path.join(logDir, `bot-${new Date().toISOString().split('T')[0]}.log`);

export const logger = {
  debug: (msg, data = null) => {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    const formatted = `[${timestamp}] [DEBUG] ${msg}${dataStr}`;
    console.log(formatted);
    fs.appendFileSync(logFile, formatted + '\n');
  },

  info: (msg, data = null) => {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    const formatted = `[${timestamp}] [INFO] ${msg}${dataStr}`;
    console.log(formatted);
    fs.appendFileSync(logFile, formatted + '\n');
  },

  warn: (msg, data = null) => {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    const formatted = `[${timestamp}] [WARN] ${msg}${dataStr}`;
    console.warn(formatted);
    fs.appendFileSync(logFile, formatted + '\n');
  },

  error: (msg, data = null) => {
    const timestamp = new Date().toISOString();
    let errorMsg = msg;
    if (data && typeof data === 'object' && data.error) {
      errorMsg = `${msg}: ${data.error}`;
    } else if (data) {
      errorMsg = `${msg} ${JSON.stringify(data)}`;
    }
    const formatted = `[${timestamp}] [ERROR] ${errorMsg}`;
    console.error(formatted);
    fs.appendFileSync(logFile, formatted + '\n');
  }
};
