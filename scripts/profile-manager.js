import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES_PATH = path.join(__dirname, '../config/profiles.json');

// Ensure profiles file exists
function initProfiles() {
    if (!fs.existsSync(PROFILES_PATH)) {
        const data = {
            profiles: [],
            activeProfileId: null
        };
        fs.writeFileSync(PROFILES_PATH, JSON.stringify(data, null, 2));
        return data;
    }
    return JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8'));
}

function getProfiles() {
    const data = initProfiles();
    return data.profiles;
}

function getActiveProfile() {
    const data = initProfiles();
    if (data.activeProfileId) {
        return data.profiles.find(p => p.id === data.activeProfileId);
    }
    return null;
}

function createProfile(name, age, location, race) {
    try {
        let data = initProfiles();
        
        const newId = data.profiles.length > 0 ? Math.max(...data.profiles.map(p => p.id)) + 1 : 1;
        
        data.profiles.push({
            id: newId,
            name: name,
            age: age,
            location: location,
            race: race
        });
        
        fs.writeFileSync(PROFILES_PATH, JSON.stringify(data, null, 2));
        console.log('[OK] Profile created successfully!');
        return true;
    } catch (e) {
        console.error('[ERROR]', e.message);
        return false;
    }
}

function setActiveProfile(profileId) {
    try {
        let data = initProfiles();
        
        const profile = data.profiles.find(p => p.id === profileId);
        if (!profile) {
            console.error('[ERROR] Profile not found');
            return false;
        }
        
        data.activeProfileId = profileId;
        fs.writeFileSync(PROFILES_PATH, JSON.stringify(data, null, 2));
        console.log(`[OK] Active profile set to: ${profile.name}`);
        return true;
    } catch (e) {
        console.error('[ERROR]', e.message);
        return false;
    }
}

function viewProfiles() {
    try {
        const data = initProfiles();
        
        if (data.profiles.length === 0) {
            console.log('No profiles found. Create one first.');
        } else {
            console.log('');
            console.log('========================================');
            console.log('           Available Profiles');
            console.log('========================================');
            
            const activeProfile = getActiveProfile();
            if (activeProfile) {
                console.log(`[ACTIVE] ${activeProfile.name} (Age: ${activeProfile.age}, Location: ${activeProfile.location})`);
            } else {
                console.log('[ACTIVE] None selected');
            }
            
            console.log('');
            console.log('Select a profile by entering its ID:');
            console.log('');
            data.profiles.forEach(p => {
                const marker = activeProfile && p.id === activeProfile.id ? ' ✓' : '';
                console.log(`[${p.id}] ${p.name} | Age: ${p.age} | Location: ${p.location} | Race: ${p.race}${marker}`);
            });
            console.log('');
        }
        return true;
    } catch (e) {
        console.error('[ERROR]', e.message);
        return false;
    }
}

// CLI interface
const args = process.argv.slice(2);
const command = args[0];

if (command === 'create') {
    const name = args[1];
    const age = args[2];
    const location = args[3];
    const race = args[4];
    
    if (!name || !age || !location || !race) {
        console.error('[ERROR] Usage: profile-manager.js create <name> <age> <location> <race>');
        process.exit(1);
    }
    
    createProfile(name, age, location, race);
} else if (command === 'view') {
    viewProfiles();
} else if (command === 'setactive') {
    const profileId = parseInt(args[1]);
    if (!profileId) {
        console.error('[ERROR] Usage: profile-manager.js setactive <profile_id>');
        process.exit(1);
    }
    
    setActiveProfile(profileId);
} else {
    console.error('[ERROR] Unknown command. Use: create, view, or setactive');
    process.exit(1);
}
