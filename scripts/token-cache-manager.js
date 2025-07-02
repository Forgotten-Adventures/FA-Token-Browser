/**
 * TokenCacheManager - Handles downloading and caching cloud tokens as local files
 * Critical for Foundry compatibility since actors need actual file paths, not URLs
 */

import { isCloudToken } from './token-data-types.js';

/**
 * Forge URL Optimizer - Detects Forge account ID and constructs direct asset URLs
 * to avoid 300-500ms redirect delays. Also handles world owner detection for storage.
 */
class ForgeURLOptimizer {
  constructor() {
    this.forgeAccountId = null;
    this.isInitialized = false;
    this.initializationPromise = null;
  }

  /**
   * Check if we're running on Forge
   * @returns {boolean}
   */
  isRunningOnForge() {
    return window.location.hostname.includes('forge-vtt.com') || 
           window.location.hostname.includes('forgevtt.com') ||
           (typeof ForgeVTT !== 'undefined' && ForgeVTT.usingTheForge);
  }

  /**
   * Initialize Forge account ID detection for URL optimization
   * @returns {Promise<boolean>} True if initialized successfully
   */
  async initialize() {
    if (this.isInitialized || !this.isRunningOnForge()) {
      return this.isInitialized;
    }

    // Return existing promise if already initializing
    if (this.initializationPromise) {
      return await this.initializationPromise;
    }

    this.initializationPromise = this._initializeForgeData();
    const result = await this.initializationPromise;
    this.initializationPromise = null;
    return result;
  }

  /**
   * Initialize account ID detection for URL optimization
   * @returns {Promise<boolean>} True if initialized successfully
   * @private
   */
  async _initializeForgeData() {
    try {
      // Detect account ID from module icon for URL optimization
      const accountIdDetected = await this._detectForgeAccountId();
      return accountIdDetected;
    } catch (error) {
      console.error('fa-token-browser | Failed to initialize Forge data:', error);
      return false;
    }
  }

  /**
   * Detect Forge account ID by following redirects to get the final assets URL
   * @returns {Promise<boolean>} True if account ID detected successfully
   * @private
   */
  async _detectForgeAccountId() {
    try {
      // Use fetch to follow redirects and get the final URL
      const iconPath = 'modules/fa-token-browser/images/cropped-FA-Icon-Plain-v2.png';
      
      const response = await fetch(iconPath, {
        method: 'HEAD',
        redirect: 'follow' // Follow redirects to get final URL
      });
      
      // Get the final URL after redirects
      const finalURL = response.url;
      
      // Pattern: https://assets.forge-vtt.com/{accountId}/modules/fa-token-browser/images/cropped-FA-Icon-Plain-v2.png
      const match = finalURL.match(/assets\.forge-vtt\.com\/([^\/]+)\//);
      
      if (match && match[1]) {
        this.forgeAccountId = match[1];
        this.isInitialized = true;
        console.info(`fa-token-browser | Forge account ID detected from redirect: ${this.forgeAccountId}`);
        console.info(`fa-token-browser | Original URL: ${iconPath}`);
        console.info(`fa-token-browser | Final URL: ${finalURL}`);
        return true;
      } else {
        console.warn('fa-token-browser | Failed to extract Forge account ID from final URL:', finalURL);
        return false;
      }
    } catch (error) {
      console.warn('fa-token-browser | Error detecting Forge account ID via fetch, trying fallback method:', error);
      
      // Fallback: Try with image element (original method)
      try {
        return await this._detectForgeAccountIdFallback();
      } catch (fallbackError) {
        console.error('fa-token-browser | Both Forge account ID detection methods failed:', fallbackError);
        return false;
      }
    }
  }

  /**
   * Fallback method for Forge account ID detection using image element
   * @returns {Promise<boolean>} True if account ID detected successfully
   * @private
   */
  async _detectForgeAccountIdFallback() {
    return new Promise((resolve) => {
      const testImg = new Image();
      testImg.crossOrigin = "anonymous";
      
      testImg.onload = () => {
        try {
          // Note: testImg.src will still be the original URL, not the redirected one
          // This fallback method is less reliable but kept for compatibility
          const originalURL = testImg.src;
          console.warn('fa-token-browser | Using fallback detection method with limited redirect info');
          resolve(false); // Fallback method can't access redirect URL
        } catch (error) {
          console.warn('fa-token-browser | Fallback detection error:', error);
          resolve(false);
        }
      };
      
      testImg.onerror = () => {
        console.warn('fa-token-browser | Fallback icon load failed');
        resolve(false);
      };
      
      testImg.src = 'modules/fa-token-browser/images/cropped-FA-Icon-Plain-v2.png';
    });
  }

  /**
   * Optimize a cache file path to use direct Forge assets URL if possible
   * @param {string} cachePath - Original cache path (e.g., "fa-token-browser-cache/file.webp")
   * @returns {string} Optimized URL or original path
   */
  optimizeCacheURL(cachePath) {
    if (!this.isInitialized || !this.forgeAccountId || !this.isRunningOnForge()) {
      return cachePath; // Return original path if not optimized
    }

    // Don't double-optimize: check if already an optimized URL
    if (cachePath.startsWith('https://assets.forge-vtt.com/')) {
      return cachePath; // Already optimized
    }

    // Convert cache path to direct Forge assets URL
    // Example: "fa-token-browser-cache/file.webp" -> "https://assets.forge-vtt.com/{accountId}/fa-token-browser-cache/file.webp"
    return `https://assets.forge-vtt.com/${this.forgeAccountId}/${cachePath}`;
  }

  /**
   * Get the Forge account ID if available
   * @returns {string|null} The Forge account ID or null
   */
  getAccountId() {
    return this.forgeAccountId;
  }





  /**
   * Get storage target for file operations on Forge
   * @returns {string} Storage target ('data' for local/owner, or default Forge bucket system)
   */
  getStorageTarget() {
    if (!this.isRunningOnForge()) {
      return 'data'; // Standard Foundry storage
    }
    
    // On Forge, detect current bucket selection and use appropriate storage
    const currentBucket = this._detectCurrentForgeBucket();
    if (currentBucket) {
      return 'forgevtt'; // Use Forge VTT source with bucket selection
    }
    
    return 'data'; // Fallback to default
  }

  /**
   * Get the appropriate Forge bucket for FA Token Browser operations
   * @returns {string|number|null} Bucket key/index or null if not available
   * @private
   */
  _detectCurrentForgeBucket() {
    try {
      const buckets = this._getForgeVTTBuckets();
      if (!buckets || buckets.length === 0) {
        return null;
      }
      
      // Get user's bucket preference from settings
      const preferredSetting = game.settings.get('fa-token-browser', 'preferredForgeBucket');
      
      // Parse the setting as a bucket index
      const bucketIndex = parseInt(preferredSetting);
      
      if (preferredSetting === 'auto' || isNaN(bucketIndex)) {
        // Auto mode: prefer shared buckets over "My Assets Library"
        const sharedBuckets = buckets.filter(bucket => bucket.label.startsWith('Shared Folder:'));
        
        if (sharedBuckets.length > 0) {
          // Use the first shared bucket
          const sharedBucket = sharedBuckets[0];
          const autoIndex = buckets.findIndex(b => b.key === sharedBucket.key);
          console.info(`fa-token-browser | Auto-selected shared bucket: ${sharedBucket.label} (index: ${autoIndex})`);
          return autoIndex;
        } else {
          // Use "My Assets Library" (first bucket)
          console.info(`fa-token-browser | Auto-selected default bucket: ${buckets[0].label} (index: 0)`);
          return 0;
        }
      }
      
      // Use specific bucket index if valid
      if (bucketIndex >= 0 && bucketIndex < buckets.length) {
        console.info(`fa-token-browser | Using preferred bucket: ${buckets[bucketIndex].label} (index: ${bucketIndex})`);
        return bucketIndex;
      }
      
      // Invalid index, fallback to auto-detection
      console.warn(`fa-token-browser | Invalid bucket index ${bucketIndex}, falling back to auto-detection`);
      const sharedBuckets = buckets.filter(bucket => bucket.label.startsWith('Shared Folder:'));
      const fallbackIndex = sharedBuckets.length > 0 ? buckets.findIndex(b => b.key === sharedBuckets[0].key) : 0;
      console.info(`fa-token-browser | Fallback bucket: ${buckets[fallbackIndex].label} (index: ${fallbackIndex})`);
      return fallbackIndex;
      
    } catch (error) {
      console.warn('fa-token-browser | Error detecting Forge bucket:', error);
      return null;
    }
  }

  /**
   * Get Forge VTT buckets using the same method as FilePicker
   * @returns {Array|null} Array of buckets or null if not available
   * @private
   */
  _getForgeVTTBuckets() {
    try {
      // Try multiple methods to access Forge buckets
      if (window.ForgeVTTFilePickerCore && window.ForgeVTTFilePickerCore.getForgeVTTBuckets) {
        return window.ForgeVTTFilePickerCore.getForgeVTTBuckets();
      }
      
      // Fallback: Try async method if available
      if (window.ForgeVTTFilePickerCore && window.ForgeVTTFilePickerCore.getForgeVTTBucketsAsync) {
        // This is async, but we can use cached results
        const cached = window.ForgeVTTFilePickerCore._forgeBucketIndex;
        if (cached) {
          return cached;
        }
      }
      
      return null;
    } catch (error) {
      console.warn('fa-token-browser | Error getting Forge buckets:', error);
      return null;
    }
  }

  /**
   * Get bucket call options for Forge API calls
   * @returns {object} Call options for bucket authentication
   * @private
   */
  _getBucketCallOptions() {
    try {
      const bucket = this._detectCurrentForgeBucket();
      if (bucket !== null && window.ForgeVTTFilePickerCore && window.ForgeVTTFilePickerCore.bucketToCallOptions) {
        const options = window.ForgeVTTFilePickerCore.bucketToCallOptions(bucket);
        console.debug(`fa-token-browser | Using bucket ${bucket} with options:`, options);
        return options;
      }
      return {};
    } catch (error) {
      console.warn('fa-token-browser | Error getting bucket call options:', error);
      return {};
    }
  }
}

// Global Forge URL optimizer instance
const forgeOptimizer = new ForgeURLOptimizer();

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
    
    // Initialize Forge URL optimizer for performance enhancement
    if (forgeOptimizer.isRunningOnForge()) {
      try {
        await forgeOptimizer.initialize();
      } catch (error) {
        console.warn('fa-token-browser | Failed to initialize Forge URL optimizer:', error);
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
      
      // Clean up old cached files on startup
      await this._cleanupOldCache();
      
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
      const storageTarget = forgeOptimizer.getStorageTarget();
      const bucketOptions = this._getBucketOptions();
      
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
   * Get bucket options for FilePicker operations on Forge
   * @returns {object} Options object with bucket information
   * @private
   */
  _getBucketOptions() {
    if (!forgeOptimizer.isRunningOnForge()) {
      return {};
    }
    
    const bucket = forgeOptimizer._detectCurrentForgeBucket();
    return bucket ? { bucket } : {};
  }

  /**
   * Scan cache directory and restore metadata for existing files
   * @private
   */
  async _scanAndRestoreCacheMetadata() {
    try {
      const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
      const cacheDir = this._getCacheDirectory();
      const storageTarget = forgeOptimizer.getStorageTarget();
      const bucketOptions = this._getBucketOptions();
      
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

    // Check if token is marked as downloaded in TokenData
    if (tokenData.cache.isDownloaded && tokenData.cache.localPath) {
      cachedPath = tokenData.cache.localPath;
    } else {
      // Check cache inventory (restored from filesystem scan)
      const inventoryEntry = this.cacheInventory.get(tokenData.filename);
      if (inventoryEntry) {
        // Restore TokenData metadata from inventory
        tokenData.cache.isDownloaded = true;
        tokenData.cache.localPath = inventoryEntry.localPath;
        tokenData.cache.downloadedAt = inventoryEntry.downloadedAt;
        tokenData.cache.lastAccessed = Date.now(); // Update access time
        
        cachedPath = inventoryEntry.localPath;
      }
    }
    
    // If we have a cached path, optimize it for Forge if possible
    if (cachedPath) {
      return forgeOptimizer.optimizeCacheURL(cachedPath);
    }
    
    return null; // Not cached
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
      const storageTarget = forgeOptimizer.getStorageTarget();
      const bucketOptions = this._getBucketOptions();
      
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
      return forgeOptimizer.optimizeCacheURL(cachePath);
      
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
      
      const storageTarget = forgeOptimizer.getStorageTarget();
      const bucketOptions = this._getBucketOptions();
      const result = await FilePickerImpl.browse(storageTarget, cacheDir, bucketOptions);
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
          await FilePickerImpl.deleteFile(storageTarget, `${cacheDir}/${filename}`, bucketOptions);
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
      const storageTarget = forgeOptimizer.getStorageTarget();
      const bucketOptions = this._getBucketOptions();
      const result = await FilePickerImpl.browse(storageTarget, cacheDir, bucketOptions);
      
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
      const storageTarget = forgeOptimizer.getStorageTarget();
      const bucketOptions = this._getBucketOptions();
      const result = await FilePickerImpl.browse(storageTarget, cacheDir, bucketOptions);
      
      const storageDesc = bucketOptions.bucket ? `bucket ${bucketOptions.bucket}` : `${storageTarget} storage`;
      console.info(`fa-token-browser | Clearing cache from ${storageDesc}: ${result.files.length} files`);
      
      for (const filePath of result.files) {
        try {
          const filename = filePath.split('/').pop();
          await FilePickerImpl.deleteFile(storageTarget, `${cacheDir}/${filename}`, bucketOptions);
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