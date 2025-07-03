/**
 * ForgeVTT Integration Service
 * Handles all ForgeVTT-specific functionality including:
 * - URL optimization to eliminate redirects
 * - Bucket detection and management
 * - Storage operations with proper bucket context
 */

/**
 * Service for handling ForgeVTT integrations
 */
export class ForgeIntegrationService {
  constructor() {
    this.forgeAccountId = null;
    this.isInitialized = false;
    this.initializationPromise = null;
    this.isForgeDetected = null; // Cache the detection result
  }

  /**
   * Check if we're running on Forge
   * @returns {boolean}
   */
  isRunningOnForge() {
    if (this.isForgeDetected !== null) {
      return this.isForgeDetected;
    }
    
    this.isForgeDetected = window.location.hostname.includes('forge-vtt.com') || 
                          window.location.hostname.includes('forgevtt.com') ||
                          (typeof ForgeVTT !== 'undefined' && ForgeVTT.usingTheForge);
    
    return this.isForgeDetected;
  }

  /**
   * Initialize the Forge integration service
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
   * Initialize Forge-specific data
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
    const currentBucket = this.detectCurrentForgeBucket();
    if (currentBucket) {
      return 'forgevtt'; // Use Forge VTT source with bucket selection
    }
    
    return 'data'; // Fallback to default
  }

  /**
   * Get the appropriate Forge bucket for FA Token Browser operations
   * @returns {string|number|null} Bucket key/index or null if not available
   */
  detectCurrentForgeBucket() {
    try {
      const buckets = this.getForgeVTTBuckets();
      if (!buckets || buckets.length === 0) {
        console.warn('fa-token-browser | No Forge buckets available');
        return null;
      }

      const bucketPreference = game.settings.get('fa-token-browser', 'preferredForgeBucket');
      
      // If preference is set and valid, use it
      if (bucketPreference && buckets[bucketPreference]) {
        return bucketPreference;
      }
      
      // Default to first bucket
      return 0;
    } catch (error) {
      console.warn('fa-token-browser | Error detecting current Forge bucket:', error);
      return null;
    }
  }

  /**
   * Get available ForgeVTT buckets
   * @returns {Array} Array of bucket objects or empty array
   */
  getForgeVTTBuckets() {
    if (!this.isRunningOnForge()) {
      return [];
    }
    
    try {
      // Try different ways to access Forge bucket data
      if (window.ForgeVTTFilePickerCore && window.ForgeVTTFilePickerCore.getForgeVTTBuckets) {
        return window.ForgeVTTFilePickerCore.getForgeVTTBuckets();
      }
      
      if (window.ForgeVTT_FilePicker && window.ForgeVTT_FilePicker.getForgeVTTBuckets) {
        return window.ForgeVTT_FilePicker.getForgeVTTBuckets();
      }
      
      // Try global ForgeAPI
      if (window.ForgeAPI && window.ForgeAPI.getBuckets) {
        return window.ForgeAPI.getBuckets();
      }
      
      return [];
    } catch (error) {
      console.warn('fa-token-browser | Error getting Forge buckets:', error);
      return [];
    }
  }

  /**
   * Get bucket options for FilePicker operations
   * @returns {Object} Options object with bucket information
   */
  getBucketOptions() {
    if (!this.isRunningOnForge()) {
      return {};
    }

    const currentBucket = this.detectCurrentForgeBucket();
    if (currentBucket === null) {
      return {};
    }

    return {
      bucket: currentBucket,
      ...this.getBucketCallOptions()
    };
  }

  /**
   * Get bucket call options for ForgeVTT API calls
   * @returns {Object} Options for bucket API calls
   */
  getBucketCallOptions() {
    if (!this.isRunningOnForge()) {
      return {};
    }

    const currentBucket = this.detectCurrentForgeBucket();
    if (currentBucket === null) {
      return {};
    }

    return {
      bucket: currentBucket
    };
  }

  /**
   * Update Forge bucket choices in module settings with real bucket names
   * @returns {Promise<void>}
   */
  async updateForgeBucketChoices() {
    if (!this.isRunningOnForge()) {
      console.log('fa-token-browser | Not running on Forge, skipping bucket detection');
      return;
    }

    try {
      console.log('fa-token-browser | Updating Forge bucket choices...');
      console.log('fa-token-browser | window.ForgeVTT_FilePicker:', !!window.ForgeVTT_FilePicker);
      console.log('fa-token-browser | window.ForgeVTTFilePickerCore:', !!window.ForgeVTTFilePickerCore);
      console.log('fa-token-browser | window.ForgeAPI:', !!window.ForgeAPI);

      let forgeCore = null;
      let buckets = [];
      
      if (window.ForgeVTTFilePickerCore) {
        forgeCore = window.ForgeVTTFilePickerCore;
      } else if (window.ForgeVTT_FilePicker) {
        forgeCore = window.ForgeVTT_FilePicker;
      } else if (window.ForgeAPI) {
        forgeCore = window.ForgeAPI;
      }
      
      if (!forgeCore) {
        console.log('fa-token-browser | No Forge objects found, skipping bucket detection');
        return;
      }

      console.log('fa-token-browser | Found Forge object, detecting buckets...');
      
      // Try different methods to get buckets
      if (forgeCore.getForgeVTTBucketsAsync) {
        console.log('fa-token-browser | Trying getForgeVTTBucketsAsync...');
        buckets = await forgeCore.getForgeVTTBucketsAsync();
      } else if (forgeCore.getForgeVTTBuckets) {
        console.log('fa-token-browser | Trying getForgeVTTBuckets...');
        buckets = forgeCore.getForgeVTTBuckets();
      } else if (forgeCore.getBuckets) {
        console.log('fa-token-browser | Trying getBuckets...');
        buckets = await forgeCore.getBuckets();
      }

      console.log('fa-token-browser | Found buckets:', buckets);

      if (!buckets || buckets.length === 0) {
        console.warn('fa-token-browser | No buckets found');
        return;
      }

      // Build choices object with bucket names
      const choices = {};
      buckets.forEach((bucket, index) => {
        const bucketName = bucket.name || bucket.label || bucket.title || `Bucket ${index + 1}`;
        choices[index] = bucketName;
      });

      console.log('fa-token-browser | Bucket choices:', choices);

      // Update the setting choices
      const setting = game.settings.settings.get('fa-token-browser.preferredForgeBucket');
      if (setting) {
        setting.choices = choices;
        console.info('fa-token-browser | Updated Forge bucket choices:', Object.values(choices));
      } else {
        console.warn('fa-token-browser | Could not find preferredForgeBucket setting');
      }
    } catch (error) {
      console.warn('fa-token-browser | Failed to update Forge bucket choices:', error);
    }
  }

  /**
   * Register Forge-specific game settings
   */
  static registerSettings() {
    // Register Forge bucket preference setting (will be populated dynamically)
    game.settings.register('fa-token-browser', 'preferredForgeBucket', {
      name: 'Preferred Forge Storage Bucket',
      hint: 'Choose which Forge storage bucket to use for token caching. This setting will be populated with your available buckets when you open the FA Token Browser.',
      scope: 'world',
      config: true,
      type: String,
      default: '0',
      choices: {
        '0': 'Auto-detect (First Available)'
      },
      onChange: (value) => {
        console.log('fa-token-browser | Forge bucket preference changed:', value);
      }
    });
  }
}

// Export singleton instance
export const forgeIntegration = new ForgeIntegrationService(); 