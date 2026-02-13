import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES_PATH = path.join(__dirname, '../config/profiles.json');

export class ProfileLoader {
  constructor() {
    this.profiles = this.loadProfiles();
    this.activeProfile = this.getActiveProfile();
  }

  loadProfiles() {
    try {
      if (fs.existsSync(PROFILES_PATH)) {
        const data = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8'));
        return data.profiles || [];
      }
      return [];
    } catch (e) {
      logger.warn('Failed to load profiles: ' + e.message);
      return [];
    }
  }

  getActiveProfile() {
    try {
      if (fs.existsSync(PROFILES_PATH)) {
        const data = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8'));
        const activeId = data.activeProfileId;
        
        if (activeId) {
          const profile = data.profiles.find(p => p.id === activeId);
          if (profile) {
            logger.info(`Active profile: ${profile.name} (${profile.age}, ${profile.location})`);
            return profile;
          }
        }
        
        // Fallback to first profile if no active profile set
        if (data.profiles.length > 0) {
          logger.info(`No active profile set, using first: ${data.profiles[0].name}`);
          return data.profiles[0];
        }
      }
      return null;
    } catch (e) {
      logger.warn('Failed to get active profile: ' + e.message);
      return null;
    }
  }

  getProfileData(field) {
    if (!this.activeProfile) {
      return null;
    }
    return this.activeProfile[field] || null;
  }

  getName() {
    return this.getProfileData('name');
  }

  getAge() {
    return this.getProfileData('age');
  }

  getLocation() {
    return this.getProfileData('location');
  }

  getRace() {
    return this.getProfileData('race');
  }

  refresh() {
    this.profiles = this.loadProfiles();
    this.activeProfile = this.getActiveProfile();
  }
}
