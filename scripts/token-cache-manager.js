/**
 * TokenCacheManager - Handles downloading and caching cloud tokens as local files
 * Critical for Foundry compatibility since actors need actual file paths, not URLs
 */

import { isCloudToken } from './token-data-types.js';
import { forgeIntegration } from './forge-integration.js';

export class TokenCacheManager {
  constructor() {
    this.downloadPromises = new Map(); // Prevent duplicate downloads
    this.initialized = false;
    this.cacheInventory = new Map(); // filename -> cache metadata
    this.parentApp = null; // Reference to the token browser app for UI updates
  }

  /**
   * Set the parent app reference for UI updates
   * @param {TokenBrowserApp} parentApp - The parent token browser app
   */
  setParentApp(parentApp) {
    this.parentApp = parentApp;
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
   * Manually initialize cache (call when Foundry is ready)
   * @returns {Promise<boolean>} True if initialized successfully
   */
  async initialize() {
    await this._initializeCache();
    
    // Initialize Forge integration service for performance enhancement
    if (forgeIntegration.isRunningOnForge()) {
      try {
        await forgeIntegration.initialize();
      } catch (error) {
        console.warn('fa-token-browser | Failed to initialize Forge integration:', error);
      }
    }
    
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
      const storageTarget = forgeIntegration.getStorageTarget();
      const bucketOptions = forgeIntegration.getBucketOptions();
      
      // Try to browse the cache directory
      try {
        await FilePickerImpl.browse(storageTarget, cacheDir, bucketOptions);
      } catch (error) {
        // Directory doesn't exist, create it
        console.info(`fa-token-browser | Creating cache directory in ${storageTarget} storage: ${cacheDir}`);
        await FilePickerImpl.createDirectory(storageTarget, cacheDir, bucketOptions);
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
      const storageTarget = forgeIntegration.getStorageTarget();
      const bucketOptions = forgeIntegration.getBucketOptions();
      
      const result = await FilePickerImpl.browse(storageTarget, cacheDir, bucketOptions);
      const cachedFiles = result.files;
      
      console.info(`fa-token-browser | Scanning cache directory in ${storageTarget} storage: found ${cachedFiles.length} files`);
      
      // Build cache inventory from existing files
      for (const filePath of cachedFiles) {
        const filename = filePath.split('/').pop();
        
        // Store cache metadata for this file (relative path only)
        const cachePath = `${cacheDir}/${filename}`;
        this.cacheInventory.set(filename, {
          localPath: cachePath, // Store relative path - optimize on retrieval
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
   * Get cached file path for a token
   * @param {TokenData} tokenData - Token data
   * @returns {string|null} Cached file path or null if not cached
   */
  getCachedFilePath(tokenData) {
    if (!isCloudToken(tokenData)) {
      return null; // Local tokens don't need caching
    }

    let cachedPath = null;

    // Check if we have this token cached
    const filename = this._generateCacheFilename(tokenData);
    const cacheMetadata = this.cacheInventory.get(filename);
    
    if (cacheMetadata && cacheMetadata.isDownloaded) {
      // We have the file cached
      cachedPath = cacheMetadata.localPath;
      
      // Update last accessed time
      cacheMetadata.lastAccessed = Date.now();
      
      // Log that we're serving from cache
      console.debug(`fa-token-browser | Serving from cache: ${cachedPath}`);
    }
    
    // Apply Forge URL optimization if available
    if (cachedPath && forgeIntegration.isRunningOnForge()) {
      cachedPath = forgeIntegration.optimizeCacheURL(cachedPath);
    }
    
    return cachedPath;
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
      
      // Upload to appropriate storage using current bucket selection
      const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
      const storageTarget = forgeIntegration.getStorageTarget();
      const bucketOptions = forgeIntegration.getBucketOptions();
      
      const storageDesc = bucketOptions.bucket ? `bucket ${bucketOptions.bucket}` : `${storageTarget} storage`;
      console.info(`fa-token-browser | Uploading ${cacheFilename} to ${storageDesc}`);
      await FilePickerImpl.upload(storageTarget, cacheDir, file, bucketOptions, { notify: false });
      
      // Update token cache metadata (store relative path, optimize on retrieval)
      const now = Date.now();
      tokenData.cache.isDownloaded = true;
      tokenData.cache.localPath = cachePath; // Store relative path
      tokenData.cache.downloadedAt = now;
      tokenData.cache.lastAccessed = now;
      
      // Update cache inventory (store relative path)
      this.cacheInventory.set(tokenData.filename, {
        localPath: cachePath, // Store relative path
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
      
      // Return optimized path (optimize only at return point)
      return forgeIntegration.optimizeCacheURL(cachePath);
      
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
   * Destroy the cache manager and clean up all Maps
   */
  destroy() {
    // Clear download promises Map
    this.downloadPromises.clear();
    
    // Clear cache inventory Map  
    this.cacheInventory.clear();
    
    // Clear parent app reference
    this.parentApp = null;
    
    // Mark as uninitialized
    this.initialized = false;
  }


} 