/**
 * TokenCacheManager - Handles downloading and caching cloud tokens as local files
 * Critical for Foundry compatibility since actors need actual file paths, not URLs
 */

import { isCloudToken } from './token-data-types.js';

/**
 * Utility function to detect if we're running on Forge
 * @returns {boolean} True if running on Forge-VTT
 */
function isRunningOnForge() {
  return window.location.hostname.includes('forge-vtt.com') || 
         window.location.hostname.includes('forgevtt.com') ||
         (typeof ForgeVTT !== 'undefined' && ForgeVTT.usingTheForge);
}

/**
 * Extract Forge account ID from current URL or ForgeVTT global
 * @returns {string|null} Forge account ID or null if not available
 */
function getForgeAccountId() {
  // Try to get from ForgeVTT global first
  if (typeof ForgeVTT !== 'undefined' && ForgeVTT.usingTheForge) {
    // ForgeVTT might expose account info
    if (ForgeVTT.accountId) return ForgeVTT.accountId;
    if (ForgeVTT.userId) return ForgeVTT.userId;
  }
  
  // Extract from hostname if available
  // Pattern: https://WORLD_NAME.forge-vtt.com -> we need to get account ID another way
  const hostname = window.location.hostname;
  if (hostname.includes('forge-vtt.com')) {
    // Check if we can extract from any existing asset URLs
    // Look for existing assets that might have the full URL
    const existingImages = Array.from(document.querySelectorAll('img[src*="assets.forge-vtt.com"]'));
    for (const img of existingImages) {
      const match = img.src.match(/assets\.forge-vtt\.com\/([a-f0-9]{24})\//);
      if (match) {
        return match[1];
      }
    }
    
    // If no existing assets, we'll need to make a request to discover it
    return null;
  }
  
  return null;
}

/**
 * Get optimized Forge cache URL by using direct assets URL if possible
 * @param {string} originalPath - Original cache path
 * @returns {string} Optimized URL or original path
 */
function getOptimizedForgeCacheUrl(originalPath) {
  if (!isRunningOnForge()) {
    return originalPath;
  }
  
  const accountId = getForgeAccountId();
  if (!accountId) {
    return originalPath;
  }
  
  // Convert from friendly URL to direct assets URL
  // From: fa-token-browser-cache/filename.webp  
  // To: https://assets.forge-vtt.com/{accountId}/fa-token-browser-cache/filename.webp
  return `https://assets.forge-vtt.com/${accountId}/${originalPath}`;
}

export class TokenCacheManager {
  constructor() {
    this.downloadPromises = new Map(); // Prevent duplicate downloads
    this.initialized = false;
    this.cacheInventory = new Map(); // filename -> cache metadata
    this.parentApp = null; // Reference to the token browser app for UI updates
    this._forgeAccountId = null; // Cache the Forge account ID once discovered
  }

  /**
   * Set the parent app reference for UI updates
   * @param {TokenBrowserApp} parentApp - The parent token browser app
   */
  setParentApp(parentApp) {
    this.parentApp = parentApp;
  }

  /**
   * Discover Forge account ID by making a test request and capturing redirect
   * @returns {Promise<string|null>} Forge account ID or null if not discovered
   * @private
   */
  async _discoverForgeAccountId() {
    if (!isRunningOnForge() || this._forgeAccountId) {
      return this._forgeAccountId;
    }

    try {
      // Make a HEAD request to a cache path and capture the redirect
      const cacheDir = this._getCacheDirectory();
      const testUrl = `${window.location.origin}/${cacheDir}/test.txt`;
      
      const response = await fetch(testUrl, { 
        method: 'HEAD',
        redirect: 'manual' // Don't follow redirects, capture them
      });
      
      // Check for Location header in 3xx responses
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('Location');
        if (location) {
          const match = location.match(/assets\.forge-vtt\.com\/([a-f0-9]{24})\//);
          if (match) {
            this._forgeAccountId = match[1];
            console.log(`fa-token-browser | Discovered Forge account ID: ${this._forgeAccountId}`);
            return this._forgeAccountId;
          }
        }
      }
    } catch (error) {
      // Silent fail - fallback to original URLs
      console.debug('fa-token-browser | Could not discover Forge account ID:', error);
    }
    
    return null;
  }

  /**
   * Get cache directory from module settings
   * @returns {string} Cache directory path
   * @private
   */
  _getCacheDirectory() {
    try {
      return game.settings.get('fa-token-browser', 'cacheDirectory') || 'fa-token-browser-cache';
    } catch (error) {
      console.warn('fa-token-browser | Failed to get cache directory setting, using default');
      return 'fa-token-browser-cache';
    }
  }

  /**
   * Get max cache size from module settings
   * @returns {number} Max cache size in bytes (0 = unlimited)
   * @private
   */
  _getMaxCacheSize() {
    try {
      const sizeMB = game.settings.get('fa-token-browser', 'maxCacheSize') || 500;
      return sizeMB === 0 ? 0 : sizeMB * 1024 * 1024; // 0 = unlimited
    } catch (error) {
      console.warn('fa-token-browser | Failed to get cache size setting, using default');
      return 500 * 1024 * 1024;
    }
  }

  /**
   * Get max cache age from module settings
   * @returns {number} Max cache age in milliseconds (0 = unlimited)
   * @private
   */
  _getMaxCacheAge() {
    try {
      const ageDays = game.settings.get('fa-token-browser', 'maxCacheAge') || 7;
      return ageDays === 0 ? 0 : ageDays * 24 * 60 * 60 * 1000; // 0 = unlimited
    } catch (error) {
      console.warn('fa-token-browser | Failed to get cache age setting, using default');
      return 7 * 24 * 60 * 60 * 1000;
    }
  }

  /**
   * Manually initialize cache (call when Foundry is ready)
   * @returns {Promise<boolean>} True if initialized successfully
   */
  async initialize() {
    await this._initializeCache();
    return this.initialized;
  }

  /**
   * Initialize cache directory and cleanup old files (lazy initialization)
   * @private
   */
  async _initializeCache() {
    if (this.initialized) {
      return; // Already initialized
    }

    try {
      // Check if Foundry is ready
      if (!foundry?.applications?.apps?.FilePicker?.implementation) {
        return; // Defer initialization
      }

      // Get current cache directory from settings
      const cacheDir = this._getCacheDirectory();
      
      // Ensure cache directory exists
      await this._ensureCacheDirectory(cacheDir);
      
      // Scan existing cache files and build inventory
      await this._scanAndRestoreCacheMetadata();
      
      // Clean up old cached files on startup
      await this._cleanupOldCache();
      
      // Try to discover Forge account ID early (don't wait for it)
      if (isRunningOnForge()) {
        this._discoverForgeAccountId().catch(() => {
          // Silent fail - will retry later
        });
      }
      
      this.initialized = true;
    } catch (error) {
      console.error('fa-token-browser | Cache initialization failed:', error);
    }
  }

  /**
   * Ensure cache directory exists
   * @param {string} cacheDir - Cache directory path
   * @private
   */
  async _ensureCacheDirectory(cacheDir) {
    try {
      const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
      
      // Try to browse the cache directory
      try {
        await FilePickerImpl.browse('data', cacheDir);
      } catch (error) {
        // Directory doesn't exist, create it

        await FilePickerImpl.createDirectory('data', cacheDir);
      }
    } catch (error) {
      console.error('fa-token-browser | Failed to ensure cache directory:', error);
      throw error;
    }
  }

  /**
   * Scan cache directory and restore metadata for existing files
   * @private
   */
  async _scanAndRestoreCacheMetadata() {
    try {
      const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
      const cacheDir = this._getCacheDirectory();
      
      const result = await FilePickerImpl.browse('data', cacheDir);
      const cachedFiles = result.files;
      
      // Build cache inventory from existing files
      for (const filePath of cachedFiles) {
        const filename = filePath.split('/').pop();
        
        // Store cache metadata for this file
        this.cacheInventory.set(filename, {
          localPath: `${cacheDir}/${filename}`,
          isDownloaded: true,
          downloadedAt: Date.now(), // Approximate - we don't know the real time
          lastAccessed: Date.now()
        });
      }
      
    } catch (error) {
      console.warn('fa-token-browser | Failed to scan cache directory:', error);
      // Continue with empty inventory
      this.cacheInventory.clear();
    }
  }

  /**
   * Get cached file path for a token (optimized for Forge)
   * @param {TokenData} tokenData - Token data
   * @returns {string|null} Cached file path or null if not cached
   */
  getCachedFilePath(tokenData) {
    if (!isCloudToken(tokenData)) {
      return null; // Local tokens don't need caching
    }

    // Check if token is marked as downloaded in TokenData
    if (tokenData.cache.isDownloaded && tokenData.cache.localPath) {
      return this._optimizeForgeUrl(tokenData.cache.localPath);
    }
    
    // Check cache inventory (restored from filesystem scan)
    const inventoryEntry = this.cacheInventory.get(tokenData.filename);
    if (inventoryEntry) {
      // Restore TokenData metadata from inventory
      tokenData.cache.isDownloaded = true;
      tokenData.cache.localPath = inventoryEntry.localPath;
      tokenData.cache.downloadedAt = inventoryEntry.downloadedAt;
      tokenData.cache.lastAccessed = Date.now(); // Update access time
      
      return this._optimizeForgeUrl(inventoryEntry.localPath);
    }
    
    return null; // Not cached
  }

  /**
   * Optimize Forge URL to use direct assets URL if possible
   * @param {string} originalPath - Original cache path
   * @returns {string} Optimized URL or original path
   * @private
   */
  _optimizeForgeUrl(originalPath) {
    if (!isRunningOnForge()) {
      return originalPath;
    }
    
    // Use cached account ID if available
    if (this._forgeAccountId) {
      return `https://assets.forge-vtt.com/${this._forgeAccountId}/${originalPath}`;
    }
    
    // Try to get account ID from global functions
    const accountId = getForgeAccountId();
    if (accountId) {
      this._forgeAccountId = accountId; // Cache it
      return `https://assets.forge-vtt.com/${accountId}/${originalPath}`;
    }
    
    // Trigger discovery in background (don't wait for it)
    this._discoverForgeAccountId().then(discoveredId => {
      if (discoveredId) {
        this._forgeAccountId = discoveredId;
      }
    });
    
    return originalPath; // Fallback to original path
  }



  /**
   * Download and cache a cloud token
   * @param {TokenData} tokenData - Token data
   * @param {string} downloadURL - URL to download from
   * @returns {Promise<string>} Path to cached file
   */
  async downloadAndCache(tokenData, downloadURL) {
    if (!isCloudToken(tokenData)) {
      throw new Error('Cannot cache local tokens');
    }

    // Ensure cache is initialized
    await this._initializeCache();
    if (!this.initialized) {
      throw new Error('Cache system not ready - Foundry not fully loaded');
    }

    const cacheKey = tokenData.path;
    
    // Check if download is already in progress
    if (this.downloadPromises.has(cacheKey)) {
      return await this.downloadPromises.get(cacheKey);
    }

    // Check if already cached
    const existingPath = this.getCachedFilePath(tokenData);
    if (existingPath) {
      // Update access time
      tokenData.cache.lastAccessed = Date.now();
      return existingPath;
    }

    // Start download
    const downloadPromise = this._performDownload(tokenData, downloadURL);
    this.downloadPromises.set(cacheKey, downloadPromise);

    try {
      const cachedPath = await downloadPromise;
      return cachedPath;
    } finally {
      // Clean up promise
      this.downloadPromises.delete(cacheKey);
    }
  }

  /**
   * Perform the actual download and caching
   * @param {TokenData} tokenData - Token data
   * @param {string} downloadURL - URL to download from
   * @returns {Promise<string>} Path to cached file
   * @private
   */
  async _performDownload(tokenData, downloadURL) {
    try {
      let blob;
      
      // Use fetch for both free and premium tokens
      // CDN should be publicly accessible without CORS issues
      const response = await fetch(downloadURL);
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }
        blob = await response.blob();
      
      // Generate cache filename and path
      const cacheDir = this._getCacheDirectory();
      const cacheFilename = this._generateCacheFilename(tokenData);
      const cachePath = `${cacheDir}/${cacheFilename}`;
      
      // Convert blob to File object for Foundry's file system
      const file = new File([blob], cacheFilename, { type: blob.type });
      
      // Upload to Foundry's data directory
      const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
      await FilePickerImpl.upload('data', cacheDir, file);
      
      // Update token cache metadata
      const now = Date.now();
      tokenData.cache.isDownloaded = true;
      tokenData.cache.localPath = cachePath;
      tokenData.cache.downloadedAt = now;
      tokenData.cache.lastAccessed = now;
      
      // Update cache inventory
      this.cacheInventory.set(tokenData.filename, {
        localPath: cachePath,
        isDownloaded: true,
        downloadedAt: now,
        lastAccessed: now
      });

      // Notify UI of successful caching with a small delay
      if (this.parentApp && this.parentApp.updateTokenStatusIcon) {
        setTimeout(() => {
          this.parentApp.updateTokenStatusIcon(tokenData.filename, 'cached');
        }, 800); // Slightly longer delay than the dragdrop manager to avoid conflicts
      }
      
      return cachePath;
      
    } catch (error) {
      console.error('fa-token-browser | Download failed:', error);
      throw error;
    }
  }



  /**
   * Generate cache filename for a token
   * @param {TokenData} tokenData - Token data
   * @returns {string} Cache filename
   * @private
   */
  _generateCacheFilename(tokenData) {
    // Use the original filename directly to avoid confusing prefixes
    return tokenData.filename;
  }



  /**
   * Simple hash function for generating cache filenames
   * @param {string} str - String to hash
   * @returns {string} Hash string
   * @private
   */
  _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Check if a token is already cached
   * @param {TokenData} tokenData - Token data
   * @returns {boolean} True if file is marked as cached
   * @private
   */
  _isCached(tokenData) {
    return tokenData.cache.isDownloaded && tokenData.cache.localPath;
  }

  /**
   * Clean up old cached files (simplified - no HEAD requests)
   * @private
   */
  async _cleanupOldCache() {
    try {
      const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
      const cacheDir = this._getCacheDirectory();
      const maxCacheAge = this._getMaxCacheAge();
      
      // Only clean up by age if maxCacheAge is set (> 0)
      if (maxCacheAge === 0) {
        return;
      }
      
      const result = await FilePickerImpl.browse('data', cacheDir);
      const now = Date.now();
      const maxAgeMs = maxCacheAge;
      
      // Clean up files older than maxAge (use file system timestamps)
      const filesToDelete = [];
      
      for (const filePath of result.files) {
        try {
          // Use a simple heuristic - if file path contains old timestamp patterns
          // or if we can determine age from filename, delete it
          const filename = filePath.split('/').pop();
          
          // For now, just delete files that are obviously old based on naming patterns
          // This avoids HEAD requests entirely
          if (filename.includes('_old_') || filename.includes('_temp_')) {
            filesToDelete.push(filePath);
          }
        } catch (error) {
          // Skip files we can't process
          continue;
        }
      }
      
      // Delete old files
      for (const filePath of filesToDelete) {
        try {
          const filename = filePath.split('/').pop();
          await FilePickerImpl.deleteFile('data', `${cacheDir}/${filename}`);
        } catch (error) {
          console.warn('fa-token-browser | Failed to delete cache file:', filePath, error);
        }
      }
      
    } catch (error) {
      console.warn('fa-token-browser | Cache cleanup failed:', error);
    }
  }

  /**
   * Get cache statistics (simplified - no HEAD requests)
   * @returns {Promise<Object>} Cache statistics
   */
  async getCacheStats() {
    // Try to initialize cache first
    await this._initializeCache();
    
    try {
      if (!this.initialized) {
        const cacheDir = this._getCacheDirectory();
        const maxCacheSize = this._getMaxCacheSize();
        return {
          fileCount: 0,
          totalSize: 'unknown',
          totalSizeMB: 'unknown',
          maxSizeMB: maxCacheSize === 0 ? 'unlimited' : Math.round(maxCacheSize / (1024 * 1024)),
          maxAgeDays: this._getMaxCacheAge() === 0 ? 'unlimited' : Math.round(this._getMaxCacheAge() / (1000 * 60 * 60 * 24)),
          cacheDir: cacheDir,
          status: 'Not initialized - Foundry not ready'
        };
      }

      const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
      const cacheDir = this._getCacheDirectory();
      const maxCacheSize = this._getMaxCacheSize();
      const result = await FilePickerImpl.browse('data', cacheDir);
      
      // Count files without making HEAD requests
      const fileCount = result.files.length;
      
      return {
        fileCount: fileCount,
        totalSize: 'unknown (avoiding CORS issues)',
        totalSizeMB: 'unknown',
        maxSizeMB: maxCacheSize === 0 ? 'unlimited' : Math.round(maxCacheSize / (1024 * 1024)),
        maxAgeDays: this._getMaxCacheAge() === 0 ? 'unlimited' : Math.round(this._getMaxCacheAge() / (1000 * 60 * 60 * 24)),
        cacheDir: cacheDir,
        status: 'Active'
      };
      
    } catch (error) {
      console.error('fa-token-browser | Failed to get cache stats:', error);
      return {
        fileCount: 0,
        totalSize: 'error',
        totalSizeMB: 'error',
        maxSizeMB: 'unknown',
        maxAgeDays: 'unknown',
        cacheDir: 'unknown',
        status: `Error: ${error.message}`
      };
    }
  }

  /**
   * Clear all cached files
   * @returns {Promise<void>}
   */
  async clearCache() {
    // Ensure cache is initialized
    await this._initializeCache();
    if (!this.initialized) {
      throw new Error('Cache system not ready - Foundry not fully loaded');
    }

    try {
      const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
      const cacheDir = this._getCacheDirectory();
      const result = await FilePickerImpl.browse('data', cacheDir);
      
      for (const filePath of result.files) {
        try {
          const filename = filePath.split('/').pop();
          await FilePickerImpl.deleteFile('data', `${cacheDir}/${filename}`);
        } catch (error) {
          console.warn('fa-token-browser | Failed to delete cache file:', filePath, error);
        }
      }
      

    } catch (error) {
      console.error('fa-token-browser | Failed to clear cache:', error);
      throw error;
    }
  }
} 