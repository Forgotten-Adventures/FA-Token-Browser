/**
 * TokenDataService - Main abstraction layer for token operations
 * Provides unified APIs that work for both local and cloud tokens
 */

import { LocalTokenService } from './local-token-service.js';
import { TokenCacheManager } from './token-cache-manager.js';
import { CloudTokenService } from './cloud-token-service.js';
import { isLocalToken, isCloudToken, isValidTokenData } from './token-data-types.js';

/**
 * Parse token filename and extract display information
 * @param {string} filename - The token filename (e.g., "Balor_A1_Huge_Scale233_Fiend_04.png")
 * @returns {Object} Object with displayName, variant, size, scale, and creatureType
 */
export function parseTokenDisplayName(filename) {
  // Remove file extension
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
  
  // Split by underscores
  const parts = nameWithoutExt.split('_');
  
  if (parts.length < 2) {
    // Fallback if parsing fails
    return {
      displayName: filename.replace(/\.[^/.]+$/, '').replace(/_/g, ' '),
      variant: '',
      size: '',
      scale: '',
      creatureType: ''
    };
  }
  
  // Find the variant part - it's the first part that matches our variant patterns
  let variantIndex = -1;
  let variant = '';
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    
    // Check for variant patterns:
    // - Letter+Number: A1, B2, etc.
    // - Letter+Letter+Number: AA1, BB2, etc.
    // - Letter+Number+Number: X12, Y34, etc.
    // - Number+Number+Number+Letter: 002A, 001B, etc. (for commoners/nobles)
    if (/^[A-Z]\d+$/.test(part) ||           // A1, B2
        /^[A-Z]{2}\d+$/.test(part) ||        // AA1, BB2
        /^[A-Z]\d{2,}$/.test(part) ||        // X12, Y34
        /^\d{3}[A-Z]$/.test(part)) {         // 002A, 001B
      variantIndex = i;
      variant = part;
      break;
    }
  }
  
  if (variantIndex === -1) {
    // No variant found, treat entire filename as name
    return {
      displayName: parts.join(' ').replace(/([a-z])([A-Z])/g, '$1 $2'),
      variant: '',
      size: '',
      scale: '',
      creatureType: ''
    };
  }
  
  // Extract name parts (everything before the variant)
  const nameParts = parts.slice(0, variantIndex);
  
  // Extract information from parts after the variant
  const infoPartsCandidates = parts.slice(variantIndex + 1);
  
  // Parse size, scale, and creature type from the remaining parts
  let size = '';
  let scale = '';
  let creatureType = '';
  
  const sizeOptions = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
  const creatureTypes = [
    'Aberration', 'Beast', 'Celestial', 'Construct', 'Dragon', 'Elemental', 
    'Fey', 'Fiend', 'Giant', 'Humanoid', 'Monstrosity', 'Ooze', 'Plant', 
    'Undead', 'Human', 'Elf', 'Dwarf', 'Halfling', 'Dragonborn', 'Tiefling',
    'Orc', 'Goblin', 'Kobold', 'Gnoll', 'Hobgoblin'
  ];
  
  for (const part of infoPartsCandidates) {
    // Check for size
    if (sizeOptions.some(s => s.toLowerCase() === part.toLowerCase())) {
      size = part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }
    // Check for scale (e.g., Scale233 -> 2.33x)
    else if (/^Scale(\d+)$/i.test(part)) {
      const scaleMatch = part.match(/^Scale(\d+)$/i);
      if (scaleMatch) {
        const scaleNum = parseInt(scaleMatch[1]);
        scale = `${(scaleNum / 100).toFixed(2).replace(/\.?0+$/, '')}x`;
      }
    }
    // Check for creature type
    else if (creatureTypes.some(c => c.toLowerCase() === part.toLowerCase())) {
      creatureType = part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }
  }
  
  // Default values for missing information
  if (!creatureType) {
    // Detect if this is likely a Creature folder vs Adversaries/Adventurers/NPCs
    // For now, we'll default to Humanoid for Adversaries/Adventurers/NPCs
    // This can be refined based on folder path in the future
    creatureType = 'Humanoid';
  }
  
  if (!size) {
    // Default to Medium size if not specified in filename
    size = 'Medium';
  }
  
  // Clean up the name parts
  const cleanedName = nameParts
    .join(' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space between camelCase
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  
  // Display name without variant (we'll show variant separately)
  const displayName = cleanedName;
  
  return {
    displayName,
    variant,
    size,
    scale,
    creatureType
  };
}

export class TokenDataService {
  constructor(parentApp = null) {
    this.localService = new LocalTokenService();
    this.cacheManager = new TokenCacheManager();
    this.cloudService = new CloudTokenService();
    
    // Set parent app reference for cloud service auth handling and cache manager UI updates
    if (parentApp) {
      this.cloudService.setParentApp(parentApp);
      this.cacheManager.setParentApp(parentApp);
    }
  }

  /**
   * Check if local-only mode is enabled
   * @returns {boolean} True if local-only mode is active
   */
  isLocalOnlyMode() {
    return game.settings.get('fa-token-browser', 'localOnlyMode') || false;
  }



  /**
   * Get full URL for any token type (used for both previews AND drag & drop)
   * @param {TokenData} tokenData - Token data
   * @returns {Promise<string>} Full URL
   */
  async getFullURL(tokenData) {
    this._validateTokenData(tokenData);

    if (isLocalToken(tokenData)) {
      return this.localService.getFullURL(tokenData);
    } else if (isCloudToken(tokenData)) {
      return await this.cloudService.getFullURL(tokenData);
    } else {
      throw new Error(`Unknown token source: ${tokenData.source}`);
    }
  }

  /**
   * Get file path for drag & drop operations (CRITICAL for Foundry compatibility)
   * For local tokens: returns the file path directly
   * For cloud tokens: downloads and caches the file, then returns local path
   * @param {TokenData} tokenData - Token data
   * @returns {Promise<string>} Local file path
   */
  async getFilePathForDragDrop(tokenData) {
    this._validateTokenData(tokenData);

    if (isLocalToken(tokenData)) {
      // Local tokens already have file paths
      return this.localService.getFullURL(tokenData);
    } else if (isCloudToken(tokenData)) {
      // Check if already cached
      const cachedPath = this.cacheManager.getCachedFilePath(tokenData);
      if (cachedPath) {
        return cachedPath;
      }
      
      // Need to download and cache the file
      
      try {
        // Get the download URL from cloud service
        const downloadURL = await this.cloudService.getFullURL(tokenData);
        
        // Download and cache the file
        const cachedPath = await this.cacheManager.downloadAndCache(tokenData, downloadURL);
        
        return cachedPath;
        
      } catch (error) {
        console.error('fa-token-browser | Failed to download cloud token:', error);
        throw new Error(`Failed to download cloud token: ${error.message}`);
      }
      
    } else {
      throw new Error(`Unknown token source: ${tokenData.source}`);
    }
  }

  /**
   * Get metadata for any token type
   * @param {TokenData} tokenData - Token data
   * @returns {Promise<Object>} Token metadata
   */
  async getTokenMetadata(tokenData) {
    this._validateTokenData(tokenData);

    if (isLocalToken(tokenData)) {
      return await this.localService.extractMetadata(tokenData);
    } else if (isCloudToken(tokenData)) {
      return await this.cloudService.extractMetadata(tokenData);
    } else {
      throw new Error(`Unknown token source: ${tokenData.source}`);
    }
  }

  /**
   * Format file size in human readable format
   * @param {number} bytes - File size in bytes
   * @returns {string} Formatted file size
   */
  formatFileSize(bytes) {
    // Use local service formatting (same for all token types)
    return this.localService.formatFileSize(bytes);
  }

  /**
   * Check if token file/URL exists and is accessible
   * @param {TokenData} tokenData - Token data
   * @returns {Promise<boolean>} True if token exists
   */
  async tokenExists(tokenData) {
    this._validateTokenData(tokenData);

    if (isLocalToken(tokenData)) {
      return await this.localService.fileExists(tokenData);
    } else if (isCloudToken(tokenData)) {
      return await this.cloudService.tokenExists(tokenData);
    } else {
      return false;
    }
  }

  /**
   * Extract TokenData from DOM element attributes (for existing UI compatibility)
   * @param {HTMLElement} tokenElement - Token DOM element
   * @returns {TokenData|null} TokenData object or null if invalid
   */
  getTokenDataFromElement(tokenElement) {
    if (!tokenElement) {
      return null;
    }

    const filename = tokenElement.getAttribute('data-filename');
    const path = tokenElement.getAttribute('data-path');
    const source = tokenElement.getAttribute('data-source') || 'local';
    const tier = tokenElement.getAttribute('data-tier') || null;

    if (!filename || !path) {
      return null;
    }

    // Handle both local and cloud tokens
    if (source === 'local') {
      return this.localService.convertLocalToken({
        filename,
        path,
        url: path,
        type: path.split('.').pop()?.toLowerCase() || 'png'
      });
    } else {
      // Cloud token - basic structure (full cloud token support available via other methods)
      return null;
    }
  }

  /**
   * Update DOM element with TokenData (for UI compatibility)
   * @param {HTMLElement} tokenElement - Token DOM element
   * @param {TokenData} tokenData - Token data
   */
  updateElementWithTokenData(tokenElement, tokenData) {
    if (!tokenElement || !tokenData) {
      return;
    }

    tokenElement.setAttribute('data-filename', tokenData.filename);
    tokenElement.setAttribute('data-path', tokenData.path);
    tokenElement.setAttribute('data-source', tokenData.source);
    
    if (tokenData.tier) {
      tokenElement.setAttribute('data-tier', tokenData.tier);
    }

    // Update the img src if needed
    const img = tokenElement.querySelector('img');
    if (img && tokenData.urls.thumbnail) {
      img.src = tokenData.urls.thumbnail;
      img.alt = tokenData.filename;
    }
  }

  /**
   * Validate TokenData object
   * @param {TokenData} tokenData - Token data to validate
   * @throws {Error} If token data is invalid
   * @private
   */
  _validateTokenData(tokenData) {
    if (!isValidTokenData(tokenData)) {
      throw new Error('Invalid TokenData object');
    }
  }


  /**
   * Clear token cache
   * @returns {Promise<void>}
   */
  async clearCache() {
    return await this.cacheManager.clearCache();
  }

  /**
   * Check if token is cached locally
   * @param {TokenData} tokenData - Token data
   * @returns {boolean} True if token is cached
   */
  isTokenCached(tokenData) {
    if (isLocalToken(tokenData)) {
      return true; // Local tokens are always "cached"
    }
    
    return this.cacheManager.getCachedFilePath(tokenData) !== null;
  }



  /**
   * Check if user is authenticated for cloud tokens
   * @returns {boolean} True if authenticated
   */
  isCloudAuthenticated() {
    return this.cloudService.isAuthenticated();
  }



  /**
   * Clear cloud URL cache (useful when authentication changes)
   */
  clearCloudURLCache() {
    this.cloudService.clearURLCache();
  }

  /**
   * Get cloud URL cache statistics
   * @returns {Object} URL cache statistics
   */
  getCloudURLCacheStats() {
    return this.cloudService.getURLCacheStats();
  }

  /**
   * Clean up expired cloud URLs
   * @returns {number} Number of URLs cleaned up
   */
  cleanupExpiredCloudURLs() {
    return this.cloudService.cleanupExpiredURLs();
  }

  /**
   * Fetch local tokens from a folder
   * @param {string} folder - Local folder to scan
   * @returns {Promise<Array<TokenData>>} Array of local TokenData objects
   */
  async fetchLocalTokens(folder) {
    if (!folder) {
      return [];
    }

    try {
      // Use the scanTokenFolder method from local service
      const rawLocalTokens = await this.localService.scanTokenFolder(folder);
      
      // Convert to TokenData format
      const tokenDataArray = this.localService.convertLocalTokens(rawLocalTokens);
      
      return tokenDataArray;
    } catch (error) {
      console.error('fa-token-browser | Error fetching local tokens:', error);
      return [];
    }
  }

  /**
   * Get combined local and cloud tokens
   * @param {string} localFolder - Local folder to scan
   * @param {boolean} includeCloud - Whether to include cloud tokens
   * @returns {Promise<Array<TokenData>>} Combined array of TokenData objects
   */
  async getCombinedTokens(localFolder, includeCloud = true) {
    // Check if local-only mode is enabled
    const localOnlyMode = this.isLocalOnlyMode();
    
    if (localOnlyMode) {
      console.log('fa-token-browser | Local-only mode enabled, skipping cloud tokens');
      includeCloud = false;
    }
    
    // Initialize cache system proactively when loading tokens (only if cloud tokens are included)
    if (includeCloud && !localOnlyMode) {
      await this.cacheManager.initialize();
    }
    
    const results = await Promise.allSettled([
      localFolder ? this.fetchLocalTokens(localFolder) : Promise.resolve([]),
      (includeCloud && !localOnlyMode) ? this.cloudService.fetchAvailableTokens() : Promise.resolve([])
    ]);
    
    const localTokens = results[0].status === 'fulfilled' ? results[0].value : [];
    const cloudTokens = results[1].status === 'fulfilled' ? results[1].value : [];
    
    if (results[0].status === 'rejected') {
      console.warn('fa-token-browser | Local token fetch failed:', results[0].reason);
    }
    
    if (results[1].status === 'rejected' && !localOnlyMode) {
      console.warn('fa-token-browser | Cloud token fetch failed:', results[1].reason);
    }
    
    const combined = [...localTokens, ...cloudTokens];
    
    if (localOnlyMode) {
      console.log(`fa-token-browser | Local-only mode: loaded ${localTokens.length} local tokens`);
    } else {
      console.log(`fa-token-browser | Combined mode: loaded ${localTokens.length} local + ${cloudTokens.length} cloud tokens`);
    }
    
    return combined;
  }

  /**
   * Convert TokenData array to UI-compatible format (for gradual migration)
   * @param {Array<TokenData>} tokenDataArray - Array of TokenData objects
   * @returns {Array} UI-compatible token objects
   */
  convertTokenDataForUI(tokenDataArray) {
    return tokenDataArray.map(tokenData => {
      const { displayName, variant, size, scale, creatureType } = parseTokenDisplayName(tokenData.filename);
      
      return {
        path: tokenData.path,
        filename: tokenData.filename,
        displayName: displayName,
        variant: variant,
        size: size,
        scale: scale,
        creatureType: creatureType,
        url: tokenData.urls.thumbnail, // Thumbnail URL for grid display
        fullUrl: tokenData.urls.full, // Full URL
        type: tokenData.filename.split('.').pop()?.toLowerCase() || 'png',
        source: tokenData.source,
        tier: tokenData.tier || null,
        fileSize: tokenData.metadata.fileSize || 0,
        folder: tokenData.folder || '',
        // Cache status for cloud tokens
        isCached: this.isTokenCached(tokenData),
        // Store the original TokenData for advanced operations
        _tokenData: tokenData
      };
    });
  }

  /**
   * Extract TokenData from UI object (reverse of convertTokenDataForUI)
   * @param {Object} uiObject - UI-compatible token object
   * @returns {TokenData|null} Original TokenData object or null if not found
   */
  getTokenDataFromUIObject(uiObject) {
    return uiObject?._tokenData || null;
  }

  /**
   * Destroy the token data service and clean up all sub-services
   */
  destroy() {
    // Clean up cache manager
    if (this.cacheManager) {
      this.cacheManager.destroy();
    }
    
    // Clean up cloud service
    if (this.cloudService) {
      this.cloudService.destroy();
    }
    
    // Local service doesn't need cleanup (no persistent state)
    this.localService = null;
    this.cacheManager = null;
    this.cloudService = null;
  }
}
