import fs from 'fs';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');
const dmCacheFile = path.join(dataDir, 'dm-cache.json');

// Ensure data directory
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * DM Cache Manager
 * Tracks per-DM state to detect new messages without checking every DM every time
 * Stores: lastMessageId, lastCheckTime, messageCount, hasNewMessages
 */
export class DMCacheManager {
  constructor() {
    this.dmCache = new Map(); // userId -> { lastMessageId, lastCheckTime, messageCount, hasNewMessages }
    this.loadCache();
  }

  loadCache() {
    if (fs.existsSync(dmCacheFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(dmCacheFile, 'utf8'));
        this.dmCache = new Map(Object.entries(data));
      } catch (e) {
        // Start fresh
      }
    }
  }

  saveCache() {
    try {
      const data = Object.fromEntries(this.dmCache);
      fs.writeFileSync(dmCacheFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      // Ignore write errors
    }
  }

  /**
   * Initialize cache for a new DM
   */
  initializeDM(userId, lastMessageId = null, messageCount = 0) {
    this.dmCache.set(userId, {
      lastMessageId,
      lastCheckTime: Date.now(),
      messageCount,
      hasNewMessages: false,
    });
    this.saveCache();
  }

  /**
   * Check if a DM should be checked (only if state changed or hasn't been checked recently)
   */
  shouldCheckDM(userId, minCheckIntervalMs = 30000) {
    if (!this.dmCache.has(userId)) {
      return true; // New DM, check it
    }

    const cached = this.dmCache.get(userId);
    const timeSinceLastCheck = Date.now() - cached.lastCheckTime;

    // Check every 30 seconds at minimum
    return timeSinceLastCheck > minCheckIntervalMs;
  }

  /**
   * Get all DMs that should be checked
   */
  getDMsToCheck(minCheckIntervalMs = 30000) {
    const dmsToCheck = [];
    for (const [userId, cache] of this.dmCache) {
      if (this.shouldCheckDM(userId, minCheckIntervalMs)) {
        dmsToCheck.push(userId);
      }
    }
    return dmsToCheck;
  }

  /**
   * Update DM state after checking
   * Returns true if NEW message detected
   */
  updateDMState(userId, latestMessageId, messageCount) {
    const cached = this.dmCache.get(userId);
    
    if (!cached) {
      // First time checking this DM
      this.initializeDM(userId, latestMessageId, messageCount);
      return true; // Treat as new
    }

    const hasNewMessage = latestMessageId && cached.lastMessageId && 
                         latestMessageId !== cached.lastMessageId;

    this.dmCache.set(userId, {
      lastMessageId: latestMessageId,
      lastCheckTime: Date.now(),
      messageCount,
      hasNewMessages: hasNewMessage,
    });

    this.saveCache();
    return hasNewMessage;
  }

  /**
   * Get cached info for a DM
   */
  getDMCache(userId) {
    return this.dmCache.get(userId);
  }

  /**
   * Mark DM as checked (update timestamp)
   */
  markChecked(userId) {
    const cached = this.dmCache.get(userId);
    if (cached) {
      cached.lastCheckTime = Date.now();
      this.saveCache();
    }
  }

  /**
   * Clear old cache entries (older than X hours)
   */
  pruneOldEntries(ageHours = 24) {
    const maxAge = ageHours * 60 * 60 * 1000;
    const now = Date.now();
    
    let pruned = 0;
    for (const [userId, cache] of this.dmCache) {
      if (now - cache.lastCheckTime > maxAge) {
        this.dmCache.delete(userId);
        pruned++;
      }
    }

    if (pruned > 0) {
      this.saveCache();
    }

    return pruned;
  }

  /**
   * Get list of all DMs in cache
   */
  getAllDMs() {
    return Array.from(this.dmCache.keys());
  }

  /**
   * Clear entire cache
   */
  clearCache() {
    this.dmCache.clear();
    if (fs.existsSync(dmCacheFile)) {
      fs.unlinkSync(dmCacheFile);
    }
  }
}
