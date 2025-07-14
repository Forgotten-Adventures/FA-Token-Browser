import { parseTokenSize, calculatePreviewSize, buildGridCSS } from './geometry.js';

/**
 * Manages hover preview functionality for token items
 * Handles creation, positioning, and cleanup of preview elements
 */
export class TokenPreviewManager {
  constructor(tokenDataService = null, eventManager = null) {
    // Preview element references
    this._previewElement = null;
    this._previewImg = null;
    this._previewFilename = null;
    this._previewPath = null;
    this._previewDimensions = null;
    
    // Preview context tracking
    this._currentPreviewImg = null;
    this._currentPreviewToken = null;
    this._currentPreviewId = null;
    this._previewIdCounter = 0;
    
    // Preview timeout
    this._previewTimeout = null;
    
    // Event management (use shared EventManager)
    this._eventManager = eventManager;
    
    // TokenDataService for unified data access
    this._tokenDataService = tokenDataService;
  }

  /**
   * Set the TokenDataService instance (for dependency injection)
   * @param {TokenDataService} tokenDataService - The token data service
   */
  setTokenDataService(tokenDataService) {
    this._tokenDataService = tokenDataService;
  }

  /**
   * Set the EventManager instance (for dependency injection)
   * @param {EventManager} eventManager - The event manager
   */
  setEventManager(eventManager) {
    this._eventManager = eventManager;
  }

  /**
   * Initialize the preview system by creating the reusable preview element
   */
  initialize() {
    if (!this._previewElement) {
      this._createPreviewElement();
    }
  }

  /**
   * Clean up all preview resources
   */
  destroy() {
    // MEMORY LEAK FIX: Cancel any pending animation frames
    if (this._showAnimationId) {
      cancelAnimationFrame(this._showAnimationId);
      this._showAnimationId = null;
    }
    if (this._positionAnimationId) {
      cancelAnimationFrame(this._positionAnimationId);
      this._positionAnimationId = null;
    }
    
    // Clear any pending preview timeout
    if (this._previewTimeout && this._eventManager) {
      this._eventManager.clearTimeout(this._previewTimeout);
      this._previewTimeout = null;
    }
    this._cleanupPreviewElement();
  }

  /**
   * Show hover preview for an image with timeout (enhanced with TokenData support)
   * @param {HTMLImageElement} img - The source image element
   * @param {HTMLElement} tokenItem - The token item element
   * @param {number} delay - Delay in milliseconds before showing preview
   * @param {TokenData} [tokenData] - Optional TokenData object for enhanced previews
   */
  showPreviewWithDelay(img, tokenItem, delay = 400, tokenData = null) {
    // Clear any existing timeout
    if (this._previewTimeout && this._eventManager) {
      this._eventManager.clearTimeout(this._previewTimeout);
      this._previewTimeout = null;
    }

    // Set up preview after delay using EventManager
    if (this._eventManager) {
      this._previewTimeout = this._eventManager.createTimeout(async () => {
        await this._showHoverPreview(img, tokenItem, tokenData);
        this._previewTimeout = null;
      }, delay);
    } else {
      // Fallback if no EventManager
      this._previewTimeout = setTimeout(async () => {
        await this._showHoverPreview(img, tokenItem, tokenData);
        this._previewTimeout = null;
      }, delay);
    }
  }

  /**
   * Hide hover preview immediately
   */
  hidePreview() {
    // Clear timeout if preview was pending
    if (this._previewTimeout) {
      if (this._eventManager) {
        this._eventManager.clearTimeout(this._previewTimeout);
      } else {
        clearTimeout(this._previewTimeout);
      }
      this._previewTimeout = null;
    }

    this._hideHoverPreview();
  }



  /**
   * Create the reusable preview element
   */
  _createPreviewElement() {
    const preview = document.createElement('div');
    preview.className = 'token-hover-preview';
    preview.style.display = 'none';
    
    const previewImg = document.createElement('img');
    previewImg.style.display = 'block';
    
    const previewInfo = document.createElement('div');
    previewInfo.className = 'preview-info';
    
    const previewFilename = document.createElement('div');
    previewFilename.className = 'preview-filename';
    
    const previewPath = document.createElement('div');
    previewPath.className = 'preview-path';
    
    const previewDimensions = document.createElement('div');
    previewDimensions.className = 'preview-dimensions';
    
    previewInfo.appendChild(previewFilename);
    previewInfo.appendChild(previewPath);
    previewInfo.appendChild(previewDimensions);
    
    preview.appendChild(previewImg);
    preview.appendChild(previewInfo);
    
    // Add to body
    document.body.appendChild(preview);
    
    // Store references
    this._previewElement = preview;
    this._previewImg = previewImg;
    this._previewFilename = previewFilename;
    this._previewPath = previewPath;
    this._previewDimensions = previewDimensions;
  }

  /**
   * Show locked preview for premium tokens when not authenticated
   * @param {string} filename - Token filename
   * @param {string} path - Token path
   * @param {HTMLElement} tokenItem - Token item element
   */


  /**
   * Check if token preview is allowed based on authentication and tier
   * @param {TokenData} tokenData - Token data
   * @returns {boolean} True if preview is allowed
   */
  _isPreviewAllowed(tokenData) {
    if (!tokenData) return false;
    
    // Local tokens always allow preview
    if (tokenData.source === 'local') return true;
    
    // For cloud tokens, check authentication and tier
    if (tokenData.source === 'cloud') {
      // Free cloud tokens always allow preview
      if (tokenData.tier === 'free') return true;
      
      // Premium cloud tokens require authentication OR being cached locally
      if (tokenData.tier === 'premium') {
        // Check if token is cached locally first (with error handling)
        try {
          if (this._tokenDataService?.isTokenCached) {
            const isTokenCached = this._tokenDataService.isTokenCached(tokenData);
            if (isTokenCached) {
              return true; // Cached premium tokens are always previewable
            }
          }
        } catch (error) {
          console.warn('fa-token-browser | Cache check failed in _isPreviewAllowed:', error);
          // Continue to authentication check on cache failure
        }
        
        // If not cached (or cache check failed), check authentication
        const authData = game.settings.get('fa-token-browser', 'patreon_auth_data');
        return authData && authData.authenticated;
      }
    }
    
    return false;
  }

  /**
   * Show hover preview for an image (enhanced with TokenData support)
   * @param {HTMLImageElement} img - The source image element
   * @param {HTMLElement} tokenItem - The token item element
   * @param {TokenData} [tokenData] - Optional TokenData object for enhanced previews
   */
  async _showHoverPreview(img, tokenItem, tokenData = null) {
    if (!this._previewElement) return;

    // Generate unique ID for this preview
    this._previewIdCounter++;
    const previewId = this._previewIdCounter;
    this._currentPreviewId = previewId;

    // Get token information from TokenData or fallback to DOM attributes
    let filename, path, source, tier;
    if (tokenData) {
      filename = tokenData.filename;
      path = tokenData.path;
      source = tokenData.source;
      tier = tokenData.tier;
    } else {
      // Fallback to DOM attributes for backward compatibility
      filename = tokenItem.getAttribute('data-filename');
      path = tokenItem.getAttribute('data-path');
      source = tokenItem.getAttribute('data-source') || 'local';
      tier = tokenItem.getAttribute('data-tier') || null;
    }

    // Check if preview is allowed for this token
    const isPreviewAllowed = this._isPreviewAllowed(tokenData);
    if (!isPreviewAllowed && tokenData && tokenData.source === 'cloud' && tokenData.tier === 'premium') {
      // No preview for premium tokens when not authenticated
      return;
    }

    // Clear previous image to prevent flicker (Bug Fix #2)
    this._previewImg.src = '';
    this._previewImg.style.opacity = '0';

    // Get the appropriate preview URL - prioritize cached files for cloud tokens
    let previewURL = img.src; // Use the full path as fallback, not thumbnail
    if (tokenData && this._tokenDataService) {
      try {
        // For cloud tokens, check if cached first to avoid unnecessary fetches
        if (tokenData.source === 'cloud') {
          const cachedPath = this._tokenDataService.cacheManager.getCachedFilePath(tokenData);
          if (cachedPath) {
            previewURL = cachedPath;
          } else {
            // Not cached, call cloud service directly to avoid redundant wrapper
            previewURL = await this._tokenDataService.cloudService.getFullURL(tokenData);
          }
        } else {
          // Local tokens - use full URL
          previewURL = await this._tokenDataService.getFullURL(tokenData);
        }
      } catch (error) {
        console.warn(`fa-token-browser | Failed to get preview URL for ${filename}, using path fallback:`, error);
        previewURL = img.src; // Fallback to full path, not thumbnail
      }
    } else {
      // No TokenData or TokenDataService - use path as fallback
      console.warn(`fa-token-browser | No TokenData or TokenDataService available for ${filename}, using path fallback`);
      previewURL = path;
    }

    // Check if this preview is still current (user might have moved to another token)
    if (this._currentPreviewId !== previewId) {
      return; // User moved away, abort this preview
    }

    // Update content with basic info first
    this._previewFilename.textContent = filename;
    
    // Enhanced path display with source information
    let pathDisplay = path;
    if (source === 'cloud') {
      pathDisplay += tier ? ` (${tier})` : ' (cloud)';
    }
    this._previewPath.textContent = pathDisplay;
    
    // Store current preview context for background updates
    this._currentPreviewImg = img;
    this._currentPreviewToken = tokenItem;
    
    const { gridWidth, gridHeight, scale } = parseTokenSize(filename);
    
    // Show initial preview with loading state
    this._previewElement.style.display = 'block';
    this._positionPreview(this._previewElement, tokenItem);
    
    // Show dimensions as loading initially
    this._updatePreviewDimensions(0, 0, gridWidth, gridHeight, scale, null, true);
    
    // Fade in - MEMORY LEAK FIX: Store animation frame ID
    this._showAnimationId = requestAnimationFrame(() => {
      this._previewElement.classList.add('visible');
      this._showAnimationId = null; // Clear after use
    });

    // Load the preview image and wait for it to complete (Bug Fix #1)
    try {
      await this._loadPreviewImage(previewURL, previewId, tokenData);
      
      // Check if this preview is still current after image load
      if (this._currentPreviewId !== previewId) {
        return; // User moved away, abort
      }

      // Apply responsive sizing after image loads
      this._applyResponsivePreviewSize(this._previewImg);
      
      // Reposition with actual dimensions after sizing - MEMORY LEAK FIX: Store animation frame ID
      this._positionAnimationId = requestAnimationFrame(() => {
        if (this._currentPreviewId === previewId) {
          this._positionPreview(this._previewElement, tokenItem);
        }
        this._positionAnimationId = null; // Clear after use
      });
      
      // Show the loaded image with fade-in
      this._previewImg.style.opacity = '1';
      
      // Get actual dimensions from the loaded image (Bug Fix #1)
      const actualWidth = this._previewImg.naturalWidth;
      const actualHeight = this._previewImg.naturalHeight;
      
      // Get metadata (file size, dimensions) using TokenData or fallback
      if (tokenData && this._tokenDataService) {
        // Use TokenDataService for enhanced metadata
        this._getEnhancedMetadata(tokenData, this._previewImg, gridWidth, gridHeight, scale, previewId, actualWidth, actualHeight);
      } else {
        // Use actual dimensions from loaded image
        this._updatePreviewDimensions(actualWidth, actualHeight, gridWidth, gridHeight, scale);
        
        // Try to get file size
        this._tryGetFileSize(previewURL)
          .then(fileSize => {
            if (this._previewElement && 
                this._previewElement.style.display === 'block' &&
                this._currentPreviewId === previewId) {
              if (fileSize) {
                this._updatePreviewDimensions(actualWidth, actualHeight, gridWidth, gridHeight, scale, fileSize);
              }
            }
          })
          .catch(() => {
            // Silent fail - file size will remain hidden
          });
      }
      
    } catch (error) {
      console.warn(`fa-token-browser | Failed to load preview image for ${filename}:`, error);
      // Show error state or fallback
      this._updatePreviewDimensions(0, 0, gridWidth, gridHeight, scale, null, false, 'Failed to load');
    }
  }

  /**
   * Load preview image and wait for completion - uses fetch for cloud tokens to avoid CORS issues
   * @param {string} imageURL - URL to load
   * @param {number} previewId - Preview ID for validation
   * @param {TokenData} [tokenData] - Optional token data to determine loading strategy
   * @returns {Promise} Resolves when image loads
   */
  async _loadPreviewImage(imageURL, previewId, tokenData = null) {
    // For cloud tokens, use fetch to avoid CORS caching issues
    // For local tokens, use simple img.src approach for performance
    const usesFetch = tokenData && tokenData.source === 'cloud';
    
    if (usesFetch) {
      return await this._loadPreviewImageWithFetch(imageURL, previewId);
    } else {
      return await this._loadPreviewImageWithImgSrc(imageURL, previewId);
    }
  }

  /**
   * Load preview image using fetch (for cloud tokens with CORS headers)
   * @param {string} imageURL - URL to load
   * @param {number} previewId - Preview ID for validation
   * @returns {Promise} Resolves when image loads
   */
  async _loadPreviewImageWithFetch(imageURL, previewId) {
    return new Promise(async (resolve, reject) => {
      try {
        // Check if preview is still current
        if (this._currentPreviewId !== previewId) {
          reject(new Error('Preview cancelled'));
          return;
        }

        // Fetch the image with proper headers
        const response = await fetch(imageURL);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Get the image as blob
        const blob = await response.blob();

        // Check if preview is still current after fetch
        if (this._currentPreviewId !== previewId) {
          reject(new Error('Preview cancelled'));
          return;
        }

        // Create object URL for the blob
        const objectURL = URL.createObjectURL(blob);

        // Set up cleanup for object URL
        const cleanup = () => {
          URL.revokeObjectURL(objectURL);
          this._previewImg.removeEventListener('load', onLoad);
          this._previewImg.removeEventListener('error', onError);
        };

        const onLoad = () => {
          cleanup();
          resolve();
        };
        
        const onError = (error) => {
          cleanup();
          reject(new Error(`Failed to load image: ${error.message || 'Unknown error'}`));
        };

        // Add event listeners
        this._previewImg.addEventListener('load', onLoad);
        this._previewImg.addEventListener('error', onError);

        // Start loading the blob
        this._previewImg.src = objectURL;
        this._previewImg.alt = this._previewFilename.textContent;

      } catch (error) {
        reject(new Error(`Fetch failed: ${error.message}`));
      }
    });
  }

  /**
   * Load preview image using img.src (for local tokens)
   * @param {string} imageURL - URL to load  
   * @param {number} previewId - Preview ID for validation
   * @returns {Promise} Resolves when image loads
   */
  async _loadPreviewImageWithImgSrc(imageURL, previewId) {
    return new Promise((resolve, reject) => {
      // Set up event handlers
      const onLoad = () => {
        cleanup();
        resolve();
      };
      
      const onError = (error) => {
        cleanup();
        reject(new Error(`Failed to load image: ${error.message || 'Unknown error'}`));
      };
      
      const cleanup = () => {
        this._previewImg.removeEventListener('load', onLoad);
        this._previewImg.removeEventListener('error', onError);
      };
      
      // Check if preview is still current
      if (this._currentPreviewId !== previewId) {
        cleanup();
        reject(new Error('Preview cancelled'));
        return;
      }
      
      // Add event listeners
      this._previewImg.addEventListener('load', onLoad);
      this._previewImg.addEventListener('error', onError);
      
      // Start loading
      this._previewImg.src = imageURL;
      this._previewImg.alt = this._previewFilename.textContent;
    });
  }

  /**
   * Get enhanced metadata using TokenDataService
   * @param {TokenData} tokenData - Token data object
   * @param {HTMLImageElement} img - The image element
   * @param {number} gridWidth - Grid width
   * @param {number} gridHeight - Grid height
   * @param {number} scale - Scale factor
   * @param {number} previewId - Preview ID for validation
   * @param {number} actualWidth - Actual loaded image width
   * @param {number} actualHeight - Actual loaded image height
   */
  async _getEnhancedMetadata(tokenData, img, gridWidth, gridHeight, scale, previewId, actualWidth, actualHeight) {
    try {
      // Get metadata from TokenDataService (includes file size)
      const metadata = await this._tokenDataService.getTokenMetadata(tokenData);
      
      // Only update if preview is still visible and showing the same preview ID
      if (this._previewElement && 
          this._previewElement.style.display === 'block' &&
          this._currentPreviewId === previewId) {
        
        // Use actual dimensions from loaded image (more reliable than metadata)
        const width = actualWidth || metadata.width || 0;
        const height = actualHeight || metadata.height || 0;
        const fileSize = metadata.fileSize > 0 ? this._formatFileSize(metadata.fileSize) : null;
        
        this._updatePreviewDimensions(width, height, gridWidth, gridHeight, scale, fileSize);
      }
    } catch (error) {
      // Fallback to actual dimensions from loaded image
      if (this._previewElement && 
          this._previewElement.style.display === 'block' &&
          this._currentPreviewId === previewId) {
        this._updatePreviewDimensions(actualWidth, actualHeight, gridWidth, gridHeight, scale);
      }
    }
  }

  /**
   * Format file size in human readable format
   */
  _formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Apply responsive preview sizing based on token size from filename
   */
  _applyResponsivePreviewSize(img) {
    const filename = img.alt || '';
    const sizeInfo = parseTokenSize(filename);
    const useLargerPreviews = game.settings.get('fa-token-browser', 'largerPreviews');
    const baseSize = useLargerPreviews ? 350 : 200;
    const { previewSize, containerMaxWidth } = calculatePreviewSize(sizeInfo, baseSize);
    img.style.maxWidth = `${previewSize}px`;
    img.style.maxHeight = `${previewSize}px`;
    this._previewElement.style.maxWidth = `${containerMaxWidth}px`;

    // apply grid overlay after sizing
    requestAnimationFrame(() => {
      const rect = img.getBoundingClientRect();
      const css = buildGridCSS(sizeInfo, rect.width, rect.height);
      Object.assign(img.style, css);
    });
  }

  /**
   * Update dimension info in preview
   */
  _updatePreviewDimensions(width, height, gridWidth, gridHeight, scale = 1, fileSize = null, isLoading = false, errorMessage = null) {
    if (this._previewDimensions) {
      let dimensionText;
      
      if (errorMessage) {
        dimensionText = `${errorMessage} (${gridWidth}×${gridHeight} grid`;
      } else if (isLoading) {
        dimensionText = `Loading... (${gridWidth}×${gridHeight} grid`;
      } else {
        dimensionText = `${width}×${height}px (${gridWidth}×${gridHeight} grid`;
      }
      
      if (scale !== 1) {
        dimensionText += ` at ${scale}x scale`;
      }
      dimensionText += ')';
      
      if (fileSize) {
        dimensionText += ` - ${fileSize}`;
      }
      
      this._previewDimensions.textContent = dimensionText;
    }
  }

  /**
   * Position the preview relative to the token item
   */
  _positionPreview(preview, tokenItem) {
    const rect = tokenItem.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Get token grid info for sizing estimate
    const filename = tokenItem.getAttribute('data-filename') || '';
    const { gridWidth, gridHeight } = parseTokenSize(filename);
    
    // Try to get actual preview dimensions first, fall back to estimates
    const previewRect = preview.getBoundingClientRect();
    const hasActualDimensions = previewRect.width > 0 && previewRect.height > 0;
    
    let estimatedWidth, estimatedHeight;
    
    if (hasActualDimensions) {
      // Use actual dimensions if available
      estimatedWidth = previewRect.width;
      estimatedHeight = previewRect.height;
    } else {
      // Calculate estimated dimensions based on grid size
      estimatedWidth = Math.min(600, (gridWidth * 400) + 100); // Max 600px, +100 for padding/info
      estimatedHeight = Math.min(700, (gridHeight * 400) + 200); // Max 700px, +200 for padding/info/metadata
    }
    
    let left = rect.right + 10; // Default to right side
    let top = rect.top;
    
    // If preview would go off right edge, show on left side
    if (left + estimatedWidth > viewportWidth - 10) {
      left = rect.left - estimatedWidth - 10;
    }
    
    // If preview would still go off left edge, center it horizontally
    if (left < 10) {
      left = Math.max(10, (viewportWidth - estimatedWidth) / 2);
    }
    
    // Adjust vertical position if needed
    if (top + estimatedHeight > viewportHeight - 10) {
      top = Math.max(10, viewportHeight - estimatedHeight - 10);
    }
    
    // Ensure preview doesn't go off screen edges
    left = Math.max(10, Math.min(left, viewportWidth - estimatedWidth - 10));
    top = Math.max(10, Math.min(top, viewportHeight - estimatedHeight - 10));
    
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
  }

  /**
   * Hide hover preview
   */
  _hideHoverPreview() {
    if (this._previewElement) {
      this._previewElement.classList.remove('visible');
      
      // Clear current preview context to prevent background updates
      this._currentPreviewImg = null;
      this._currentPreviewToken = null;
      this._currentPreviewId = null;
      
      // Use EventManager for timeout if available, otherwise fallback to setTimeout
      if (this._eventManager) {
        this._eventManager.createTimeout(() => {
          if (this._previewElement) {
            this._previewElement.style.display = 'none';
          }
        }, 200); // Match CSS transition duration
      } else {
        setTimeout(() => {
          if (this._previewElement) {
            this._previewElement.style.display = 'none';
          }
        }, 200);
      }
    }
  }

  /**
   * Clean up preview element
   */
  _cleanupPreviewElement() {
    if (this._previewElement) {
      // Remove from DOM
      if (this._previewElement.parentNode) {
        this._previewElement.parentNode.removeChild(this._previewElement);
      }
      
      // Clear references
      this._previewElement = null;
      this._previewImg = null;
      this._previewFilename = null;
      this._previewPath = null;
      this._previewDimensions = null;
      

    }
  }
} 