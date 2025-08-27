/**
 * Actor Factory for Token Browser Drag & Drop
 * Handles system-aware actor creation with fallback strategies
 */

import * as SystemDetection from './system-detection.js';

/**
 * Generate a clean actor name from filename
 * Consolidates logic from token-browser.js and actor-factory.js
 * 
 * @param {string} filename - Original filename (e.g., "dragon_large_scale150.png")
 * @returns {string} Clean actor name (e.g., "Dragon")
 * 
 * @example
 * generateActorName("orc_warrior_medium_scale120.png") // -> "Orc Warrior"
 * generateActorName("ancient-red-dragon_gargantuan.webp") // -> "Ancient Red Dragon"
 * generateActorName("knight_30x25_large.jpg") // -> "Knight"
 */
function generateActorName(filename) {
  if (!filename || typeof filename !== 'string') {
    return 'Unknown Actor';
  }

  // Remove file extension
  let name = filename.replace(/\.[^/.]+$/, '');
  
  // Replace underscores and dashes with spaces FIRST
  // This allows word boundary detection to work properly
  name = name.replace(/[_-]/g, ' ');
  
  // Remove size indicators using word boundaries (handles any position)
  name = name.replace(/\b(tiny|small|medium|large|huge|gargantuan)\b/gi, '');
  
  // Remove scale indicators using word boundaries
  name = name.replace(/\bscale\d+\b/gi, '');
  
  // Remove dimension patterns like "30x25" or "14x30"
  name = name.replace(/\b\d+x\d+\b/g, '');
  
  // Clean up extra spaces and capitalize first letter of each word
  name = name.replace(/\s+/g, ' ').trim();
  name = name.replace(/\b\w/g, l => l.toUpperCase());
  
  // Return cleaned name or fallback
  return name || 'Unknown Actor';
}

/**
 * Actor Factory - Main entry point for creating actors from dropped tokens
 */
export class ActorFactory {
  
  /**
   * Create an actor from drag data with system-appropriate settings
   * @param {Object} dragData - The drag data from the token drop
   * @param {Object} dropCoordinates - Drop coordinates {screen: {x, y}, world: {x, y}}
   * @returns {Promise<Object>} Created actor and token documents
   */
  static async createActorFromDragData(dragData, dropCoordinates) {
    try {
      // Validate system readiness
      if (!SystemDetection.isSystemReady()) {
        throw new Error('Game system not ready for actor creation');
      }
      
      // Get system info
      const systemInfo = SystemDetection.getSystemInfo();
      
      // Generate actor name from filename
      const actorName = generateActorName(dragData.filename);
      
      // Create actor with system-specific logic
      const actor = await this._createActorWithFallback(actorName, dragData);
      
      if (!actor) {
        throw new Error('Failed to create actor with all fallback strategies');
      }
      
      // Create token on canvas
      const token = await this._createTokenOnCanvas(actor, dragData, dropCoordinates);
      
      return { actor, token };
      
    } catch (error) {
      console.error('fa-token-browser | ActorFactory: Error creating actor:', error);
      ui.notifications.error(`Failed to create actor: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Create actor with multi-tier fallback strategy
   * @param {string} actorName - Name for the actor
   * @param {Object} dragData - Drag data containing token information
   * @returns {Promise<Actor>} Created actor or null if all strategies fail
   */
  static async _createActorWithFallback(actorName, dragData) {
    const fallbackTypes = SystemDetection.getFallbackActorTypes();
    
    // Get the target folder for actor creation
    const targetFolder = await this._getOrCreateActorFolder();
    
    // Try each fallback type in sequence
    for (const actorType of fallbackTypes) {
      try {
        // Get actor data for this type
        const actorData = this._buildActorData(actorName, actorType, dragData);
        
        // Add folder assignment if we have a target folder
        if (targetFolder) {
          actorData.folder = targetFolder.id;
        }
        
        // Validate the data
        if (!SystemDetection.validateActorData(actorData)) {
          console.warn(`fa-token-browser | ActorFactory: Actor data validation failed for type "${actorType}"`);
          continue;
        }
        
        // Attempt to create the actor
        const actor = await Actor.create(actorData);
        
        if (actor) {
          return actor;
        }
        
      } catch (error) {
        console.warn(`fa-token-browser | ActorFactory: Failed to create actor with type "${actorType}":`, error.message);
        // Continue to next fallback type
      }
    }
    
    // If all typed attempts failed, try minimal data approach
    console.warn('fa-token-browser | ActorFactory: All typed actor creation attempts failed, trying minimal data approach');
    
    try {
      const minimalData = SystemDetection.getMinimalActorData(actorName, dragData.url);
      
      // Add folder assignment if we have a target folder
      if (targetFolder) {
        minimalData.folder = targetFolder.id;
      }
      
      const actor = await Actor.create(minimalData);
      
      if (actor) {
        return actor;
      }
      
    } catch (error) {
      console.error('fa-token-browser | ActorFactory: Minimal data approach also failed:', error.message);
    }
    
    return null;
  }
  
  /**
   * Get or create the target folder for actor creation based on module settings
   * @returns {Promise<Folder|null>} The target folder or null if using root directory
   */
  static async _getOrCreateActorFolder() {
    try {
      // Get the folder name from settings
      const folderName = game.settings.get('fa-token-browser', 'actorFolder');
      
      // If no folder name is specified, create actors in root directory
      if (!folderName || folderName.trim() === '') {
        return null;
      }
      
      const cleanFolderName = folderName.trim();
      
      // Check if folder already exists
      const existingFolder = game.folders.find(folder => 
        folder.type === 'Actor' && folder.name === cleanFolderName
      );
      
      if (existingFolder) {
        return existingFolder;
      }
      
      // Create new folder if it doesn't exist
      console.log(`fa-token-browser | ActorFactory: Creating actor folder "${cleanFolderName}"`);
      
      const newFolder = await Folder.create({
        name: cleanFolderName,
        type: 'Actor',
        parent: null // Create in root level
      });
      
      return newFolder;
      
    } catch (error) {
      console.warn('fa-token-browser | ActorFactory: Failed to get/create actor folder:', error.message);
      console.warn('fa-token-browser | ActorFactory: Creating actors in root directory as fallback');
      return null; // Fallback to root directory
    }
  }
  
  /**
   * Build actor data for a specific type and system
   * @param {string} actorName - Name for the actor
   * @param {string} actorType - Type of actor to create
   * @param {Object} dragData - Drag data containing token information
   * @returns {Object} Actor data object
   */
  static _buildActorData(actorName, actorType, dragData) {
    // Get base actor data from system detection
    const tokenData = this._buildTokenData(dragData);
    const actorData = SystemDetection.getActorDataForType(actorType, actorName, dragData.url, tokenData);
    
    // Add system-specific enhancements
    const systemId = SystemDetection.getCurrentSystemId();
    
    switch (systemId) {
      case 'dnd5e':
        return this._enhanceForDnd5e(actorData, actorType, dragData);
      case 'pf2e':
        return this._enhanceForPf2e(actorData, actorType, dragData);
      case 'pf1':
        return this._enhanceForPf1(actorData, actorType, dragData);
      case 'dsa5':
        return this._enhanceForDsa5(actorData, actorType, dragData);
      case 'black-flag':
        return this._enhanceForBlackFlag(actorData, actorType, dragData);
      case 'daggerheart':
        return this._enhanceForDaggerheart(actorData, actorType, dragData);
      default:
        return actorData; // Keep minimal data for unknown systems
    }
  }
  
  /**
   * Build token prototype data from drag information
   * @param {Object} dragData - Drag data containing token size and URL
   * @returns {Object} Token prototype data
   */
  static _buildTokenData(dragData) {
    const { gridWidth, gridHeight, scale } = dragData.tokenSize;
    
    // Check if this is a gargantuan token with explicit dimensions that can be optimized
    const optimizedDimensions = this._optimizeGargantuanDimensions(dragData.filename, gridWidth, gridHeight, scale);
    
    return {
      width: optimizedDimensions.gridWidth,
      height: optimizedDimensions.gridHeight,
      texture: {
        src: dragData.url,
        scaleX: optimizedDimensions.scale,  // Apply optimized scale to texture X-axis
        scaleY: optimizedDimensions.scale,   // Apply optimized scale to texture Y-axis
        fit: optimizedDimensions.fit
      },
      actorLink: true // Link to actor data
      // Let Foundry's Prototype Token Overrides handle display settings
      // (displayName, displayBars, disposition, sight, etc.)
    };
  }

  /**
   * Optimize gargantuan token dimensions for easier canvas handling
   * Reduces grid space while maintaining visual proportions using scale and fit modes
   * @param {string} filename - The token filename to parse
   * @param {number} originalGridWidth - Original grid width
   * @param {number} originalGridHeight - Original grid height  
   * @param {number} originalScale - Original scale
   * @returns {Object} Optimized dimensions {gridWidth, gridHeight, scale, fit}
   */
  static _optimizeGargantuanDimensions(filename, originalGridWidth, originalGridHeight, originalScale) {
    const name = filename.toLowerCase();
    
    // Only optimize gargantuan tokens with explicit size patterns like "38x33"
    if (!name.includes('gargantuan')) {
      return {
        gridWidth: originalGridWidth,
        gridHeight: originalGridHeight, 
        scale: originalScale,
        fit: 'contain'
      };
    }
    
    // Look for explicit size pattern like "38x33"
    const sizeMatch = name.match(/(\d+)x(\d+)/);
    if (!sizeMatch) {
      return {
        gridWidth: originalGridWidth,
        gridHeight: originalGridHeight,
        scale: originalScale, 
        fit: 'contain'
      };
    }
    
    const actualWidth = parseInt(sizeMatch[1]);
    const actualHeight = parseInt(sizeMatch[2]);
    
    // Constants for optimization
    const MIN_GARGANTUAN_SIZE = 4; // Minimum gargantuan grid size
    const MAX_SCALE = 3; // Maximum scale multiplier
    
    // Find the smaller actual dimension to base calculations on
    const smallerDimension = Math.min(actualWidth, actualHeight);
    const isWidthSmaller = actualWidth < actualHeight;
    
    // Calculate optimal grid size: smaller_dimension / max_scale
    // This ensures we can represent the smaller dimension exactly at max scale
    let optimalGridSize = Math.ceil(smallerDimension / MAX_SCALE);
    
    // Ensure minimum gargantuan size
    optimalGridSize = Math.max(optimalGridSize, MIN_GARGANTUAN_SIZE);
    
    // Calculate the scale needed to represent the smaller dimension
    const calculatedScale = smallerDimension / optimalGridSize;
    
    // Ensure scale doesn't exceed maximum
    const finalScale = Math.min(calculatedScale, MAX_SCALE);
    
    // Use square dimensions (both width and height use the optimal size)
    const finalGridWidth = optimalGridSize;
    const finalGridHeight = optimalGridSize;
    
    // Set texture fit mode based on which original dimension was smaller
    // According to the memory: "height" for Full Height mode, "width" for Full Width mode
    const textureFit = isWidthSmaller ? 'width' : 'height';
    
    console.log(`fa-token-browser | Gargantuan Optimization: ${filename}`);
    console.log(`fa-token-browser | Original: ${actualWidth}x${actualHeight} → ${originalGridWidth}x${originalGridHeight} grid @ ${originalScale}x scale`);
    console.log(`fa-token-browser | Optimized: ${actualWidth}x${actualHeight} → ${finalGridWidth}x${finalGridHeight} grid @ ${finalScale.toFixed(2)}x scale, fit: ${textureFit}`);
    
    return {
      gridWidth: finalGridWidth,
      gridHeight: finalGridHeight,
      scale: finalScale,
      fit: textureFit
    };
  }
  
  /**
   * Enhance actor data for D&D 5e system
   * @param {Object} actorData - Base actor data
   * @param {string} actorType - Actor type
   * @param {Object} dragData - Drag data
   * @returns {Object} Enhanced actor data
   */
  static _enhanceForDnd5e(actorData, actorType, dragData) {
    // Set the actor's size category to match our parsed token dimensions
    const { gridWidth, gridHeight } = dragData.tokenSize;
    const sizeCategory = this._getCreatureSizeFromGridDimensions(gridWidth, gridHeight);
    
    // Add D&D 5e specific data structure
    if (actorType === 'npc') {
      actorData.system = {
        abilities: {
          str: { value: 10 },
          dex: { value: 10 },
          con: { value: 10 },
          int: { value: 10 },
          wis: { value: 10 },
          cha: { value: 10 }
        },
        attributes: {
          hp: { value: 10, max: 10 },
          ac: { value: 10 }
        },
        details: {
          type: { value: 'humanoid' },
          cr: 0
        },
        traits: {
          size: sizeCategory
        }
      };
    } else {
      // For character actors, just set the size trait
      actorData.system = actorData.system || {};
      actorData.system.traits = actorData.system.traits || {};
      actorData.system.traits.size = sizeCategory;
    }
    
    console.log(`fa-token-browser | D&D 5e: Set creature size to "${sizeCategory}" for ${actorData.name} (${gridWidth}x${gridHeight} grid)`);
    return actorData;
  }
  
  /**
   * Enhance actor data for Pathfinder 2e system
   * @param {Object} actorData - Base actor data
   * @param {string} actorType - Actor type
   * @param {Object} dragData - Drag data
   * @returns {Object} Enhanced actor data
   */
  static _enhanceForPf2e(actorData, actorType, dragData) {
    // Set the actor's size category to match our parsed token dimensions
    // This way PF2e will naturally use the correct grid dimensions
    const { gridWidth, gridHeight, scale } = dragData.tokenSize;
    const sizeCategory = this._getCreatureSizeFromGridDimensions(gridWidth, gridHeight);
    
    // Set actor system data with appropriate size
    actorData.system = actorData.system || {};
    actorData.system.traits = actorData.system.traits || {};
    actorData.system.traits.size = { value: sizeCategory };
    
    // Apply custom scale to prototype token and prevent PF2e from overriding it
    if (actorData.prototypeToken) {
      // Set flags to preserve our custom scale
      actorData.prototypeToken.flags = actorData.prototypeToken.flags || {};
      actorData.prototypeToken.flags['fa-token-browser'] = {
        customScale: true,
        originalScale: scale
      };
      
      // Apply the parsed scale to the texture
      if (actorData.prototypeToken.texture) {
        actorData.prototypeToken.texture.scaleX = scale;
        actorData.prototypeToken.texture.scaleY = scale;
      }
      
      // Disable PF2e's automatic scale adjustments
      actorData.prototypeToken.flags.pf2e = actorData.prototypeToken.flags.pf2e || {};
      actorData.prototypeToken.flags.pf2e.linkToActorSize = false;
    }
    
    console.log(`fa-token-browser | PF2e: Set creature size to "${sizeCategory}" (${gridWidth}x${gridHeight}) with ${scale}x scale for ${actorData.name}`);
    return actorData;
  }
  
  /**
   * Enhance actor data for Pathfinder 1e system
   * @param {Object} actorData - Base actor data
   * @param {string} actorType - Actor type
   * @param {Object} dragData - Drag data
   * @returns {Object} Enhanced actor data
   */
  static _enhanceForPf1(actorData, actorType, dragData) {
    // Set the actor's size category to match our parsed token dimensions
    // This way PF1 will naturally use the correct grid dimensions
    const { gridWidth, gridHeight, scale } = dragData.tokenSize;
    const sizeCategory = this._getCreatureSizeFromGridDimensions(gridWidth, gridHeight);
    
    // Set actor system data with appropriate size
    actorData.system = actorData.system || {};
    actorData.system.traits = actorData.system.traits || {};
    actorData.system.traits.size = sizeCategory; // PF1 uses string directly, not { value: }
    
    // Apply custom scale to prototype token and prevent PF1 from overriding it
    if (actorData.prototypeToken) {
      // Set flags to preserve our custom scale
      actorData.prototypeToken.flags = actorData.prototypeToken.flags || {};
      actorData.prototypeToken.flags['fa-token-browser'] = {
        customScale: true,
        originalScale: scale
      };
      
      // Apply the parsed scale to the texture
      if (actorData.prototypeToken.texture) {
        actorData.prototypeToken.texture.scaleX = scale;
        actorData.prototypeToken.texture.scaleY = scale;
      }
      
      // Disable PF1's automatic scale adjustments
      actorData.prototypeToken.flags.pf1 = actorData.prototypeToken.flags.pf1 || {};
      actorData.prototypeToken.flags.pf1.linkToActorSize = false;
    }
    
    console.log(`fa-token-browser | PF1: Set creature size to "${sizeCategory}" (${gridWidth}x${gridHeight}) with ${scale}x scale for ${actorData.name}`);
    return actorData;
  }

  /**
   * Enhance actor data for DSA5 system
   * @param {Object} actorData - Base actor data
   * @param {string} actorType - Actor type
   * @param {Object} dragData - Drag data
   * @returns {Object} Enhanced actor data
   */
  static _enhanceForDsa5(actorData, actorType, dragData) {
    // Get token size information including scale
    const { gridWidth, gridHeight, scale } = dragData.tokenSize;
    const sizeCategory = this._getCreatureSizeFromGridDimensions(gridWidth, gridHeight);

    // DSA5 has different actor types with different structures
    actorData.system = actorData.system || {};

    // Apply the calculated size category to DSA5 actor data
    actorData.system.status = actorData.system.status || {};
    actorData.system.status.size = { value: sizeCategory };

    switch (actorType) {
      case 'character':
        // Character actors need basic attributes and status
        actorData.system.status.wounds = { value: 10, max: 10 };
        actorData.system.status.astralenergy = { value: 10, max: 10 };
        actorData.system.status.karmaenergy = { value: 0, max: 0 };
        break;

      case 'creature':
        // Creature actors need different structure
        actorData.system.description = actorData.system.description || { value: '' };
        actorData.system.behavior = actorData.system.behavior || { value: '' };
        actorData.system.flight = actorData.system.flight || { value: '' };
        actorData.system.specialRules = actorData.system.specialRules || { value: '' };
        break;

      case 'npc':
        // NPC actors similar to characters but may have different attributes
        actorData.system.status.wounds = { value: 10, max: 10 };
        actorData.system.status.astralenergy = { value: 10, max: 10 };
        actorData.system.status.karmaenergy = { value: 0, max: 0 };
        break;
    }

    // Apply custom scale to prototype token and prevent DSA5 from overriding it
    if (actorData.prototypeToken) {
      // Set flags to preserve our custom scale
      actorData.prototypeToken.flags = actorData.prototypeToken.flags || {};
      actorData.prototypeToken.flags['fa-token-browser'] = {
        customScale: true,
        originalScale: scale
      };

      // Apply the parsed scale to the texture
      if (actorData.prototypeToken.texture) {
        actorData.prototypeToken.texture.scaleX = scale;
        actorData.prototypeToken.texture.scaleY = scale;
      }

      // Disable DSA5's automatic scale adjustments
      actorData.prototypeToken.flags.dsa5 = actorData.prototypeToken.flags.dsa5 || {};
      actorData.prototypeToken.flags.dsa5.linkToActorSize = false;

      // Additional protection: Set the scale directly on the token data
      actorData.prototypeToken.scale = scale;
    }

    console.log(`fa-token-browser | DSA5: Created ${actorType} with size category "${sizeCategory}" (${gridWidth}x${gridHeight}) with ${scale}x scale for ${actorData.name}`);
    return actorData;
  }

  /**
   * Enhance actor data for Black Flag system
   * @param {Object} actorData - Base actor data
   * @param {string} actorType - Actor type
   * @param {Object} dragData - Drag data
   * @returns {Object} Enhanced actor data
   */
  static _enhanceForBlackFlag(actorData, actorType, dragData) {
    // Set the actor's size category to match our parsed token dimensions
    const { gridWidth, gridHeight } = dragData.tokenSize;
    const sizeCategory = this._getCreatureSizeFromGridDimensions(gridWidth, gridHeight);

    // Black Flag has different actor types with different structures
    actorData.system = actorData.system || {};

    switch (actorType) {
      case 'pc':
        // Player Character actors need basic attributes and status
        actorData.system.attributes = actorData.system.attributes || {};
        actorData.system.attributes.hp = { value: 10, max: 10 };
        actorData.system.attributes.ac = { value: 10 };
        break;

      case 'npc':
        // NPC actors need attributes and status
        actorData.system.attributes = actorData.system.attributes || {};
        actorData.system.attributes.hp = { value: 10, max: 10 };
        actorData.system.attributes.ac = { value: 10 };
        break;

      case 'lair':
        // Lair actors have different structure
        actorData.system.description = actorData.system.description || {};
        actorData.system.description.conclusion = actorData.system.description.conclusion || '';
        actorData.system.description.lairActions = actorData.system.description.lairActions || '';
        actorData.system.description.regionalEffects = actorData.system.description.regionalEffects || '';
        actorData.system.description.value = actorData.system.description.value || '';
        break;

      case 'siege':
      case 'vehicle':
        // Siege and vehicle actors
        actorData.system.description = actorData.system.description || { value: '' };
        break;
    }

    console.log(`fa-token-browser | Black Flag: Created ${actorType} with size category "${sizeCategory}" (${gridWidth}x${gridHeight}) for ${actorData.name}`);
    return actorData;
  }

  /**
   * Enhance actor data for Daggerheart system
   * @param {Object} actorData - Base actor data
   * @param {string} actorType - Actor type
   * @param {Object} dragData - Drag data
   * @returns {Object} Enhanced actor data
   */
  static _enhanceForDaggerheart(actorData, actorType, dragData) {
    // Set the actor's size category to match our parsed token dimensions
    const { gridWidth, gridHeight } = dragData.tokenSize;
    const sizeCategory = this._getCreatureSizeFromGridDimensions(gridWidth, gridHeight);

    // Daggerheart has different actor types with different structures
    actorData.system = actorData.system || {};

    switch (actorType) {
      case 'character':
        // Character actors need basic attributes and status
        actorData.system.resources = actorData.system.resources || {};
        actorData.system.resources.hitPoints = { value: 10, max: 10 };
        actorData.system.resources.stress = { value: 0, max: 10 };
        break;

      case 'companion':
        // Companion actors similar to characters
        actorData.system.resources = actorData.system.resources || {};
        actorData.system.resources.hitPoints = { value: 10, max: 10 };
        actorData.system.resources.stress = { value: 0, max: 10 };
        break;

      case 'adversary':
        // Adversary actors need different structure
        actorData.system.notes = actorData.system.notes || '';
        actorData.system.description = actorData.system.description || '';
        break;

      case 'environment':
        // Environment actors
        actorData.system.notes = actorData.system.notes || '';
        actorData.system.description = actorData.system.description || '';
        break;
    }

    console.log(`fa-token-browser | Daggerheart: Created ${actorType} with size category "${sizeCategory}" (${gridWidth}x${gridHeight}) for ${actorData.name}`);
    return actorData;
  }

  /**
   * Map grid dimensions to creature size categories
   * @param {number} gridWidth - Token width in grid units
   * @param {number} gridHeight - Token height in grid units
   * @returns {string} Creature size category
   */
  static _getCreatureSizeFromGridDimensions(gridWidth, gridHeight) {
    // Use the larger dimension to determine size category
    // Maps to DSA5's actual size values: tiny, small, average, big, giant
    const maxDimension = Math.max(gridWidth, gridHeight);

    if (maxDimension >= 4) {
      return 'giant';  // Gargantuan (4x4 or larger) -> Giant
    } else if (maxDimension >= 3) {
      return 'giant';  // Huge (3x3) -> Giant
    } else if (maxDimension >= 2) {
      return 'big';    // Large (2x2) -> Big
    } else {
      return 'average'; // Medium and smaller (1x1) -> Average
    }
  }
  
  /**
   * Apply prototype token overrides to token data
   * @param {Actor} actor - The actor with prototype token data
   * @param {Object} baseTokenData - Base token data to merge with prototype
   * @returns {Object} Merged token data with prototype overrides applied
   */
  static _applyPrototypeTokenOverrides(actor, baseTokenData) {
    // Start with the actor's prototype token data
    const prototypeData = actor.prototypeToken.toObject();
    
    // Merge base token data (positioning, texture) with prototype data
    const mergedData = foundry.utils.mergeObject(prototypeData, baseTokenData, {
      overwrite: true,
      insertKeys: true,
      insertValues: true
    });
    
    return mergedData;
  }

  /**
   * Create token document on canvas
   * @param {Actor} actor - The created actor
   * @param {Object} dragData - Drag data containing token information
   * @param {Object} dropCoordinates - Drop coordinates (already snapped in handleCanvasDrop)
   * @returns {Promise<Token>} Created token document
   */
  static async _createTokenOnCanvas(actor, dragData, dropCoordinates) {
    const { world } = dropCoordinates;
    
    // Use the optimized dimensions from the actor's prototype token data
    // This ensures we use the optimized dimensions for gargantuan tokens
    const prototypeToken = actor.prototypeToken;
    const gridWidth = prototypeToken.width;
    const gridHeight = prototypeToken.height;
    const textureScaleX = prototypeToken.texture.scaleX;
    const textureScaleY = prototypeToken.texture.scaleY;
    const textureFit = prototypeToken.texture.fit;
    
    // Get grid size for calculating token dimensions
    const gridSize = canvas.grid.size;
    
    // Calculate actual token dimensions in pixels using optimized dimensions
    const tokenWidth = gridWidth * gridSize;
    const tokenHeight = gridHeight * gridSize;
    
    // Center the token on the cursor position
    // Since Foundry token coordinates are top-left corner, we need to offset by half dimensions
    const tokenX = world.x - (tokenWidth / 2);
    const tokenY = world.y - (tokenHeight / 2);
    
    // Create base token data with positioning and optimized texture settings
    const baseTokenData = {
      name: actor.name,
      actorId: actor.id,
      x: tokenX,
      y: tokenY,
      width: gridWidth,
      height: gridHeight,
      texture: {
        src: dragData.url,
        scaleX: textureScaleX,  // Apply optimized scale to texture X-axis
        scaleY: textureScaleY,  // Apply optimized scale to texture Y-axis
        fit: textureFit         // Apply optimized fit mode
      }
    };

    // Additional protection for DSA5: Ensure scale is preserved in final token data
    if (game.system.id === 'dsa5' && actor.getFlag('fa-token-browser', 'customScale')) {
      const originalScale = actor.getFlag('fa-token-browser', 'originalScale');
      if (originalScale) {
        baseTokenData.texture.scaleX = originalScale;
        baseTokenData.texture.scaleY = originalScale;
        // Also set the overall token scale as backup
        baseTokenData.scale = originalScale;
      }
    }
    
    // Apply prototype token overrides from the actor and global settings
    const tokenData = this._applyPrototypeTokenOverrides(actor, baseTokenData);
    
    // Create the token on the canvas
    const tokens = await canvas.scene.createEmbeddedDocuments('Token', [tokenData]);
    
    return tokens[0];
  }

  /**
   * Initialize DSA5 scale restoration hook
   * This ensures DSA5 doesn't override our custom token scales
   */
  static _initializeDSA5ScaleFix() {
    if (window.faTokenBrowser?.dsa5ScaleFixRegistered) return;

    Hooks.on('createToken', (token, options, userId) => {
      // Only process for DSA5 system
      if (game.system.id !== 'dsa5') return;

      const actor = token.actor;
      if (!actor) return;

      // Wait for DSA5 to finish applying its scaling, then restore from prototype token
      setTimeout(() => {
        ActorFactory._restorePrototypeTokenScale(token, actor);
      }, 50); // Give DSA5 time to apply its scaling first
    });

    if (window.faTokenBrowser) {
      window.faTokenBrowser.dsa5ScaleFixRegistered = true;
    }
  }

  /**
   * Restore prototype token scale after DSA5 scaling
   * @param {Token} token - The token that was created
   * @param {Actor} actor - The actor associated with the token
   */
  static _restorePrototypeTokenScale(token, actor) {
    if (!token || !actor) return;

    // Get the scale from the actor's prototype token (this is our original custom scale)
    const prototypeToken = actor.prototypeToken;
    if (!prototypeToken?.texture?.scaleX) return;

    const prototypeScaleX = prototypeToken.texture.scaleX;
    const prototypeScaleY = prototypeToken.texture.scaleY;

    // Get current token scale
    const currentScaleX = token.texture.scaleX;
    const currentScaleY = token.texture.scaleY;

    // Check if DSA5 has changed the scale from our prototype values
    const scaleChanged = Math.abs(currentScaleX - prototypeScaleX) > 0.01 ||
                        Math.abs(currentScaleY - prototypeScaleY) > 0.01;

    if (scaleChanged) {
      console.log(`fa-token-browser | DSA5 Scale Fix: Restoring prototype scale ${prototypeScaleX.toFixed(3)}x${prototypeScaleY.toFixed(3)} (was ${currentScaleX.toFixed(3)}x${currentScaleY.toFixed(3)}) for ${actor.name}`);

      // Restore the scale from the prototype token instantly (no animation)
      token.update({
        'texture.scaleX': prototypeScaleX,
        'texture.scaleY': prototypeScaleY
      }, { animate: false });
    }
  }

}

 