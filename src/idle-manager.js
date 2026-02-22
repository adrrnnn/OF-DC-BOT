import { logger } from './logger.js';

/**
 * Idle Manager - Manages bot polling state
 * Transitions between IDLE (60s polling) and ACTIVE (5s polling)
 * Detects new messages via MutationObserver (instant trigger)
 * Sends keep-alive signals to prevent React rendering sleep
 */
export class IdleManager {
  constructor() {
    this.state = 'IDLE'; // IDLE or ACTIVE
    this.inactivityTimer = null;
    this.keepAliveInterval = null;
    this.mutationObserver = null;
    
    // Timing constants
    this.IDLE_TIMEOUT = 30000; // 30s: switch to IDLE after no activity
    this.KEEP_ALIVE_INTERVAL = 90000; // 90s: prevent React from sleeping
    this.ACTIVITY_DEBOUNCE = 2000; // 2s: debounce rapid activity signals
    this.lastActivityTime = Date.now();
    this.debounceTimer = null;
    
    // Callbacks
    this.onStateChange = null; // (state) => void
  }

  /**
   * Initialize idle manager with page context
   * (MutationObserver removed - was too aggressive and destabilized Discord page)
   */
  initializeObserver(page) {
    if (!page) {
      logger.warn('Cannot initialize observer without page context');
      return;
    }

    // MutationObserver removed: It was firing thousands of times per second during
    // Discord's constant re-renders, causing memory buildup and page instability
    // Keeping it simple: polling + keep-alive is sufficient
    logger.info('[IDLE] Observer initialization skipped (using polling + keep-alive)');
  }

  /**
   * Start monitoring page for activity
   * Simplified: Polling + manual activity signals from bot.js are sufficient
   */
  startMonitoring(page) {
    if (!page) return;

    try {
      page.on('error', () => {}); // Suppress errors
      logger.info('[IDLE] Activity monitoring started (polling-based)');
    } catch (error) {
      logger.debug(`Activity monitoring setup failed: ${error.message}`);
    }
  }

  /**
   * Signal activity - transitions IDLE → ACTIVE if needed
   */
  signalActivity() {
    const now = Date.now();
    
    // Debounce rapid signals
    if (now - this.lastActivityTime < this.ACTIVITY_DEBOUNCE) {
      return;
    }

    this.lastActivityTime = now;

    // Clear existing inactivity timer
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }

    const wasIdle = this.state === 'IDLE';

    if (wasIdle) {
      this.setState('ACTIVE');
      if (this.onStateChange) {
        this.onStateChange('ACTIVE');
      }
      logger.info('[IDLE] State: IDLE → ACTIVE (activity detected)');
    }

    // Set timer to go back to IDLE after inactivity
    this.inactivityTimer = setTimeout(() => {
      if (this.state === 'ACTIVE') {
        this.setState('IDLE');
        if (this.onStateChange) {
          this.onStateChange('IDLE');
        }
        logger.info('[IDLE] State: ACTIVE → IDLE (inactivity timeout)');
      }
    }, this.IDLE_TIMEOUT);
  }

  /**
   * Start keep-alive mechanism to prevent React from sleeping
   * Sends periodic mouse events to browser (robust error handling)
   */
  startKeepAlive(page) {
    if (!page) return;

    this.keepAliveInterval = setInterval(async () => {
      if (!page || page.isClosed?.()) {
        return; // Page is gone, stop trying
      }

      try {
        // Send a mouse move event to keep browser "awake"
        // Use async/await to ensure it completes before next interval
        await page.evaluate(() => {
          const event = new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            view: window
          });
          document.documentElement.dispatchEvent(event);
        });
      } catch (error) {
        // Silently ignore errors - page may be unresponsive
        // The main bot loop will detect if page becomes completely unusable
      }
    }, this.KEEP_ALIVE_INTERVAL);

    logger.info('[IDLE] Keep-alive heartbeat started (every 90s)');
  }

  /**
   * Stop keep-alive mechanism
   */
  stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
      logger.info('[IDLE] Keep-alive heartbeat stopped');
    }
  }

  /**
   * Get current polling interval based on state
   */
  getPollingInterval() {
    if (this.state === 'ACTIVE') {
      return 5000; // 5 seconds when active
    } else {
      return 60000; // 60 seconds when idle
    }
  }

  /**
   * Get current state
   */
  getState() {
    return this.state;
  }

  /**
   * Set state internally
   */
  setState(newState) {
    this.state = newState;
  }

  /**
   * Force ACTIVE state (used when bot starts sending messages)
   */
  setActive() {
    if (this.state !== 'ACTIVE') {
      this.setState('ACTIVE');
      this.signalActivity();
      if (this.onStateChange) {
        this.onStateChange('ACTIVE');
      }
    }
  }

  /**
   * Cleanup on shutdown
   */
  cleanup() {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.stopKeepAlive();
    logger.info('[IDLE] IdleManager cleaned up');
  }
}
