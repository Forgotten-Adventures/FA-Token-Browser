/**
 * System Detection Utility for Token Browser Drag & Drop
 * Identifies the current game system and provides system-specific actor type mappings
 */

/**
 * Actor type mapping for different game systems
 * Each system maps to its preferred actor types and required fields
 */
const ACTOR_TYPE_MAPPINGS = {
  // D&D 5th Edition
  'dnd5e': {
    defaultType: 'npc',
    supportedTypes: ['character', 'npc', 'vehicle'],
    requiredFields: ['name', 'type'],
    optionalFields: ['img'],
    description: 'D&D 5th Edition'
  },
  
  // Pathfinder 2nd Edition
  'pf2e': {
    defaultType: 'npc',
    supportedTypes: ['character', 'npc', 'familiar', 'vehicle'],
    requiredFields: ['name', 'type'],
    optionalFields: ['img'],
    description: 'Pathfinder 2nd Edition'
  },
  
  // Pathfinder 1st Edition
  'pf1': {
    defaultType: 'npc',
    supportedTypes: ['character', 'npc'],
    requiredFields: ['name', 'type'],
    optionalFields: ['img'],
    description: 'Pathfinder 1st Edition'
  },
  
  // Savage Worlds Adventure Edition
  'swade': {
    defaultType: 'npc',
    supportedTypes: ['character', 'npc', 'vehicle'],
    requiredFields: ['name', 'type'],
    optionalFields: ['img'],
    description: 'Savage Worlds Adventure Edition'
  },
  
  // Warhammer Fantasy Roleplay 4th Edition
  'wfrp4e': {
    defaultType: 'npc',
    supportedTypes: ['character', 'npc', 'creature', 'vehicle'],
    requiredFields: ['name', 'type'],
    optionalFields: ['img'],
    description: 'Warhammer Fantasy Roleplay 4th Edition'
  },
  
  // Call of Cthulhu 7th Edition
  'coc7': {
    defaultType: 'npc',
    supportedTypes: ['character', 'npc', 'creature'],
    requiredFields: ['name', 'type'],
    optionalFields: ['img'],
    description: 'Call of Cthulhu 7th Edition'
  },
  
  // Cyberpunk RED
  'cyberpunk-red-core': {
    defaultType: 'character',
    supportedTypes: ['character', 'npc'],
    requiredFields: ['name', 'type'],
    optionalFields: ['img'],
    description: 'Cyberpunk RED'
  },
  
  // Shadowrun 5th Edition
  'shadowrun5e': {
    defaultType: 'character',
    supportedTypes: ['character', 'npc', 'spirit', 'vehicle'],
    requiredFields: ['name', 'type'],
    optionalFields: ['img'],
    description: 'Shadowrun 5th Edition'
  },
  
  // Alien RPG
  'alien-rpg': {
    defaultType: 'character',
    supportedTypes: ['character', 'npc', 'creature'],
    requiredFields: ['name', 'type'],
    optionalFields: ['img'],
    description: 'Alien RPG'
  },
  
  // Forbidden Lands
  'forbidden-lands': {
    defaultType: 'npc',
    supportedTypes: ['character', 'npc', 'monster'],
    requiredFields: ['name', 'type'],
    optionalFields: ['img'],
    description: 'Forbidden Lands'
  },
  
  // Generic fallback for unknown systems
  'generic': {
    defaultType: 'character',
    supportedTypes: ['character', 'npc'],
    requiredFields: ['name'],
    optionalFields: ['type', 'img'],
    description: 'Generic System'
  }
};

/**
 * Fallback actor types in order of preference
 * These will be tried in sequence if the preferred type fails
 */
const FALLBACK_ACTOR_TYPES = ['npc', 'character'];

/**
 * Get the current game system identifier
 * @returns {string} The current system ID (e.g., 'dnd5e', 'pf2e', 'generic')
 */
export function getCurrentSystemId() {
  if (!game || !game.system) {
    console.warn('fa-token-browser | System detection: game.system not available, defaulting to generic');
    return 'generic';
  }
  
  const systemId = game.system.id;
  
  // Check if this is a known system, log warning if using generic fallback
  if (!ACTOR_TYPE_MAPPINGS[systemId]) {
    console.info(`fa-token-browser | System detection: Unknown system "${systemId}", using generic fallback`);
  }
  
  return systemId;
}

/**
 * Get the current game system title/name
 * @returns {string} The current system title (e.g., 'Dungeons & Dragons 5th Edition')
 */
export function getCurrentSystemTitle() {
  if (!game || !game.system) {
    return 'Unknown System';
  }
  
  return game.system.title || game.system.id || 'Unknown System';
}

/**
 * Check if the current system is a known/supported system
 * @returns {boolean} True if the system has specific support, false if it will use generic fallback
 */
export function isKnownSystem() {
  const systemId = getCurrentSystemId();
  const knownSystems = Object.keys(ACTOR_TYPE_MAPPINGS).filter(id => id !== 'generic');
  
  const isKnown = knownSystems.includes(systemId);
  return isKnown;
}

/**
 * Get actor type mapping for the current system
 * @returns {Object} Actor type mapping object with defaultType, supportedTypes, and requiredFields
 */
export function getActorTypeMapping() {
  const systemId = getCurrentSystemId();
  const mapping = ACTOR_TYPE_MAPPINGS[systemId] || ACTOR_TYPE_MAPPINGS['generic'];
  
  return mapping;
}

/**
 * Get the default actor type for the current system
 * @returns {string} The default actor type (e.g., 'npc', 'character')
 */
export function getDefaultActorType() {
  const mapping = getActorTypeMapping();
  const defaultType = mapping.defaultType;
  
  return defaultType;
}

/**
 * Get supported actor types for the current system
 * @returns {Array<string>} Array of supported actor type strings
 */
export function getSupportedActorTypes() {
  const mapping = getActorTypeMapping();
  const supportedTypes = mapping.supportedTypes;
  
  return supportedTypes;
}

/**
 * Get required fields for actor creation in the current system
 * @returns {Array<string>} Array of required field names
 */
export function getRequiredActorFields() {
  const mapping = getActorTypeMapping();
  const requiredFields = mapping.requiredFields;
  
  return requiredFields;
}

/**
 * Check if a specific actor type is supported by the current system
 * @param {string} actorType - The actor type to check
 * @returns {boolean} True if the actor type is supported
 */
export function isActorTypeSupported(actorType) {
  const supportedTypes = getSupportedActorTypes();
  const isSupported = supportedTypes.includes(actorType);
  
  return isSupported;
}

/**
 * Get fallback actor types in order of preference
 * Returns types to try if the default/preferred type fails
 * @returns {Array<string>} Array of actor types to try in sequence
 */
export function getFallbackActorTypes() {
  const defaultType = getDefaultActorType();
  const supportedTypes = getSupportedActorTypes();
  
  // Start with the default type for this system
  const fallbackSequence = [defaultType];
  
  // Add standard fallback types if they're supported and not already included
  FALLBACK_ACTOR_TYPES.forEach(type => {
    if (!fallbackSequence.includes(type) && supportedTypes.includes(type)) {
      fallbackSequence.push(type);
    }
  });
  
  // Add any remaining supported types as last resort
  supportedTypes.forEach(type => {
    if (!fallbackSequence.includes(type)) {
      fallbackSequence.push(type);
    }
  });
  
  return fallbackSequence;
}



/**
 * Get minimal actor data structure for emergency fallback
 * Used when all typed actor creation attempts fail
 * @param {string} name - Actor name
 * @param {string} imageUrl - Token image URL
 * @returns {Object} Minimal actor data that should work with any system
 */
export function getMinimalActorData(name, imageUrl) {
  const minimalData = {
    name: name,
    img: imageUrl
  };
  
  // Add type field if it might be helpful (but not required)
  const systemId = getCurrentSystemId();
  if (systemId !== 'generic') {
    minimalData.type = 'character'; // Most universal type
  }
  
  return minimalData;
}

/**
 * Get actor data for a specific type with system-appropriate fields
 * @param {string} actorType - The type of actor to create
 * @param {string} name - Actor name
 * @param {string} imageUrl - Token image URL
 * @param {Object} tokenData - Token prototype data (dimensions, scale, etc.)
 * @returns {Object} Complete actor data structure for the specified type
 */
export function getActorDataForType(actorType, name, imageUrl, tokenData = {}) {
  const requiredFields = getRequiredActorFields();
  const systemId = getCurrentSystemId();
  
  // Start with base data
  const actorData = {
    name: name,
    img: imageUrl
  };
  
  // Add type if required
  if (requiredFields.includes('type')) {
    actorData.type = actorType;
  }
  
  // Add prototype token data
  if (tokenData && Object.keys(tokenData).length > 0) {
    actorData.prototypeToken = {
      name: name,
      texture: {
        src: imageUrl
      },
      ...tokenData
    };
  }
  
  return actorData;
}

/**
 * Test if actor creation would likely succeed with given data
 * Performs basic validation without actually creating the actor
 * @param {Object} actorData - Actor data to validate
 * @returns {boolean} True if the data looks valid for actor creation
 */
export function validateActorData(actorData) {
  if (!actorData || typeof actorData !== 'object') {
    console.warn('fa-token-browser | System detection: Invalid actor data - not an object');
    return false;
  }
  
  const requiredFields = getRequiredActorFields();
  const missingFields = requiredFields.filter(field => !actorData.hasOwnProperty(field) || !actorData[field]);
  
  if (missingFields.length > 0) {
    console.warn(`fa-token-browser | System detection: Actor data missing required fields:`, missingFields);
    return false;
  }
  
  // Validate actor type if specified
  if (actorData.type && !isActorTypeSupported(actorData.type)) {
    console.warn(`fa-token-browser | System detection: Unsupported actor type: "${actorData.type}"`);
    return false;
  }
  
  return true;
}

/**
 * Get system information including ID, title, and support status
 * @returns {Object} System information object
 */
export function getSystemInfo() {
  const systemId = getCurrentSystemId();
  const systemTitle = getCurrentSystemTitle();
  const isKnown = isKnownSystem();
  const actorMapping = getActorTypeMapping();
  
  const info = {
    id: systemId,
    title: systemTitle,
    isKnown: isKnown,
    version: game?.system?.version || 'unknown',
    actorTypes: {
      default: actorMapping.defaultType,
      supported: actorMapping.supportedTypes,
      requiredFields: actorMapping.requiredFields,
      fallbackSequence: getFallbackActorTypes()
    }
  };
  
  return info;
}

/**
 * Check if game system API is available and ready
 * @returns {boolean} True if system is ready for use
 */
export function isSystemReady() {
  const ready = !!(game && game.system && game.system.id);
  if (!ready) {
    console.warn('fa-token-browser | System detection: Game system not ready');
  }
  return ready;
}

 