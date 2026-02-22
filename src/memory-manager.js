import { logger } from './logger.js';

/**
 * Memory Manager - Monitors heap memory and triggers proactive page reloads
 * Prevents "Aw, Snap!" OOM crashes by reloading page before memory limit is hit
 */
export class MemoryManager {
  constructor() {
    this.lastReloadTime = Date.now();
    this.peakMemoryUsed = 0;
    this.memoryCheckInterval = null;
    this.forceReloadInterval = null;
    
    // Memory thresholds (in bytes)
    this.MEMORY_ALERT_THRESHOLD = 1200 * 1024 * 1024; // 1.2 GB - reload if exceeded
    this.MEMORY_OK_THRESHOLD = 800 * 1024 * 1024;     // 800 MB - normal operating range
    this.FORCE_RELOAD_INTERVAL_MS = 45 * 60 * 1000;   // 45 minutes - force reload regardless
    
    // For tracking over time
    this.memoryHistory = [];
    this.maxHistorySize = 100;
  }

  /**
   * Start memory monitoring
   */
  start(page, onMemoryThresholdReached) {
    if (!page) return;

    logger.info('[MEMORY] Memory monitoring started (threshold: 1.2GB, force reload: 45min)');

    // Periodic memory check (every 30 seconds)
    this.memoryCheckInterval = setInterval(async () => {
      const memUsage = this.getMemoryUsage();
      
      if (memUsage.heapUsed > this.MEMORY_ALERT_THRESHOLD) {
        logger.warn(
          `[MEMORY] ⚠️ ALERT: Heap memory high (${memUsage.heapUsedMB}MB / ${memUsage.heapLimitMB}MB) - triggering page reload`
        );
        
        if (onMemoryThresholdReached) {
          await onMemoryThresholdReached();
        }
        
        // Reset last reload time since we just reloaded
        this.lastReloadTime = Date.now();
      } else if (memUsage.heapUsed > this.MEMORY_OK_THRESHOLD) {
        // Non-critical warning for monitoring
        logger.debug(
          `[MEMORY] Info: Heap at ${memUsage.heapUsedMB}MB / ${memUsage.heapLimitMB}MB (${memUsage.heapUsedPercent}%)`
        );
      }
    }, 30000);

    // Force reload every 45 minutes (prevents 30-min Discord cache buildup)
    this.forceReloadInterval = setInterval(async () => {
      const elapsedMins = Math.round((Date.now() - this.lastReloadTime) / 60000);
      
      logger.info(`[MEMORY] 📅 45-minute periodic refresh triggered (elapsed: ${elapsedMins} min)`);
      
      if (onMemoryThresholdReached) {
        await onMemoryThresholdReached();
      }
      
      this.lastReloadTime = Date.now();
    }, this.FORCE_RELOAD_INTERVAL_MS);
  }

  /**
   * Get current memory usage
   */
  getMemoryUsage() {
    const memUsage = process.memoryUsage();
    
    const result = {
      heapUsed: memUsage.heapUsed,
      heapLimit: memUsage.heapLimit,
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapLimitMB: Math.round(memUsage.heapLimit / 1024 / 1024),
      heapUsedPercent: Math.round((memUsage.heapUsed / memUsage.heapLimit) * 100),
      rss: memUsage.rss,
      rssMB: Math.round(memUsage.rss / 1024 / 1024),
    };

    // Track peak memory
    if (result.heapUsed > this.peakMemoryUsed) {
      this.peakMemoryUsed = result.heapUsed;
    }

    // Keep history for trend analysis
    this.memoryHistory.push(result);
    if (this.memoryHistory.length > this.maxHistorySize) {
      this.memoryHistory.shift();
    }

    return result;
  }

  /**
   * Get memory growth rate (MB per minute)
   */
  getGrowthRate() {
    if (this.memoryHistory.length < 2) return 0;

    const first = this.memoryHistory[0];
    const last = this.memoryHistory[this.memoryHistory.length - 1];
    
    // All history entries are 30 seconds apart
    const timeSpanMins = (this.memoryHistory.length * 30) / 60;
    const memGrowthMB = (last.heapUsedMB - first.heapUsedMB);
    
    if (timeSpanMins === 0) return 0;
    return memGrowthMB / timeSpanMins;
  }

  /**
   * Get estimated time until OOM crash at current growth rate
   */
  getTimeUntilOOM() {
    const growthRate = this.getGrowthRate();
    if (growthRate <= 0) return Infinity;

    const memUsage = this.getMemoryUsage();
    const memRemainingMB = memUsage.heapLimitMB - memUsage.heapUsedMB;
    const minutesUntilOOM = memRemainingMB / growthRate;

    return minutesUntilOOM;
  }

  /**
   * Get memory status report
   */
  getStatusReport() {
    const memUsage = this.getMemoryUsage();
    const growthRate = this.getGrowthRate();
    const timeUntilOOM = this.getTimeUntilOOM();

    return {
      current: `${memUsage.heapUsedMB}MB / ${memUsage.heapLimitMB}MB (${memUsage.heapUsedPercent}%)`,
      rss: `${memUsage.rssMB}MB`,
      growthRate: `${growthRate.toFixed(2)} MB/min`,
      timeUntilOOM: timeUntilOOM === Infinity ? 'N/A' : `${Math.round(timeUntilOOM)} min`,
      peak: `${Math.round(this.peakMemoryUsed / 1024 / 1024)}MB`,
    };
  }

  /**
   * Stop memory monitoring
   */
  stop() {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }
    if (this.forceReloadInterval) {
      clearInterval(this.forceReloadInterval);
      this.forceReloadInterval = null;
    }
    logger.info('[MEMORY] Memory monitoring stopped');
  }

  /**
   * Cleanup
   */
  cleanup() {
    this.stop();
  }
}
