/**
 * CloudTokenService - Handles cloud token operations for the unified system
 * Integrated HTTP client for n8n cloud token endpoints with TokenData-compatible interface
 */

import { createTokenData, TOKEN_SOURCES, TOKEN_TIERS } from './token-data-types.js';
import { parseTokenSize } from './geometry.js';

export class CloudTokenService {
  constructor() {
    // HTTP client configuration (moved from CloudTokenAPI)
    this.config = {
      baseUrl: 'https://n8n.forgotten-adventures.net/webhook',
      endpoints: {
        browse: '/foundry-cloud-browse',
        download: '/foundry-token-download'
      },
      timeout: 15000, // 15 seconds
      maxRetries: 3,
      retryDelays: [1000, 2000, 4000, 8000] // Exponential backoff
    };
    
    // URL caching for signed URLs
    this.urlCache = new Map();
    this.urlCacheTimeout = 10 * 60 * 1000; // 10 minutes in milliseconds
    
    // Parent app reference for auth disconnect (similar to drag-drop manager pattern)
    this.parentApp = null;
    
    console.log('fa-token-browser | CloudTokenService initialized');
  }

  /**
   * Set parent app reference for proper auth disconnect handling
   * @param {Object} app - The parent TokenBrowserApp instance
   */
  setParentApp(app) {
    this.parentApp = app;
  }

  /**
   * Make a GET request to an n8n endpoint with retry logic
   * @param {string} endpoint - The endpoint path
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Response data
   * @private
   */
  async _makeRequest(endpoint, params = {}) {
    const authData = game.settings.get('fa-token-browser', 'patreon_auth_data');
    if (!authData || !authData.authenticated || !authData.state) {
      throw new Error('Authentication required - no valid auth state');
    }

    // Add auth state to parameters
    const queryParams = new URLSearchParams({
      state: authData.state,
      ...params
    });

    const url = `${this.config.baseUrl}${endpoint}?${queryParams.toString()}`;
    
    // Implement retry logic with exponential backoff
    let lastError;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          // Handle specific HTTP status codes
          if (response.status === 401 || response.status === 403) {
            // Authentication error - trigger disconnect via PatreonAuthService
            this._triggerAuthDisconnect();
            throw new Error('Authentication expired or invalid - please reconnect');
          } else if (response.status === 404) {
            throw new Error('Endpoint not found - server may be unavailable');
          } else if (response.status >= 500) {
            throw new Error(`Server error (${response.status}) - please try again later`);
          } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
        }

        const data = await response.json();
        return data;

      } catch (error) {
        lastError = error;
        
        // Don't retry on authentication errors
        if (error.message.includes('Authentication expired') || 
            error.message.includes('Authentication required')) {
          throw error;
        }

        // Don't retry on final attempt
        if (attempt === this.config.maxRetries) {
          break;
        }

        // Wait before retry (exponential backoff)
        const delay = this.config.retryDelays[attempt] || 8000;
        console.warn(`fa-token-browser | CloudTokenService: Request failed (attempt ${attempt + 1}), retrying in ${delay}ms:`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // All retries failed
    console.error('fa-token-browser | CloudTokenService: All retry attempts failed:', lastError);
    throw lastError;
  }

  /**
   * Browse all available cloud tokens (authenticated users get free + premium)
   * @returns {Promise<Object>} Token metadata with user info
   * @private
   */
  async _browseTokens() {
    const response = await this._makeRequest(this.config.endpoints.browse);
    
    if (!response.success) {
      throw new Error(response.message || 'Failed to browse cloud tokens');
    }
    
    return response;
  }

  /**
   * Browse free cloud tokens (no authentication required)
   * @returns {Promise<Object>} Free token metadata
   * @private
   */
  async _browseFreeTokens() {
    // Use direct fetch for free endpoint (no auth required)
    const url = `${this.config.baseUrl}/foundry-cloud-browse-free`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.message || 'Failed to browse free tokens');
    }
    
    return data;
  }

  /**
   * Generate CDN thumbnail URL for a token path (client-side, no server call needed)
   * @param {string} tokenPath - The token path (e.g., "creatures/dragon.png")
   * @returns {string} CDN thumbnail URL
   * @private
   */
  _generateThumbnailURL(tokenPath) {
    return `https://r2-public.forgotten-adventures.net/tokens/thumbnails/${tokenPath}`;
  }

  /**
   * Generate CDN URL for free tokens (client-side, no server call needed)
   * @param {string} tokenPath - The token path
   * @returns {string} CDN URL for free token
   * @private
   */
  _generateFreeTokenURL(tokenPath) {
    return `https://r2-public.forgotten-adventures.net/tokens/free_tokens/${tokenPath}`;
  }



  /**
   * Trigger authentication disconnect using existing PatreonAuthService
   * @private
   */
  async _triggerAuthDisconnect() {
    try {
      console.warn('fa-token-browser | Authentication error detected - triggering disconnect');
      
      // Clear URL cache since signed URLs will be invalid
      this.urlCache.clear();
      
      // Show user-friendly notification
      ui.notifications.warn('🔐 Authentication expired - please reconnect to access premium tokens');
      
      let tokenBrowser = null;
      
      // Method 1: Use direct parent app reference (like drag-drop manager)
      if (this.parentApp && this.parentApp.patreonAuth) {
        tokenBrowser = this.parentApp;
        console.log('fa-token-browser | Using direct parent app reference for disconnect');
      }
      
      // Fallback methods if parent app not available
      if (!tokenBrowser) {
        // Method 2: Query selector fallback
        let browserWindow = document.querySelector('.token-browser-app, [data-appid*="token-browser"]');
        
        // Method 3: Check all ApplicationV2 instances
        if (!browserWindow) {
          const tokenBrowserInstance = foundry.applications.instances.get('token-browser-app');
          if (tokenBrowserInstance?.element) {
            browserWindow = tokenBrowserInstance.element;
            tokenBrowser = tokenBrowserInstance;
          }
        }
        
        // Method 4: If we found the window but not the app, try to find the app from the window
        if (browserWindow && !tokenBrowser) {
          const appId = browserWindow.dataset?.appid || browserWindow.id;
          if (appId) {
            tokenBrowser = foundry.applications.instances.get('token-browser-app');
          }
        }
        
        if (tokenBrowser) {
          console.log('fa-token-browser | Found token browser app via fallback methods');
        }
      }
      
      if (tokenBrowser && tokenBrowser.patreonAuth) {
        // Use handlePatreonDisconnect with no confirmation for auto-disconnect
        await tokenBrowser.patreonAuth.handlePatreonDisconnect(tokenBrowser, false);
      } else {
        // Only use fallback if we absolutely can't find the app
        console.warn('fa-token-browser | Token browser app not found after comprehensive search, clearing auth data directly');
        await game.settings.set('fa-token-browser', 'patreon_auth_data', null);
      }
      
    } catch (error) {
      console.error('fa-token-browser | Error triggering authentication disconnect:', error);
      // Fallback: try to clear auth data directly
      try {
        await game.settings.set('fa-token-browser', 'patreon_auth_data', null);
      } catch (fallbackError) {
        console.error('fa-token-browser | Failed to clear auth data as fallback:', fallbackError);
      }
    }
  }

  /**
   * Check if user has valid authentication
   * @returns {boolean} True if authenticated
   */
  isAuthenticated() {
    const authData = game.settings.get('fa-token-browser', 'patreon_auth_data');
    return authData && authData.authenticated && authData.state;
  }

  /**
   * Get available cloud tokens based on authentication status
   * @returns {Promise<Object>} Token data with metadata
   * @private
   */
  async _getAvailableTokens() {
    // Try authenticated endpoint first if user is logged in
    if (this.isAuthenticated()) {
      try {
        return await this._browseTokens();
      } catch (error) {
        // If authenticated request fails due to auth error, handle it
        if (error.message.includes('Authentication expired') || 
            error.message.includes('Authentication required')) {
          // Auth error already handled in _makeRequest, just fall back to free tokens
          console.warn('fa-token-browser | CloudTokenService: Authentication failed, using free tokens only');
        } else {
          // Other errors, just fall back
          console.warn('fa-token-browser | CloudTokenService: Authenticated request failed, falling back to free tokens:', error.message);
        }
      }
    }
    
    // Use free endpoint as fallback or primary for unauthenticated users
    return await this._browseFreeTokens();
  }

  /**
   * Convert cloud token from n8n API to TokenData format
   * @param {Object} cloudToken - Cloud token from n8n API
   * @returns {TokenData} Unified TokenData object
   */
  convertCloudToken(cloudToken) {
    const tokenPath = cloudToken.token_path || cloudToken.path;
    const filename = tokenPath ? tokenPath.split('/').pop() : 'unknown';
    
    // Parse grid dimensions from filename using existing logic
    const parsed = parseTokenSize(filename);
    
    // Determine tier
    const tier = cloudToken.tier === 'premium' ? TOKEN_TIERS.PREMIUM : TOKEN_TIERS.FREE;
    
    // Create TokenData object
    const tokenData = createTokenData({
      filename: filename,
      path: tokenPath,
      source: TOKEN_SOURCES.CLOUD,
      metadata: {
        gridWidth: parsed.gridWidth,
        gridHeight: parsed.gridHeight,
        scale: parsed.scale,
        fileSize: cloudToken.file_size || cloudToken.size || 0,
        lastModified: cloudToken.last_modified ? new Date(cloudToken.last_modified) : new Date()
      },
      tier: tier
    });

    // Set URLs based on tier
    if (tier === TOKEN_TIERS.FREE) {
      // Free tokens: Use CDN URLs for both thumbnail and full
      tokenData.urls.thumbnail = this._generateThumbnailURL(tokenPath);
      tokenData.urls.full = this._generateFreeTokenURL(tokenPath);
    } else {
      // Premium tokens: Use CDN thumbnail, signed URL for full (will be generated on demand)
      tokenData.urls.thumbnail = this._generateThumbnailURL(tokenPath);
      tokenData.urls.full = null; // Will be generated on demand via getFullURL()
    }

    return tokenData;
  }



  /**
   * Get full URL for cloud token (used for both previews AND drag & drop URL phase)
   * @param {TokenData} tokenData - Token data
   * @returns {Promise<string>} Full URL
   */
  async getFullURL(tokenData) {
    if (tokenData.tier === TOKEN_TIERS.FREE) {
      // Free tokens: Use permanent CDN URL
      return tokenData.urls.full || this._generateFreeTokenURL(tokenData.path);
    } else {
      // Premium tokens: Generate/cache signed URL
      const cacheKey = tokenData.path;
      
      // Check if we have a cached signed URL that's still valid
      const cached = this.urlCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return cached.url;
      }

      try {
        // Generate new signed URL via n8n endpoint
        const response = await this._makeRequest(this.config.endpoints.download, {
          token_path: tokenData.path
        });
        
        if (!response.success) {
          throw new Error(response.message || 'Failed to generate download URL');
        }
        
        const signedURL = response.download_url;
        
        // Cache the signed URL for 10 minutes (signed URLs are valid for 15 minutes)
        this.urlCache.set(cacheKey, {
          url: signedURL,
          expiresAt: Date.now() + this.urlCacheTimeout
        });
        
        return signedURL;
        
      } catch (error) {
        console.error('fa-token-browser | Failed to generate signed URL:', error);
        throw new Error(`Failed to get access to premium token: ${error.message}`);
      }
    }
  }

  /**
   * Extract metadata from cloud token
   * @param {TokenData} tokenData - Token data
   * @returns {Promise<Object>} Token metadata (already available from n8n API)
   */
  async extractMetadata(tokenData) {
    // For cloud tokens, metadata is already available from the n8n API
    // We don't need to make additional requests
    return {
      fileSize: tokenData.metadata.fileSize,
      gridWidth: tokenData.metadata.gridWidth,
      gridHeight: tokenData.metadata.gridHeight,
      scale: tokenData.metadata.scale,
      lastModified: tokenData.metadata.lastModified,
      // Pixel dimensions will be available from DOM after image loads
      width: null,
      height: null
    };
  }

  /**
   * Check if cloud token exists and is accessible (simplified - avoids CORS issues)
   * @param {TokenData} tokenData - Token data
   * @returns {Promise<boolean>} True if token exists and is accessible
   */
  async tokenExists(tokenData) {
    try {
      // For cloud tokens, if they're in our manifest from the API, we assume they exist
      // This avoids CORS issues with HEAD requests to CDN URLs
      
      if (tokenData.tier === TOKEN_TIERS.FREE) {
        // Free tokens: if we have a CDN URL, assume it exists
        return !!(tokenData.urls.thumbnail || tokenData.urls.full);
      } else {
        // Premium tokens: check if user is authenticated (required for access)
        return this.isAuthenticated();
      }
    } catch (error) {
      console.warn('fa-token-browser | Token existence check failed:', error);
      return false;
    }
  }

  /**
   * Fetch available cloud tokens from n8n endpoints
   * @returns {Promise<Array<TokenData>>} Array of TokenData objects
   */
  async fetchAvailableTokens() {
    try {
      const response = await this._getAvailableTokens();
      
      if (!response.tokens || !Array.isArray(response.tokens)) {
        console.warn('fa-token-browser | Invalid cloud token response:', response);
        return [];
      }
      
      // Convert to TokenData format
      const tokenDataArray = response.tokens.map(token => this.convertCloudToken(token));
      
      return tokenDataArray;
      
    } catch (error) {
      console.error('fa-token-browser | Error fetching cloud tokens:', error);
      // Return empty array instead of throwing - graceful degradation
      return [];
    }
  }



  /**
   * Clear cached signed URLs (useful when authentication changes)
   */
  clearURLCache() {
    this.urlCache.clear();
  }

  /**
   * Get cache statistics for signed URLs
   * @returns {Object} URL cache statistics
   */
  getURLCacheStats() {
    const now = Date.now();
    let validCount = 0;
    let expiredCount = 0;
    
    for (const [key, cached] of this.urlCache.entries()) {
      if (now < cached.expiresAt) {
        validCount++;
      } else {
        expiredCount++;
      }
    }
    
    return {
      totalCached: this.urlCache.size,
      validURLs: validCount,
      expiredURLs: expiredCount,
      cacheTimeoutMinutes: this.urlCacheTimeout / (60 * 1000)
    };
  }

  /**
   * Clean up expired URLs from cache
   */
  cleanupExpiredURLs() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [key, cached] of this.urlCache.entries()) {
      if (now >= cached.expiresAt) {
        this.urlCache.delete(key);
        cleanedCount++;
      }
    }
    
    return cleanedCount;
  }
} 