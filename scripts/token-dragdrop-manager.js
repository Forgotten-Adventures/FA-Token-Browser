import { parseTokenSize, calcDragPreviewPixelDims } from './geometry.js';

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
 * Manages drag and drop functionality for token items
 * Handles drag setup, preview generation, and cleanup
 */
export class TokenDragDropManager {
  // Static drag state tracker - shared across all instances
  static _isTokenBrowserDragActive = false;
  static _currentDragData = null;
  
  /**
   * Static method to clean up all actor highlights
   * Called from various cleanup points to ensure highlights are removed
   */
  static cleanupActorHighlights() {
    document.querySelectorAll('.actor-drop-target').forEach(el => {
      el.classList.remove('actor-drop-target');
    });
  }
  
  constructor(parentApp) {
    this.parentApp = parentApp; // Reference to main TokenBrowserApp
    
    // Drag and drop instance
    this._dragDrop = null;
    
    // Event handlers for cleanup
    this._boundDragEndHandler = null;
    
    // Queued drag state tracking
    this._activeQueuedDrag = null;
    
    // Track tokens currently being prepared to prevent multiple downloads
    this._tokensBeingPrepared = new Set();
    
    // Track current canvas scale for cache invalidation
    this._lastCanvasScale = null;
    
    // Zoom watcher interval reference
    this._zoomWatcherInterval = null;
    
    // Performance optimization: Intersection Observer for off-screen cleanup
    this._intersectionObserver = null;
    this._setupIntersectionObserver();
  }

  /**
   * Initialize drag and drop system
   * @param {HTMLElement} gridElement - The token grid element
   */
  initialize(gridElement) {
    if (!gridElement) {
      console.warn('fa-token-browser | Drag & Drop: Token grid not found, skipping setup');
      return;
    }

    // Clean up existing DragDrop
    if (this._dragDrop) {
      this._dragDrop = null;
    }

    // Create new DragDrop instance using Foundry's standard class
    this._dragDrop = new foundry.applications.ux.DragDrop({
      dragSelector: '.token-item:not(.locked-token)',
      dropSelector: null, // We don't handle drops in this app
      permissions: {
        // Allow all drag starts except locked tokens
        dragstart: (selector) => {
          // Note: Foundry's permission function only gets the selector string, not the element
          // We'll handle locked token checking in the callback
          return true;
        },
        drop: () => false
      },
      callbacks: {
        dragstart: this._onDragStart.bind(this)
      }
    });

    // Bind to the grid element
    this._dragDrop.bind(gridElement);
    
    // Setup additional event listeners for cleanup and zoom detection
    this._setupDragEventListeners();
    
    // Initialize canvas scale tracking
    this._lastCanvasScale = canvas?.stage?.scale?.x || 1;
    
    // Register existing tokens with intersection observer
    this._registerTokensWithObserver(gridElement);
  }

  /**
   * Clean up lingering preparation state that might block repeated cloud token attempts
   * @private
   */
  _cleanupPreparationState() {
    // Clear any lingering "being prepared" flags that might block future attempts
    const tokenItems = document.querySelectorAll('.token-item[data-path]');
    tokenItems.forEach(tokenItem => {
      if (tokenItem._isBeingPrepared) {
        tokenItem._isBeingPrepared = false;
      }
    });
    
    // Clear any lingering cursor override
    const existingStyle = document.getElementById('fa-token-browser-cursor-override');
    if (existingStyle) {
      existingStyle.remove();
    }
    
    // Note: We intentionally don't clear this._tokensBeingPrepared here
    // as that could interfere with ongoing downloads
  }

  /**
   * Clean up all drag and drop resources
   */
  destroy() {
    this._cleanupDragEventListeners();
    
    // Clean up zoom watcher
    this._cleanupZoomWatcher();
    
    // Clean up any active queued drag
    if (this._activeQueuedDrag) {
      const { preview, handlers } = this._activeQueuedDrag;
      this._cleanupFloatingPreview(preview, handlers.mouseMoveHandler, handlers.mouseUpHandler, handlers.keyHandler);
      this._activeQueuedDrag = null;
    }
    
    // Clear tokens being prepared set and DOM flags
    this._tokensBeingPrepared.clear();
    
    // Clean up DOM-level preparation flags
    document.querySelectorAll('.token-item[data-path]').forEach(tokenItem => {
      if (tokenItem._isBeingPrepared) {
        tokenItem._isBeingPrepared = false;
      }
    });
    
    // Clean up any remaining cursor override
    const existingStyle = document.getElementById('fa-token-browser-cursor-override');
    if (existingStyle) {
      existingStyle.remove();
    }
    
    // Clean up Foundry DragDrop instance
    if (this._dragDrop) {
      this._dragDrop = null;
    }
    
    // Clean up intersection observer
    if (this._intersectionObserver) {
      this._intersectionObserver.disconnect();
      this._intersectionObserver = null;
    }
  }

  /**
   * Setup zoom change detection using a polling approach
   * @private
   */
  _setupZoomWatcher() {
    // Use polling to detect zoom changes since Foundry hooks can be unreliable
    if (!this._zoomWatcherInterval) {
      this._zoomWatcherInterval = setInterval(() => {
        this._checkZoomChange();
      }, 250); // Check every 250ms
    }
  }

  /**
   * Clean up zoom watcher
   * @private
   */
  _cleanupZoomWatcher() {
    if (this._zoomWatcherInterval) {
      clearInterval(this._zoomWatcherInterval);
      this._zoomWatcherInterval = null;
    }
  }

  /**
   * Check for zoom changes and invalidate cache if needed
   * @private
   */
  _checkZoomChange() {
    const currentScale = canvas?.stage?.scale?.x || 1;
    
    // If scale changed significantly, invalidate all cached previews
    if (this._lastCanvasScale && Math.abs(currentScale - this._lastCanvasScale) > 0.01) {
      
      // Find all token items and invalidate their cached canvases
      const tokenItems = document.querySelectorAll('.token-item[data-path]');
      tokenItems.forEach(tokenItem => {
        if (tokenItem._preloadedDragCanvas && tokenItem._preloadedDragDimensions) {
          // Check if cached canvas dimensions are still valid for current zoom
          const filename = tokenItem.getAttribute('data-filename');
          if (filename) {
            const { gridWidth, gridHeight, scale } = parseTokenSize(filename);
            const currentDimensions = calcDragPreviewPixelDims(
              { gridWidth, gridHeight, scale },
              canvas?.scene?.grid?.size || 100,
              currentScale
            );
            
            const cachedDimensions = tokenItem._preloadedDragDimensions;
            const dimensionsMatch = Math.abs(cachedDimensions.width - currentDimensions.width) < 10 &&
                                   Math.abs(cachedDimensions.height - currentDimensions.height) < 10;
            
            if (!dimensionsMatch) {
              // Invalidate this cached canvas
              this._invalidateTokenCache(tokenItem);
              
              // If it's a local token, trigger re-preload
              const tokenData = this._getTokenDataFromElement(tokenItem);
              if (tokenData && tokenData.source !== 'cloud') {
                // For local tokens, immediately start preloading with new dimensions
                this.preloadDragImage(tokenItem);
              }
            }
          }
        }
      });
      
      this._lastCanvasScale = currentScale;
    }
  }

  /**
   * Invalidate a token's cached canvas and reset its drag state
   * @param {HTMLElement} tokenItem - The token item element
   * @private
   */
  _invalidateTokenCache(tokenItem) {
    // Clear cached canvas and dimensions
    if (tokenItem._preloadedDragCanvas) {
      if (typeof tokenItem._preloadedDragCanvas !== 'string' && tokenItem._preloadedDragCanvas.getContext) {
        const ctx = tokenItem._preloadedDragCanvas.getContext('2d');
        ctx.clearRect(0, 0, tokenItem._preloadedDragCanvas.width, tokenItem._preloadedDragCanvas.height);
      }
      delete tokenItem._preloadedDragCanvas;
    }
    
    if (tokenItem._preloadedDragDimensions) {
      delete tokenItem._preloadedDragDimensions;
    }
    
    // Reset draggable state - will be re-enabled when new canvas is ready
    tokenItem.setAttribute('draggable', 'false');
    tokenItem.style.cursor = 'grab';
    tokenItem.classList.remove('preloading');
  }

  /**
   * Preload drag image for smoother drag previews
   * @param {HTMLElement} tokenItem - The token item element
   */
  async preloadDragImage(tokenItem) {
    // Only preload if we don't already have a successfully loaded drag canvas
    if (!tokenItem._preloadedDragCanvas) {
      const path = tokenItem.getAttribute('data-path');
      const filename = tokenItem.getAttribute('data-filename');
      
      if (path && filename) {
        // Get TokenData for enhanced cloud support using optimized method
        const tokenData = this._getTokenDataFromElement(tokenItem);
        
        // Check if token is draggable before preloading
        const isDraggable = this._isTokenDraggable(tokenData);
        if (!isDraggable) {
          // Token is not draggable, set locked state
          tokenItem.setAttribute('draggable', 'false');
          tokenItem.style.cursor = 'not-allowed';
          tokenItem.classList.add('locked-token');
          tokenItem.classList.remove('preloading');
          return;
        }
        
        // Parse token size to calculate correct preview dimensions
        const { gridWidth, gridHeight, scale } = parseTokenSize(filename);
        const { width: previewWidth, height: previewHeight } = calcDragPreviewPixelDims(
          { gridWidth, gridHeight, scale },
          canvas?.scene?.grid?.size || 100,
          canvas?.stage?.scale?.x || 1
        );
        
        try {
          // Skip hover preload for NON-CACHED cloud tokens to avoid unwanted downloads and CORS taint
          if (tokenData && tokenData.source === 'cloud') {
            // Check if this cloud token is already cached (treat cached tokens like local)
            const isCached = this.parentApp.tokenDataService.isTokenCached(tokenData);
            if (!isCached) {
              // START with dragging DISABLED for non-cached cloud tokens - only enable after mousedown preparation
              tokenItem.setAttribute('draggable', 'false');
              tokenItem.style.cursor = 'grab';
              tokenItem.classList.remove('preloading', 'locked-token');
              return;
            }
            // If cached, continue with preload like a local token using the cached file path
          }

          // For local tokens and cached cloud tokens, get preview URL and continue with normal preload
          let previewURL = path; // Fallback
          if (tokenData && this.parentApp.tokenDataService) {
            // For cached cloud tokens, use the cached file path instead of CDN URL
            if (tokenData.source === 'cloud' && this.parentApp.tokenDataService.isTokenCached(tokenData)) {
              previewURL = this.parentApp.tokenDataService.cacheManager.getCachedFilePath(tokenData);
            } else {
              previewURL = await this.parentApp.tokenDataService.getFullURL(tokenData);
            }
          }
          const sourceImg = new Image();
          // Set crossOrigin for cloud tokens to prevent canvas tainting
          // Also set it for local tokens on Forge, as they may be served cross-origin
          if ((tokenData && tokenData.source === 'cloud') || isRunningOnForge()) {
            sourceImg.crossOrigin = "anonymous";
          }
          
          // MEMORY LEAK FIX: Store reference for cleanup
          tokenItem._preloadSourceImg = sourceImg;
          sourceImg.onload = () => {
            try {
              // Create canvas at the exact preview size
              const canvas = document.createElement('canvas');
              canvas.width = previewWidth;
              canvas.height = previewHeight;
              const ctx = canvas.getContext('2d');
              
              // Enable image smoothing for better quality
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';
              
              // Draw the source image scaled to fit the preview size
              ctx.drawImage(sourceImg, 0, 0, previewWidth, previewHeight);
              
              // Store the pre-rendered canvas
              tokenItem._preloadedDragCanvas = canvas;
              tokenItem._preloadedDragDimensions = { width: previewWidth, height: previewHeight };
              
              // Performance optimization: Pre-generate optimized data URL for drag operations
              try {
                // Try WebP first for smaller size and better performance
                let dataURL = canvas.toDataURL('image/webp', 0.8);
                
                // Fallback to PNG if WebP isn't supported
                if (!dataURL.startsWith('data:image/webp')) {
                  dataURL = canvas.toDataURL('image/png');
                }
                
                tokenItem._preloadedDragDataURL = dataURL;
              } catch (error) {
                // Check if this is a local token - canvas tainting shouldn't happen for truly local tokens
                const tokenData = this._getTokenDataFromElement(tokenItem);
                const isCloudToken = tokenData && tokenData.source === 'cloud';
                
                if (isCloudToken || isRunningOnForge()) {
                  // For cloud tokens or on Forge (where even local tokens may be cross-origin), 
                  // this is expected behavior - only log as info
                  console.info('fa-token-browser | Canvas tainted for drag optimization (using fallback):', filename);
                } else {
                  // For truly local tokens on local Foundry, this shouldn't happen
                  console.warn('fa-token-browser | Failed to generate optimized drag data URL (canvas may be tainted):', error);
                }
                
                // Don't store the data URL if canvas is tainted - fallback will be used
                tokenItem._preloadedDragDataURL = null;
              }
              
              // Now that preload is complete, enable dragging
              tokenItem.setAttribute('draggable', 'true');
              tokenItem.style.cursor = 'grab';
              tokenItem.classList.remove('preloading');
              
              // MEMORY LEAK FIX: Clear source image reference after successful load
              if (tokenItem._preloadSourceImg) {
                tokenItem._preloadSourceImg.onload = null;
                tokenItem._preloadSourceImg.onerror = null;
                delete tokenItem._preloadSourceImg;
              }
              
            } catch (error) {
              console.error(`fa-token-browser | Failed to create drag canvas for ${filename}:`, error);
              tokenItem._preloadedDragCanvas = null;
              tokenItem.setAttribute('draggable', 'false');
              tokenItem.style.cursor = 'grab';
              tokenItem.classList.remove('preloading');
              
              // MEMORY LEAK FIX: Clear source image reference after failed load
              if (tokenItem._preloadSourceImg) {
                tokenItem._preloadSourceImg.onload = null;
                tokenItem._preloadSourceImg.onerror = null;
                delete tokenItem._preloadSourceImg;
              }
            }
          };
          
          sourceImg.onerror = () => {
            console.warn(`fa-token-browser | Failed to preload source image for ${filename}`);
            tokenItem._preloadedDragCanvas = null;
            // Allow dragging anyway with fallback behavior
            tokenItem.setAttribute('draggable', 'true');
            tokenItem.style.cursor = 'grab';
            tokenItem.classList.remove('preloading');
            
            // MEMORY LEAK FIX: Clear source image reference after error
            if (tokenItem._preloadSourceImg) {
              tokenItem._preloadSourceImg.onload = null;
              tokenItem._preloadSourceImg.onerror = null;
              delete tokenItem._preloadSourceImg;
            }
          };
          
          sourceImg.src = previewURL;
          
          // Mark that we're loading
          tokenItem._preloadedDragCanvas = 'loading';
          
        } catch (error) {
          console.error(`fa-token-browser | Failed to get preview URL for ${filename}:`, error);
          // Allow dragging anyway with fallback behavior
          tokenItem.setAttribute('draggable', 'true');
          tokenItem.style.cursor = 'grab';
          tokenItem.classList.remove('preloading');
        }
      }
    }
  }

  /**
   * Check if token is draggable based on authentication and tier
   * @param {TokenData} tokenData - Token data
   * @returns {boolean} True if token can be dragged
   */
  _isTokenDraggable(tokenData) {
    if (!tokenData) return false;
    
    // Local tokens are always draggable
    if (tokenData.source === 'local') return true;
    
    // For cloud tokens, check authentication and tier
    if (tokenData.source === 'cloud') {
      // Free cloud tokens are always draggable
      if (tokenData.tier === 'free') return true;
      
      // Premium cloud tokens require authentication OR being cached locally
      if (tokenData.tier === 'premium') {
        // Check if token is cached locally first (with error handling)
        try {
          if (this.parentApp?.tokenDataService?.isTokenCached) {
            const isTokenCached = this.parentApp.tokenDataService.isTokenCached(tokenData);
            if (isTokenCached) {
              return true; // Cached premium tokens are always draggable
            }
          }
        } catch (error) {
          console.warn('fa-token-browser | Cache check failed in _isTokenDraggable:', error);
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
   * Check if drag preload is ready and enable dragging if so
   * @param {HTMLElement} tokenItem - The token item element
   */
  checkAndEnableDragging(tokenItem) {
    const preloadedCanvas = tokenItem._preloadedDragCanvas;
    const isReady = preloadedCanvas && typeof preloadedCanvas !== 'string' && preloadedCanvas.width > 0;
    
    // Get token data to check if it's a cloud token
    const tokenData = this._getTokenDataFromElement(tokenItem);
    const isNonCachedCloudToken = tokenData && tokenData.source === 'cloud' && !this.parentApp.tokenDataService.isTokenCached(tokenData);
    
    // Check if token is draggable based on authentication and tier
    const isDraggable = this._isTokenDraggable(tokenData);
    
    if (!isDraggable) {
      // Token is not draggable (e.g., premium token for non-authenticated user)
      tokenItem.setAttribute('draggable', 'false');
      tokenItem.style.cursor = 'not-allowed';
      tokenItem.classList.remove('preloading');
      tokenItem.classList.add('locked-token');
      return;
    }
    
    if (isReady && tokenItem.getAttribute('draggable') !== 'true') {
      // Preload is ready, enable dragging
      tokenItem.setAttribute('draggable', 'true');
      tokenItem.style.cursor = 'grab';
      tokenItem.classList.remove('preloading', 'locked-token');
      

    } else if (!isReady && tokenItem.getAttribute('draggable') === 'true' && !isNonCachedCloudToken) {
      // Preload not ready for LOCAL tokens and CACHED cloud tokens - disable dragging
      tokenItem.setAttribute('draggable', 'false');
      tokenItem.style.cursor = 'wait';
      tokenItem.classList.add('preloading');
      tokenItem.classList.remove('locked-token');
    }
    // For non-cached cloud tokens, don't add preloading class - they're ready to drag (mousedown will handle preparation)
  }

  /**
   * Clean up preloaded canvas and related data for a token item
   * @param {HTMLElement} tokenItem - The token item element
   */
  cleanupTokenPreload(tokenItem) {
    // Clear any pending cleanup timeout using EventManager if available
    if (tokenItem._cleanupTimeout) {
      if (this.parentApp?.eventManager) {
        this.parentApp.eventManager.clearTimeout(tokenItem._cleanupTimeout);
      } else {
        clearTimeout(tokenItem._cleanupTimeout);
      }
      tokenItem._cleanupTimeout = null;
    }
    
    // MEMORY LEAK FIX: Clean up source image handlers if they exist
    if (tokenItem._preloadSourceImg) {
      tokenItem._preloadSourceImg.onload = null;
      tokenItem._preloadSourceImg.onerror = null;
      tokenItem._preloadSourceImg.src = ''; // Stop any pending load
      delete tokenItem._preloadSourceImg;
    }
    
    if (tokenItem._preloadedDragCanvas) {
      // Clear canvas if it exists
      if (typeof tokenItem._preloadedDragCanvas !== 'string' && tokenItem._preloadedDragCanvas.getContext) {
        const ctx = tokenItem._preloadedDragCanvas.getContext('2d');
        ctx.clearRect(0, 0, tokenItem._preloadedDragCanvas.width, tokenItem._preloadedDragCanvas.height);
      }
      delete tokenItem._preloadedDragCanvas;
    }
    
    if (tokenItem._preloadedDragDimensions) {
      delete tokenItem._preloadedDragDimensions;
    }
    
    if (tokenItem._preloadedDragDataURL) {
      delete tokenItem._preloadedDragDataURL;
    }
    
    // Clean up intersection observer timeout
    if (tokenItem._offScreenTimeout) {
      clearTimeout(tokenItem._offScreenTimeout);
      tokenItem._offScreenTimeout = null;
    }
    
    // Reset draggable state
    tokenItem.setAttribute('draggable', 'false');
  }

  /**
   * Clean up all preloaded canvases and related data
   * @param {HTMLElement} gridElement - The token grid element
   */
  cleanupAllPreloads(gridElement) {
    if (!gridElement) return;
    
    const tokenItems = gridElement.querySelectorAll('.token-item');
    tokenItems.forEach(item => {
      item.classList.remove('dragging', 'preloading');
      item.style.cursor = 'grab';
      this.cleanupTokenPreload(item);
    });
  }



  /**
   * Get TokenData from a token element more efficiently
   * @param {HTMLElement} tokenItem - The token item element
   * @returns {TokenData|null} TokenData object or null
   * @private
   */
  _getTokenDataFromElement(tokenItem) {
    const filename = tokenItem.getAttribute('data-filename');
    if (!filename) {
      return null;
    }
    
    // Try to find the UI token and extract its TokenData
    const uiToken = this.parentApp._allImages?.find(token => token.filename === filename);
    return uiToken ? this.parentApp.tokenDataService.getTokenDataFromUIObject(uiToken) : null;
  }

  /**
   * Update cache indicator in the UI after a token is downloaded
   * @param {HTMLElement} tokenItem - The token item element
   * @param {TokenData} tokenData - The token data
   * @private
   */
  _updateCacheIndicator(tokenItem, tokenData) {
    if (!tokenItem || !tokenData || tokenData.source !== 'cloud') {
      return;
    }

    // Check if token is now cached
    const isCached = this.parentApp.tokenDataService.isTokenCached(tokenData);
    if (!isCached) {
      return;
    }

    // Update the UI token object to reflect cache status
    const uiToken = this.parentApp._allImages?.find(token => token.filename === tokenData.filename);
    if (uiToken) {
      uiToken.isCached = true;
    }

    // Add a small delay as requested before updating the icon
    setTimeout(() => {
      this.parentApp.updateTokenStatusIcon(tokenData.filename, 'cached');
    }, 200); // 200ms delay
  }

  /**
   * Handle drag start using Foundry's pattern
   * @param {DragEvent} event - The drag start event
   * @returns {Object|false} Drag data or false to cancel
   */
  async _onDragStart(event) {
    const tokenItem = event.currentTarget;
    if (!tokenItem || !tokenItem.classList.contains('token-item')) {
      return false;
    }
    
    // Immediately block dragging for locked tokens
    if (tokenItem.classList.contains('locked-token')) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }

    // Get TokenData for enhanced cloud support using optimized method
    const tokenData = this._getTokenDataFromElement(tokenItem);
    
    // Check if token is draggable first
    const isDraggable = this._isTokenDraggable(tokenData);
    if (!isDraggable) {
      // Show incentive message for premium tokens
      if (tokenData && tokenData.source === 'cloud' && tokenData.tier === 'premium') {
        ui.notifications.info('🔒 Premium token! Connect your Patreon account to unlock drag & drop access.');
      }
      return false; // Block the drag
    }

    // For cloud tokens, check if preloaded drag canvas is ready
    // If not ready, they should use queued drag instead of regular drag
    if (tokenData && tokenData.source === 'cloud') {
      const hasPreloadedCanvas = tokenItem._preloadedDragCanvas && 
                                typeof tokenItem._preloadedDragCanvas !== 'string' && 
                                tokenItem._preloadedDragCanvas.width > 0;
      
      if (!hasPreloadedCanvas) {
        // Block regular drag - token should use queued drag system
        return false;
      }
    }

    // FIX: Check draggable state here since we couldn't do it in permissions
    const draggableAttr = tokenItem.getAttribute('draggable');
    const isDraggableAttr = draggableAttr === 'true';
    const isPreloading = tokenItem.classList.contains('preloading');
    
    if (!isDraggableAttr || isPreloading) {
      return false; // Block the drag
    }

    // Hide preview immediately when drag starts
    if (this.parentApp.previewManager) {
      this.parentApp.previewManager.hidePreview();
    }

    const filename = tokenItem.getAttribute('data-filename');
    const path = tokenItem.getAttribute('data-path');
    
    if (!filename || !path) {
      console.warn('fa-token-browser | Drag Start: Token item missing required data attributes');
      return false;
    }

    // At this point, draggable=true means preload canvas is ready
    // (we only set draggable=true after successful preload)
    tokenItem.style.cursor = 'grabbing';
    tokenItem.classList.remove('preloading');

    // Parse token size information for the drag data
    const { gridWidth, gridHeight, scale } = parseTokenSize(filename);
    
    // Always calculate preview size at current zoom (don't rely on preloaded canvas zoom)
    const { width: previewWidth, height: previewHeight } = calcDragPreviewPixelDims(
      { gridWidth, gridHeight, scale },
      canvas?.scene?.grid?.size || 100,
      canvas?.stage?.scale?.x || 1
    );
    const wouldBeScaled = previewWidth > 3000 || previewHeight > 3000;
    
    if (wouldBeScaled) {
      const zoomLevel = canvas?.stage?.scale?.x || 1;
      ui.notifications.error(
        `Drag preview would be inaccurate for this large token. Please zoom out (current: ${Math.round(zoomLevel * 100)}%) and try again.`,
        { permanent: false, localize: false }
      );
      // Reset cursor and prevent drag
      tokenItem.style.cursor = 'grab';
      return false;
    }

    try {
      // For cloud tokens, use cached file path (downloaded in mousedown)
      // For local tokens, use original path
      let tokenFilePath = path;
      
      if (tokenData && tokenData.source === 'cloud') {
        // Cloud tokens should already be downloaded and cached from mousedown
        const cachedPath = this.parentApp.tokenDataService.cacheManager.getCachedFilePath(tokenData);
        if (cachedPath) {
          tokenFilePath = cachedPath;
        } else {
          // Fallback: download now if not cached (shouldn't happen normally)
          console.warn(`fa-token-browser | Cloud token not cached, downloading now: ${filename}`);
          tokenFilePath = await this.parentApp.tokenDataService.getFilePathForDragDrop(tokenData);
          // Update cache indicator after download
          this._updateCacheIndicator(tokenItem, tokenData);
        }
      }

      // Setup drag preview (canvas should already be ready from mousedown for cloud tokens)
      if (event.dataTransfer && event.dataTransfer.setDragImage) {
        await this._setupDragPreview(event, tokenItem, filename, tokenFilePath, gridWidth, gridHeight, scale);
      }
      
      // Create drag data using a custom type to avoid conflicts with Foundry's Actor handler
      const dragData = {
        type: 'fa-token-browser-token', // Use custom type to prevent Foundry's Actor handler from processing
        uuid: `fa-token-browser.Token.${filename}`, // Unique identifier for this drag
        source: 'token-browser',
        filename: filename,
        path: tokenFilePath, // Use local file path for actual token creation
        url: tokenFilePath,  // Use local file path for actual token creation
        // Add Actor-like data structure for our handler to use
        actorData: {
          name: filename.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').replace(/\b(tiny|small|medium|large|huge|gargantuan|scale\d+|\d+x\d+)\b/gi, '').replace(/\s+/g, ' ').trim().replace(/\b\w/g, l => l.toUpperCase()) || 'Unknown Actor',
          type: 'npc', // Default actor type
          prototypeToken: {
            width: gridWidth,
            height: gridHeight,
            texture: {
              src: tokenFilePath, // Use local file path for token texture
              scaleX: scale,
              scaleY: scale
            },
            lockRotation: false
          }
        },
        // Keep our custom data for backwards compatibility
        tokenSize: {
          gridWidth: gridWidth,
          gridHeight: gridHeight,
          scale: scale
        },
        // Add TokenData for future enhancements
        tokenData: tokenData,
        timestamp: Date.now()
      };
      
      // IMPORTANT: Set data in HTML5 DataTransfer so it's accessible in dropCanvasData hook
      if (event.dataTransfer) {
        event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        event.dataTransfer.effectAllowed = 'copy';
      }
      
      // Add visual feedback to the source token
      tokenItem.classList.add('dragging');
      tokenItem.style.cursor = 'grabbing';
      
      // Set global drag state for reliable drag detection
      TokenDragDropManager._isTokenBrowserDragActive = true;
      TokenDragDropManager._currentDragData = dragData;
      
      // Make browser window semi-transparent and non-interactive during drag (like PF2e compendium browser)
      this._setWindowTransparency(true);
      
      // Note: Using Foundry's default drag preview with Actor data for proper sizing
      
      return dragData;
      
    } catch (error) {
      console.error(`fa-token-browser | Drag Start: Failed to prepare drag data for ${filename}:`, error);
      
      // Show user-friendly error
      if (error.message.includes('Failed to download')) {
        ui.notifications.error(`Failed to download cloud token for drag & drop. Please try again.`);
      } else {
        ui.notifications.error(`Failed to prepare token for drag & drop: ${error.message}`);
      }
      
      // Reset cursor and prevent drag
      tokenItem.style.cursor = 'grab';
      tokenItem.classList.remove('dragging', 'preloading');
      
      return false;
    }
  }

  /**
   * Setup additional drag event handlers for cleanup and cloud token mousedown
   */
  _setupDragEventListeners() {
    // Clean up any existing listeners first to prevent duplicates
    this._cleanupDragEventListeners();
    
    // Listen for global dragend to clean up visual feedback
    this._boundDragEndHandler = (event) => {
      // Check if this drag originated from our token browser or if we have an active drag
      const tokenItem = event.target?.closest('.token-item');
      const isOurDrag = (tokenItem && tokenItem.classList.contains('dragging')) || 
                       TokenDragDropManager._isTokenBrowserDragActive;
      
      if (isOurDrag) {
        // Clear global drag state
        TokenDragDropManager._isTokenBrowserDragActive = false;
        TokenDragDropManager._currentDragData = null;
        
        // Remove visual feedback from original token
        if (tokenItem) {
          tokenItem.classList.remove('dragging', 'preloading');
          tokenItem.style.cursor = 'grab';
        }
        
        // Clean up any remaining actor highlights
        TokenDragDropManager.cleanupActorHighlights();
        
        // Restore window transparency and interactivity with delay to let users see token placement
        setTimeout(() => {
          this._setWindowTransparency(false);
        }, 400); // 400ms delay allows users to see where token was created
      }
    };

    // Listen for mousedown on token items to prepare cloud tokens
    this._boundMouseDownHandler = async (event) => {
      const tokenItem = event.target?.closest('.token-item');
      if (!tokenItem) return;

      // Skip drag preparation for right-click (button 2)
      if (event.button === 2) {
        return;
      }

      const tokenData = this._getTokenDataFromElement(tokenItem);
      
      // Check if token is draggable before preparing
      const isDraggable = this._isTokenDraggable(tokenData);
      if (!isDraggable) {
        // Show incentive message for premium tokens on click
        if (tokenData && tokenData.source === 'cloud' && tokenData.tier === 'premium') {
          ui.notifications.info('🔒 Premium token! Connect your Patreon account to unlock access.');
        }
        return;
      }
      
      if (tokenData && tokenData.source === 'cloud' && !tokenItem._preloadedDragCanvas) {
        const filename = tokenItem.getAttribute('data-filename');
        
        // Check if this token is already being prepared (prevents multiple downloads)
        if (this._tokensBeingPrepared.has(filename)) {
          return;
        }
        
        // Also check if the token item is already being processed (DOM-level check)
        if (tokenItem._isBeingPrepared) {
          return;
        }
        
        // Mark at both levels
        tokenItem._isBeingPrepared = true;
        
        // Mark token as being prepared
        this._tokensBeingPrepared.add(filename);
        
        // Capture the initial mouse position and check if user is trying to drag
        const initialMouseX = event.clientX;
        const initialMouseY = event.clientY;
        let userWantsToDrag = false;
        let mouseMoveHandler = null;
        
        // Track current mouse position and detect drag intent
        let currentMouseX = initialMouseX;
        let currentMouseY = initialMouseY;
        
        // Listen for mouse movement to detect drag intent
        mouseMoveHandler = (moveEvent) => {
          // Update current mouse position
          currentMouseX = moveEvent.clientX;
          currentMouseY = moveEvent.clientY;
          
          const deltaX = Math.abs(moveEvent.clientX - initialMouseX);
          const deltaY = Math.abs(moveEvent.clientY - initialMouseY);
          
          // If mouse moves more than 5 pixels, user wants to drag
          if (deltaX > 5 || deltaY > 5) {
            userWantsToDrag = true;
          }
        };
        
        // Listen for mouseup to clean up drag detection
        const mouseUpHandler = async (event) => {
          document.removeEventListener('mousemove', mouseMoveHandler);
          document.removeEventListener('mouseup', mouseUpHandler);
        };
        
        document.addEventListener('mousemove', mouseMoveHandler);
        document.addEventListener('mouseup', mouseUpHandler);
        
        try {
          // BLOCK dragging until ready - prevent fast click-and-drag failures
          tokenItem.setAttribute('draggable', 'false');
          tokenItem.style.cursor = 'progress';
          tokenItem.classList.add('preloading');
          
          // Change the actual mouse cursor to loading - use CSS override for stronger precedence
          const style = document.createElement('style');
          style.id = 'fa-token-browser-cursor-override';
          style.textContent = '* { cursor: progress !important; }';
          document.head.appendChild(style);
          
          // Download and cache the token (or get cached path if already downloaded)
          let localFilePath;
          const cachedPath = this.parentApp.tokenDataService.cacheManager.getCachedFilePath(tokenData);
          if (cachedPath) {
            localFilePath = cachedPath;
          } else {
            localFilePath = await this.parentApp.tokenDataService.getFilePathForDragDrop(tokenData);
            // Update cache indicator after download
            this._updateCacheIndicator(tokenItem, tokenData);
          }
          
          // Create drag canvas from local file using CURRENT zoom level
          const { gridWidth, gridHeight, scale } = parseTokenSize(filename);
          const currentCanvasScale = canvas?.stage?.scale?.x || 1;
          const { width: previewWidth, height: previewHeight } = calcDragPreviewPixelDims(
            { gridWidth, gridHeight, scale },
            canvas?.scene?.grid?.size || 100,
            currentCanvasScale
          );
          
          const dragCanvas = await this._createDragCanvas(localFilePath, previewWidth, previewHeight);
          
          if (dragCanvas) {
            // Store the canvas for drag start
            tokenItem._preloadedDragCanvas = dragCanvas;
            tokenItem._preloadedDragDimensions = { width: previewWidth, height: previewHeight };
          }
          
          // NOW enable dragging - everything is ready
          tokenItem.setAttribute('draggable', 'true');
          tokenItem.style.cursor = 'grab';
          tokenItem.classList.remove('preloading');
          
          // Reset the mouse cursor (unless we're about to start queued drag)
          if (!userWantsToDrag) {
            // Remove the cursor override style
            const existingStyle = document.getElementById('fa-token-browser-cursor-override');
            if (existingStyle) {
              existingStyle.remove();
            }
          }
          
          // If user wanted to drag, simulate the drag start automatically
          if (userWantsToDrag) {
            this._startQueuedDrag(tokenItem, currentMouseX, currentMouseY);
          }
          
        } catch (error) {
          console.error(`fa-token-browser | Failed to prepare cloud token ${filename}:`, error);
          // On error, leave draggable disabled to prevent broken drags
          tokenItem.setAttribute('draggable', 'false');
          tokenItem.style.cursor = 'not-allowed';
          tokenItem.classList.remove('preloading');
          
          // Reset the mouse cursor on error
          const existingStyle = document.getElementById('fa-token-browser-cursor-override');
          if (existingStyle) {
            existingStyle.remove();
          }
        } finally {
          // Mark token as no longer being prepared
          this._tokensBeingPrepared.delete(filename);
          tokenItem._isBeingPrepared = false;
          
          // Clean up event listeners
          document.removeEventListener('mousemove', mouseMoveHandler);
          document.removeEventListener('mouseup', mouseUpHandler);
        }
      }
    };

    // Add event listeners
    document.addEventListener('dragend', this._boundDragEndHandler, { capture: true });
    document.addEventListener('mousedown', this._boundMouseDownHandler, { capture: true });
    
    // Additional safety listeners to ensure transparency is always restored
    this._boundDragLeaveHandler = (event) => {
      // If drag leaves the document entirely, restore transparency with delay and cleanup highlights
      if (!event.relatedTarget && TokenDragDropManager._isTokenBrowserDragActive) {
        TokenDragDropManager.cleanupActorHighlights();
        setTimeout(() => {
          this._setWindowTransparency(false);
        }, 400);
      }
    };
    
    this._boundDropHandler = (event) => {
      // Ensure transparency is restored on any drop with delay
      setTimeout(() => {
        this._setWindowTransparency(false);
      }, 400);
    };
    
    // Add canvas dragover handler to clean up actor highlights when dragging over canvas
    this._boundCanvasDragOverHandler = (event) => {
      // Only respond if we have an active token browser drag and we're over the canvas
      if (TokenDragDropManager._isTokenBrowserDragActive && 
          (event.target.closest('#board') || event.target.closest('canvas'))) {
        // Clean up any actor highlights when dragging over canvas
        TokenDragDropManager.cleanupActorHighlights();
      }
    };
    
    document.addEventListener('dragleave', this._boundDragLeaveHandler, { capture: true });
    document.addEventListener('drop', this._boundDropHandler, { capture: true });
    document.addEventListener('dragover', this._boundCanvasDragOverHandler, { capture: true });
    
    // Listen for canvas zoom/pan changes - use a more reliable approach
    // The canvasPan hook might not work as expected, so let's use a different strategy
    if (canvas && canvas.stage) {
      // Listen for scale changes on the canvas stage directly
      this._setupZoomWatcher();
    }
  }

  /**
   * Start a queued drag operation after cloud token preparation is complete
   * Creates a visual drag preview that follows the cursor until user clicks to place
   * @param {HTMLElement} tokenItem - The token item element
   * @param {number} mouseX - Original mouse X position
   * @param {number} mouseY - Original mouse Y position
   */
  _startQueuedDrag(tokenItem, mouseX, mouseY) {
    try {
      const filename = tokenItem.getAttribute('data-filename');
      
      // Check if there's already an active queued drag
      if (this._activeQueuedDrag) {
        return;
      }
      
      // Remove loading cursor and return to normal cursor
      const loadingStyle = document.getElementById('fa-token-browser-cursor-override');
      if (loadingStyle) {
        loadingStyle.remove();
      }
      
      // Create a floating preview that follows the cursor
      const dragPreview = this._createFloatingPreview(tokenItem, mouseX, mouseY);
      if (!dragPreview) {
        // Cursor already reset above
        return;
      }
      
      // Track mouse movement to update preview position
      const mouseMoveHandler = (event) => {
        // Update preview position
        if (dragPreview) {
          dragPreview.style.left = `${event.clientX - dragPreview._offsetX}px`;
          dragPreview.style.top = `${event.clientY - dragPreview._offsetY}px`;
        }
        
        // Add visual feedback for actor drop targets
        const previousTarget = document.querySelector('.actor-drop-target');
        if (previousTarget) {
          previousTarget.classList.remove('actor-drop-target');
        }
        
        const actorElement = event.target.closest('.directory-item, .document, [data-entry-id]');
        if (actorElement) {
          const actorId = actorElement.getAttribute('data-entry-id') || 
                         actorElement.getAttribute('data-document-id') ||
                         actorElement.getAttribute('data-actor-id');
          if (actorId) {
            actorElement.classList.add('actor-drop-target');
          }
        }
      };
      
      // Handle mouseup to place token (complete the drag gesture)
      const mouseUpHandler = async (event) => {
        // Prevent multiple handling of the same mouseup event
        if (mouseUpHandler._isProcessing) {
          return;
        }
        mouseUpHandler._isProcessing = true;
        
        // First check if releasing over an actor in the sidebar
        const actorElement = event.target.closest('.directory-item, .document, [data-entry-id]');
        if (actorElement) {
          const actorId = actorElement.getAttribute('data-entry-id') || 
                         actorElement.getAttribute('data-document-id') ||
                         actorElement.getAttribute('data-actor-id');
          
          if (actorId) {
            // Create token data for actor drop
            const tokenData = this._getTokenDataFromElement(tokenItem);
            if (tokenData) {
              const filename = tokenItem.getAttribute('data-filename');
              const path = tokenItem.getAttribute('data-path');
              const { gridWidth, gridHeight, scale } = parseTokenSize(filename);
              
              // Get the cached file path for cloud tokens
              let tokenFilePath = path;
              if (tokenData.source === 'cloud') {
                const cachedPath = this.parentApp.tokenDataService.cacheManager.getCachedFilePath(tokenData);
                if (cachedPath) {
                  tokenFilePath = cachedPath;
                }
              }
              
              // Create drop data for actor update
              const dropData = {
                type: 'fa-token-browser-token',
                source: 'token-browser',
                filename: filename,
                url: tokenFilePath,
                thumbnailUrl: tokenData.urls?.thumbnail,
                tokenSource: tokenData.source,
                tier: tokenData.tier,
                tokenSize: {
                  gridWidth: gridWidth,
                  gridHeight: gridHeight,
                  scale: scale
                }
              };
              
              // Clean up IMMEDIATELY on drop - before showing dialog
              this._cleanupFloatingPreview(dragPreview, mouseMoveHandler, mouseUpHandler, keyHandler);
              this._activeQueuedDrag = null;
              mouseUpHandler._isProcessing = false; // Reset processing flag
              event.stopPropagation();
              event.preventDefault();
              
              // Handle the actor drop (this will show the dialog)
              await TokenDragDropManager.handleActorDrop(actorElement, dropData, event);
              
              return;
            }
          }
        }
        
        // Check if releasing over canvas (existing logic)
        const canvasElement = document.querySelector('#board');
        if (canvasElement && canvasElement.contains(event.target)) {
          // Create a synthetic drag event with proper dataTransfer
          const syntheticDragEvent = new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            clientX: event.clientX,
            clientY: event.clientY,
            dataTransfer: new DataTransfer()
          });
          
          // Simulate a drop on the canvas
          await this._simulateCanvasDrop(tokenItem, syntheticDragEvent);
        }
        
        // Clean up floating preview and reset state
        this._cleanupFloatingPreview(dragPreview, mouseMoveHandler, mouseUpHandler, keyHandler);
        this._activeQueuedDrag = null; // Reset active drag state
        mouseUpHandler._isProcessing = false; // Reset processing flag
      };
      
      // Handle escape key to cancel
      const keyHandler = (event) => {
        if (event.key === 'Escape') {
          this._cleanupFloatingPreview(dragPreview, mouseMoveHandler, mouseUpHandler, keyHandler);
          this._activeQueuedDrag = null; // Reset active drag state
          mouseUpHandler._isProcessing = false; // Reset processing flag
        }
      };
      
      // Set active queued drag state BEFORE adding event listeners
      this._activeQueuedDrag = {
        filename: filename,
        tokenItem: tokenItem,
        preview: dragPreview,
        handlers: { mouseMoveHandler, mouseUpHandler, keyHandler }
      };
      
      // Set global drag state for reliable drag detection
      TokenDragDropManager._isTokenBrowserDragActive = true;
      TokenDragDropManager._currentDragData = {
        type: 'fa-token-browser-token',
        source: 'token-browser',
        filename: filename
      };
      
      // Make browser window semi-transparent and non-interactive during queued drag
      this._setWindowTransparency(true);
      
      // Hide variants panel when queued drag actually starts (after download completes)
      // Delay to ensure drag system is fully initialized
      setTimeout(() => {
        this._hideVariantsPanel();
      }, 200);
      
      document.addEventListener('mousemove', mouseMoveHandler);
      document.addEventListener('mouseup', mouseUpHandler);
      document.addEventListener('keydown', keyHandler);
      
    } catch (error) {
      console.error('fa-token-browser | Failed to start queued drag:', error);
      // Reset state on error
      this._activeQueuedDrag = null;
    }
  }
  
  /**
   * Create a floating preview element that follows the cursor
   * @param {HTMLElement} tokenItem - The token item element
   * @param {number} mouseX - Initial mouse X position
   * @param {number} mouseY - Initial mouse Y position
   * @returns {HTMLElement|null} The floating preview element
   */
  _createFloatingPreview(tokenItem, mouseX, mouseY) {
    try {
      const canvas = tokenItem._preloadedDragCanvas;
      const dimensions = tokenItem._preloadedDragDimensions;
      
      if (!canvas || !dimensions) {
        console.warn('fa-token-browser | No preloaded canvas for floating preview');
        return null;
      }
      
      // Create preview element
      const preview = document.createElement('div');
      preview.className = 'fa-token-floating-preview';
      
      // Try to get data URL from canvas, fallback to cached/original image if tainted
      let backgroundImage;
      try {
        backgroundImage = `url(${canvas.toDataURL('image/webp', 0.8)})`;
      } catch (error) {
        // Only show warning if not on Forge (where canvas tainting is expected)
        if (!isRunningOnForge()) {
          console.warn('fa-token-browser | Canvas tainted, using fallback for floating preview:', error);
        }
        // Fallback to the cached file path for cloud tokens, or original path for local tokens
        const tokenData = this._getTokenDataFromElement(tokenItem);
        let fallbackPath = tokenItem.getAttribute('data-path');
        
        if (tokenData && tokenData.source === 'cloud') {
          const cachedPath = this.parentApp.tokenDataService.cacheManager.getCachedFilePath(tokenData);
          if (cachedPath) {
            fallbackPath = cachedPath;
          }
        }
        
        backgroundImage = fallbackPath ? `url(${fallbackPath})` : 'none';
      }
      
      preview.className = 'fa-token-browser-drag-preview';
      preview.style.width = `${dimensions.width}px`;
      preview.style.height = `${dimensions.height}px`;
      preview.style.backgroundImage = backgroundImage;
      
      // Store offset for centering
      preview._offsetX = dimensions.width / 2;
      preview._offsetY = dimensions.height / 2;
      
      // Position at cursor
      preview.style.left = `${mouseX - preview._offsetX}px`;
      preview.style.top = `${mouseY - preview._offsetY}px`;
      
      document.body.appendChild(preview);
      
      return preview;
      
    } catch (error) {
      console.error('fa-token-browser | Failed to create floating preview:', error);
      return null;
    }
  }
  
  /**
   * Clean up floating preview and event listeners
   */
  _cleanupFloatingPreview(preview, mouseMoveHandler, mouseUpHandler, keyHandler = null) {
    // Clear global drag state
    TokenDragDropManager._isTokenBrowserDragActive = false;
    TokenDragDropManager._currentDragData = null;
    
    // Reset cursor - remove any remaining loading cursor styles (just in case)
    const loadingStyle = document.getElementById('fa-token-browser-cursor-override');
    if (loadingStyle) {
      loadingStyle.remove();
    }
    
    // Restore window transparency and interactivity with delay to let users see token placement
    setTimeout(() => {
      this._setWindowTransparency(false);
      // No need to restore variants panel - it's already hidden
    }, 400); // 400ms delay allows users to see where token was created
    
    // Clean up actor drop target styling
    TokenDragDropManager.cleanupActorHighlights();
    
    // Immediately remove event listeners to prevent further processing
    document.removeEventListener('mousemove', mouseMoveHandler);
    document.removeEventListener('mouseup', mouseUpHandler);
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler);
    }
    
    // Clean up preview element
    if (preview && preview.parentNode) {
      preview.style.opacity = '0';
      // Remove immediately instead of setTimeout to prevent race conditions
      preview.parentNode.removeChild(preview);
    }
  }
  
  /**
   * Simulate a canvas drop for the queued drag
   * @param {HTMLElement} tokenItem - The token item element
   * @param {DragEvent} event - The synthetic drag event
   */
  async _simulateCanvasDrop(tokenItem, event) {
    try {
      const filename = tokenItem.getAttribute('data-filename');
      const path = tokenItem.getAttribute('data-path');
      const tokenData = this._getTokenDataFromElement(tokenItem);
      
      if (!tokenData) return;
      
      // Parse token size information
      const { gridWidth, gridHeight, scale } = parseTokenSize(filename);
      
      // Get the cached file path for cloud tokens
      let tokenFilePath = path;
      if (tokenData.source === 'cloud') {
        const cachedPath = this.parentApp.tokenDataService.cacheManager.getCachedFilePath(tokenData);
        if (cachedPath) {
          tokenFilePath = cachedPath;
        }
      }
      
      // Create drop data matching the normal drag format exactly
      const dropData = {
        type: 'fa-token-browser-token', // Use same custom type as normal drag
        uuid: `fa-token-browser.Token.${filename}`,
        source: 'token-browser',
        filename: filename,
        path: tokenFilePath,
        url: tokenFilePath,
        actorData: {
          name: filename.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').replace(/\b(tiny|small|medium|large|huge|gargantuan|scale\d+|\d+x\d+)\b/gi, '').replace(/\s+/g, ' ').trim().replace(/\b\w/g, l => l.toUpperCase()) || 'Unknown Actor',
          type: 'npc',
          prototypeToken: {
            width: gridWidth,
            height: gridHeight,
            texture: {
              src: tokenFilePath,
              scaleX: scale,
              scaleY: scale
            },
            lockRotation: false
          }
        },
        tokenSize: {
          gridWidth: gridWidth,
          gridHeight: gridHeight,
          scale: scale
        },
        tokenData: tokenData,
        timestamp: Date.now()
      };
      

      
      // Use ONLY the Foundry hook system to avoid duplication
      // The hook will call our handleCanvasDrop method which creates the actor
      try {
        const hookResult = await Hooks.call('dropCanvasData', canvas, dropData, event);
        if (hookResult !== false) {
          return;
        } else {
          console.warn(`fa-token-browser | dropCanvasData hook returned false for ${filename}`);
        }
      } catch (hookError) {
        console.error('fa-token-browser | dropCanvasData hook failed:', hookError);
        ui.notifications.error(`Failed to create token: ${hookError.message}`);
      }
      
    } catch (error) {
      console.error('fa-token-browser | Failed to simulate canvas drop:', error);
      ui.notifications.error(`Failed to create token: ${error.message}`);
    }
  }

  /**
   * Remove additional drag event listeners
   */
  _cleanupDragEventListeners() {
    if (this._boundDragEndHandler) {
      document.removeEventListener('dragend', this._boundDragEndHandler, { capture: true });
      this._boundDragEndHandler = null;
    }
    if (this._boundMouseDownHandler) {
      document.removeEventListener('mousedown', this._boundMouseDownHandler, { capture: true });
      this._boundMouseDownHandler = null;
    }
    if (this._boundDragLeaveHandler) {
      document.removeEventListener('dragleave', this._boundDragLeaveHandler, { capture: true });
      this._boundDragLeaveHandler = null;
    }
    if (this._boundDropHandler) {
      document.removeEventListener('drop', this._boundDropHandler, { capture: true });
      this._boundDropHandler = null;
    }
    if (this._boundCanvasDragOverHandler) {
      document.removeEventListener('dragover', this._boundCanvasDragOverHandler, { capture: true });
      this._boundCanvasDragOverHandler = null;
    }
    // Clean up zoom watcher
    this._cleanupZoomWatcher();
  }

  /**
   * Set window transparency and interactivity during drag operations
   * @param {boolean} transparent - Whether to make window transparent and non-interactive
   * @private
   */
  _setWindowTransparency(transparent) {
    // Try multiple ways to get the token browser window element
    let browserWindow = null;
    
    // Method 1: ApplicationV2 element property
    if (this.parentApp?.element) {
      browserWindow = this.parentApp.element;
    }
    
    // Method 2: ApplicationV2 element array (some versions)
    if (!browserWindow && this.parentApp?.element?.[0]) {
      browserWindow = this.parentApp.element[0];
    }
    
    // Method 3: Query selector fallback
    if (!browserWindow) {
      browserWindow = document.querySelector('.token-browser-app, [data-appid*="token-browser"]');
    }
    
    // Method 4: Check all ApplicationV2 instances
    if (!browserWindow) {
      const tokenBrowserInstance = foundry.applications.instances.get('token-browser-app');
      if (tokenBrowserInstance?.element) {
        browserWindow = tokenBrowserInstance.element;
      }
    }

    if (!browserWindow) {
      return;
    }

    if (transparent) {
      // Store original values for restoration BEFORE changing them
      if (!browserWindow._originalOpacity) {
        browserWindow._originalOpacity = browserWindow.style.opacity || '1';
      }
      if (!browserWindow._originalPointerEvents) {
        browserWindow._originalPointerEvents = browserWindow.style.pointerEvents || 'auto';
      }
      
      // Add smooth transition for transparency change
      browserWindow.style.transition = 'opacity 0.3s ease-in-out';
      
      // Delay the transparency change slightly to allow drag to initiate properly
      setTimeout(() => {
        // Make window semi-transparent and non-interactive (like PF2e compendium browser)
        browserWindow.style.opacity = '0.125';
        browserWindow.style.pointerEvents = 'none';
      }, 150); // 150ms delay allows drag to start properly
      
    } else {
      // Add smooth transition for restoration
      browserWindow.style.transition = 'opacity 0.4s ease-out';
      
      // Restore original window state
      browserWindow.style.opacity = browserWindow._originalOpacity || '1';
      browserWindow.style.pointerEvents = browserWindow._originalPointerEvents || 'auto';
      
      // Remove transition after restoration to avoid interfering with normal interactions
      setTimeout(() => {
        browserWindow.style.transition = '';
      }, 400);
      
      // Clean up stored values
      delete browserWindow._originalOpacity;
      delete browserWindow._originalPointerEvents;
    }
  }


  /**
   * Hide variants panel immediately (helper method)
   * @private
   */
  _hideVariantsPanel() {
    if (this.parentApp?._hideColorVariantsPanel) {
      this.parentApp._hideColorVariantsPanel();
    }
  }

  /**
   * Setup drag preview using pre-rendered canvas
   * @param {DragEvent} event - The drag event
   * @param {HTMLElement} tokenItem - The token item element
   * @param {string} filename - The filename
   * @param {string} path - The image path
   * @param {number} gridWidth - Grid width in squares
   * @param {number} gridHeight - Grid height in squares
   * @param {number} scale - Scale modifier
   */
  async _setupDragPreview(event, tokenItem, filename, path, gridWidth, gridHeight, scale) {
    // Always calculate at current zoom for accurate preview
    const currentDimensions = calcDragPreviewPixelDims(
      { gridWidth, gridHeight, scale },
      canvas?.scene?.grid?.size || 100,
      canvas?.stage?.scale?.x || 1
    );
    
    // Check if we can reuse existing canvas (same dimensions)
    const preloadedCanvas = tokenItem._preloadedDragCanvas;
    const preloadedDimensions = tokenItem._preloadedDragDimensions;
    
    const canReuseCanvas = preloadedCanvas && preloadedDimensions &&
                         Math.abs(preloadedDimensions.width - currentDimensions.width) < 10 &&
                         Math.abs(preloadedDimensions.height - currentDimensions.height) < 10;
    
    let dragCanvas, dimensions;
    
    if (canReuseCanvas) {
      dragCanvas = preloadedCanvas;
      dimensions = preloadedDimensions;
    } else {
      // FIXED: Don't give up! Regenerate canvas with correct dimensions for current zoom
      try {
        dragCanvas = await this._createDragCanvas(path, currentDimensions.width, currentDimensions.height);
        dimensions = currentDimensions;
        
        // Cache the new canvas for future use
        if (dragCanvas) {
          tokenItem._preloadedDragCanvas = dragCanvas;
          tokenItem._preloadedDragDimensions = dimensions;
        }
      } catch (error) {
        console.error(`fa-token-browser | Failed to regenerate drag canvas for ${filename}:`, error);
        return; // Skip custom drag image, let browser handle it
      }
      
      if (!dragCanvas) {
        return; // Skip custom drag image, let browser handle it
      }
    }
    
    try {
      // Convert canvas to image for drag operation using WebP for better performance
      const dragImg = new Image();
      
      try {
        // Try to export canvas - this will fail if canvas is tainted by CORS
      const webpDataUrl = dragCanvas.toDataURL('image/webp', 0.7);
      const dataUrl = webpDataUrl || dragCanvas.toDataURL('image/webp', 0.7);
      dragImg.src = dataUrl;
      dragImg.alt = `${filename}-drag-${Date.now()}`;
      
      // Always use Foundry's createDragImage approach
      const dragImage = foundry.applications.ux.DragDrop.createDragImage(dragImg, dimensions.width, dimensions.height);
      
      // Set the custom drag image with perfect centering
      const offsetX = dimensions.width / 2;
      const offsetY = dimensions.height / 2;
      event.dataTransfer.setDragImage(dragImage, offsetX, offsetY);
      
      // MEMORY LEAK FIX: Clean up dragImg after use 
      // Use setTimeout to ensure drag operation has started before cleanup
      setTimeout(() => {
        dragImg.src = '';
        dragImg.alt = '';
      }, 10);
        
      } catch (corsError) {
        // Canvas is tainted by CORS - skip custom drag image and let browser handle it
        // Don't call setDragImage - let browser use default behavior
        
        // MEMORY LEAK FIX: Clean up dragImg even on CORS error
        setTimeout(() => {
          dragImg.src = '';
          dragImg.alt = '';
        }, 10);
      }
      
    } catch (error) {
      console.error(`fa-token-browser | Failed to create drag image from canvas for ${filename}:`, error);
      // Let browser handle drag image as fallback
    }
  }
  


  /**
   * Create a canvas sized for the drag preview and draw the source image scaled to fit.
   * For cloud tokens, creates a new image from the local cached file path to avoid CORS taint.
   * For local tokens, looks for already-loaded <img> elements.
   *
   * @param {string} path - Local file path (for cloud tokens) or image path (for local tokens)
   * @param {number} width - Desired canvas width in pixels
   * @param {number} height - Desired canvas height in pixels
   * @returns {Promise<HTMLCanvasElement|null>}
   */
  async _createDragCanvas(path, width, height) {
    return new Promise((resolve) => {
      // For local Foundry data paths, look for existing loaded images
      if (path.startsWith('worlds/') || path.startsWith('modules/') || path.startsWith('systems/')) {
    const basename = path.split('/').pop();
        const existingImg = Array.from(document.querySelectorAll('img')).find((img) => 
          img.src.includes(basename) && img.complete
        );

        if (existingImg) {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(existingImg, 0, 0, width, height);
            resolve(canvas);
            return;
          } catch (err) {
            console.error(`fa-token-browser | Failed to create canvas from DOM image:`, err);
    }
        }
      }

      // For cached cloud tokens or when DOM lookup fails, create fresh image
      const freshImg = new Image();
      // Set crossOrigin for cloud tokens and external URLs to prevent canvas tainting
      // Also set it when running on Forge as local tokens may be served cross-origin
      if (path && (path.includes('://') || path.includes('forge-vtt.com') || path.includes('cdn.') || isRunningOnForge())) {
        freshImg.crossOrigin = "anonymous";
      }
      
      freshImg.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(freshImg, 0, 0, width, height);
          
          // MEMORY LEAK FIX: Clear handlers after use
          freshImg.onload = null;
          freshImg.onerror = null;
          freshImg.src = '';
          
          resolve(canvas);
    } catch (err) {
          console.error(`fa-token-browser | Failed to create canvas from fresh image:`, err);
          
          // MEMORY LEAK FIX: Clear handlers after error
          freshImg.onload = null;
          freshImg.onerror = null;
          freshImg.src = '';
          
          resolve(null);
        }
      };

      freshImg.onerror = () => {
        console.error(`fa-token-browser | Failed to load image for drag canvas: ${path}`);
        
        // MEMORY LEAK FIX: Clear handlers after error
        freshImg.onload = null;
        freshImg.onerror = null;
        freshImg.src = '';
        
        resolve(null);
      };

      // Load the image from the local file path
      freshImg.src = path;
    });
  }

  // ================================================================================
  // STATIC CANVAS DROP HANDLING METHODS
  // ================================================================================

  /**
   * Handle drop events on the canvas from the Token Browser
   * @param {Canvas} canvas - The Foundry VTT canvas
   * @param {Object} data - Drop data from the drag operation
   * @param {DragEvent} event - The drop event
   * @returns {boolean} True if handled, false to allow other handlers
   */
  static async handleCanvasDrop(canvas, data, event) {
    // Handle different data formats that might come through Foundry's system
    let dropData = data;
    
    // If we got coordinate data only, try to extract our data from DataTransfer
    if (data && typeof data === 'object' && 'x' in data && 'y' in data && !data.type) {
      // Try to get data from the HTML5 DataTransfer API
      if (event && event.dataTransfer) {
        try {
          const transferData = event.dataTransfer.getData('text/plain');
          if (transferData) {
            dropData = JSON.parse(transferData);
          }
        } catch (error) {
          // Continue with original data
        }
      }
    }
    
    // If data is a string, try to parse it
    if (typeof dropData === 'string') {
      try {
        dropData = JSON.parse(dropData);
      } catch (error) {
        return false;
      }
    }
    
    // Check if this is a drop from our Token Browser
    const isOurDrop = dropData && dropData.source === 'token-browser' && 
      dropData.type === 'fa-token-browser-token';
    
    if (!isOurDrop) {
      return false; // Not our drop, let other handlers process
    }
    
    try {
      // Validate required data
      if (!dropData.filename || !dropData.url) {
        throw new Error('Invalid drag data: missing filename or URL');
      }
      
      // Transform coordinates from screen to world space
      const dropCoordinates = TokenDragDropManager.transformCoordinates(event, canvas, dropData.tokenSize);
      
      // Validate drop is within canvas bounds
      if (!TokenDragDropManager.isValidDropLocation(dropCoordinates.world, canvas)) {
        ui.notifications.warn('Cannot drop token outside the scene boundaries');
        return true; // We handled it (even if rejecting)
      }
      
      // Import ActorFactory dynamically to avoid circular imports
      const { ActorFactory } = await import('./actor-factory.js');
      
      // Create actor and token using our factory
      const result = await ActorFactory.createActorFromDragData(dropData, dropCoordinates);
      
      // Token created successfully (no notification needed)
      
      return true; // We handled this drop successfully
      
    } catch (error) {
      console.error('fa-token-browser | Canvas Drop: Error processing drop:', error);
      ui.notifications.error(`Failed to create token: ${error.message}`);
      return true; // We handled it (even if it failed)
    }
  }

  /**
   * Transform screen coordinates to world coordinates for token placement
   * @param {DragEvent} event - The drop event containing screen coordinates
   * @param {Canvas} canvas - The Foundry VTT canvas
   * @param {Object} tokenSize - Token size info {gridWidth, gridHeight, scale}
   * @returns {Object} Coordinates object with screen and world properties
   */
  static transformCoordinates(event, canvas, tokenSize = { gridWidth: 1, gridHeight: 1, scale: 1 }) {
    // Get screen coordinates from the drop event
    const screenX = event.clientX;
    const screenY = event.clientY;
    
    // Transform to world coordinates using Foundry's coordinate system
    // Use Foundry (latest version)'s coordinate transformation directly
    const worldCoords = canvas.canvasCoordinatesFromClient({ x: screenX, y: screenY });
    
    // Apply grid snapping if enabled, considering token size
    const snappedCoords = TokenDragDropManager.applyGridSnapping(worldCoords, canvas, tokenSize);
    
    return {
      screen: { x: screenX, y: screenY },
      world: snappedCoords
    };
  }

  /**
   * Apply grid snapping to world coordinates based on token size
   * @param {Object} worldCoords - World coordinates {x, y}
   * @param {Canvas} canvas - The Foundry VTT canvas
   * @param {Object} tokenSize - Token size info {gridWidth, gridHeight, scale}
   * @returns {Object} Snapped coordinates {x, y}
   */
  static applyGridSnapping(worldCoords, canvas, tokenSize = { gridWidth: 1, gridHeight: 1, scale: 1 }) {
    // Check if grid snapping is enabled and we have a grid
    if (!canvas.grid || !canvas.scene) {
      return worldCoords;
    }
    
    try {
      const gridSize = canvas.scene.grid.size;
      const { gridWidth, gridHeight } = tokenSize;
      
      let snapX, snapY;
      
      if (gridWidth % 2 === 0) {
        // Even-sized tokens (2x2, 4x4) snap to grid intersections
        // Use Math.round to snap to nearest intersection
        snapX = Math.round(worldCoords.x / gridSize) * gridSize;
        snapY = Math.round(worldCoords.y / gridSize) * gridSize;
      } else {
        // Odd-sized tokens (1x1, 3x3) snap to grid centers
        // Use Math.floor to stay in current grid square, then add center offset
        snapX = Math.floor(worldCoords.x / gridSize) * gridSize + (gridSize / 2);
        snapY = Math.floor(worldCoords.y / gridSize) * gridSize + (gridSize / 2);
      }
      
      const snapped = { x: snapX, y: snapY };
      
      return snapped;
    } catch (error) {
      console.warn('fa-token-browser | Grid Snapping: Error applying grid snap, using raw coordinates:', error);
      return worldCoords;
    }
  }

  /**
   * Validate that the drop location is within valid canvas bounds
   * @param {Object} worldCoords - World coordinates {x, y}
   * @param {Canvas} canvas - The Foundry VTT canvas
   * @returns {boolean} True if location is valid for token placement
   */
  static isValidDropLocation(worldCoords, canvas) {
    if (!canvas.scene) {
      console.warn('fa-token-browser | Drop Validation: No active scene');
      return false;
    }
    
    const scene = canvas.scene;
    const { x, y } = worldCoords;
    
    // Get the actual grid size from the scene
    const gridSize = scene.grid?.size || canvas.grid?.size || 100;
    
    // Use actual canvas dimensions instead of scene dimensions
    // Foundry adds padding around scenes, so canvas is larger than scene.width/height
    const canvasBounds = {
      width: canvas.dimensions?.width || scene.width * 2, // Fallback to generous bounds
      height: canvas.dimensions?.height || scene.height * 2
    };
    
    // Be more lenient with boundaries - tokens can be placed in the buffer areas
    const margin = gridSize;
    
    const isWithinBounds = x >= -margin && y >= -margin && 
                          x <= canvasBounds.width + margin && y <= canvasBounds.height + margin;
    
    return isWithinBounds;
  }

  /**
   * Setup canvas as a proper drop zone for token browser drops
   */
  static setupCanvasDropZone() {
    // Foundry will handle the drop detection through the dropCanvasData hook
    // We just need to make sure the canvas is ready to receive drops
    if (canvas && canvas.stage) {
      // Enable drops on the canvas - this tells Foundry to process drop events
      const canvasElement = canvas.app.view;
      if (canvasElement) {
        canvasElement.addEventListener('dragover', (event) => {
          // Allow drops by preventing default
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        });
      }
    }
  }


  /**
   * Handle drop onto actor in the actors sidebar
   * @param {HTMLElement} actorElement - The actor element that was dropped onto
   * @param {Object} data - The drag data
   * @param {DragEvent} event - The drop event
   * @returns {boolean} True if handled, false if not our drop
   */
  static async handleActorDrop(actorElement, data, event) {
    // Handle different data formats that might come through 
    let dropData = data;
    
    // If we got a DragEvent, try to extract our data from DataTransfer
    if (event && event.dataTransfer) {
      try {
        const transferData = event.dataTransfer.getData('text/plain');
        if (transferData) {
          dropData = JSON.parse(transferData);
        }
      } catch (error) {
        // Continue with original data
      }
    }
    
    // If data is a string, try to parse it
    if (typeof dropData === 'string') {
      try {
        dropData = JSON.parse(dropData);
      } catch (error) {
        return false;
      }
    }
    
    // Check if this is a drop from our Token Browser
    const isOurDrop = dropData && dropData.source === 'token-browser' && 
      dropData.type === 'fa-token-browser-token';
    
    if (!isOurDrop) {
      return false; // Not our drop, let other handlers process
    }
    
    try {
      // Validate required data
      if (!dropData.filename || !dropData.url) {
        throw new Error('Invalid drag data: missing filename or URL');
      }
      
      // Extract actor ID from the element
      const actorId = actorElement.getAttribute('data-entry-id') || 
                     actorElement.getAttribute('data-document-id') ||
                     actorElement.getAttribute('data-actor-id');
      
      if (!actorId) {
        throw new Error('Could not determine actor ID from drop target');
      }
      
      // Get the actor document
      const actor = game.actors.get(actorId);
      if (!actor) {
        throw new Error(`Actor with ID ${actorId} not found`);
      }
      
      // Check permissions
      if (!actor.canUserModify(game.user, 'update')) {
        throw new Error(`You do not have permission to modify actor "${actor.name}"`);
      }
      
      // Check if Shift key is held - if so, bypass confirmation dialog
      if (event && event.shiftKey) {
        // Auto-accept with default settings
        dropData._updateActorImage = true;
        dropData._useWildcard = false; // Disabled for now, will be reimplemented later
        
        await TokenDragDropManager._updateActorPrototypeToken(actor, dropData);
        ui.notifications.info(`Updated prototype token for "${actor.name}" (Shift+Drop)`);
      } else {
        // Show confirmation dialog and handle the prototype update
        const confirmed = await TokenDragDropManager._showActorUpdateConfirmation(actor, dropData, event);
        if (confirmed) {
          await TokenDragDropManager._updateActorPrototypeToken(actor, dropData);
          ui.notifications.info(`Updated prototype token for "${actor.name}"`);
        }
      }
      
      return true; // We handled this drop successfully
      
    } catch (error) {
      console.error('fa-token-browser | Actor Drop: Error processing drop:', error);
      ui.notifications.error(`Failed to update actor token: ${error.message}`);
      return true; // We handled it (even if it failed)
    }
  }

  /**
   * Show confirmation dialog for actor token update using ApplicationV2
   * @param {Actor} actor - The actor to update
   * @param {Object} dropData - The token drop data
   * @param {Event} event - The drop event containing cursor coordinates
   * @returns {Promise<boolean>} True if confirmed, false if cancelled
   * @private
   */
  static async _showActorUpdateConfirmation(actor, dropData, event) {
    return new Promise((resolve) => {
      
      // Create ApplicationV2-based confirmation dialog
      const { HandlebarsApplicationMixin } = foundry.applications.api;
      class ActorTokenUpdateDialog extends HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
        constructor(actor, dropData, resolveCallback, cursorX, cursorY) {
          // Calculate position relative to cursor (400px left, 300px up)
          const dialogLeft = Math.max(cursorX - 430, 20); // 400px left of cursor, min 20px from left edge
          const dialogTop = Math.max(cursorY - 200, 20); // 300px up from cursor, min 20px from top edge
          
          super({
            id: 'actor-token-update-dialog',
            window: {
              title: `Update Token for ${actor.name}`,
              frame: true,
              positioned: true,
              resizable: false
            },
            position: {
              width: 400,
              height: 'auto',
              left: dialogLeft,
              top: dialogTop
            }
          });
          this.actor = actor;
          this.dropData = dropData;
          this.resolveCallback = resolveCallback;
        }
        
        static DEFAULT_OPTIONS = {
          tag: 'div',
          window: {
            frame: true,
            positioned: true,
            resizable: false
          }
        };
        
        static PARTS = {
          form: {
            template: 'modules/fa-token-browser/templates/token-update-confirm.hbs'
          }
        };
        
        async _prepareContext() {
          // Import the display name parser and search utilities
          const { parseTokenDisplayName } = await import('./token-data-service.js');
          const { detectColorVariant } = await import('./search-engine.js');
          const { displayName } = parseTokenDisplayName(this.dropData.filename);
          
          // Check if user can use wildcard tokens
          const authData = game.settings.get('fa-token-browser', 'patreon_auth_data');
          const isAuthenticated = authData && authData.authenticated;
          
          // Determine token type based on data structure
          let isLocalToken = false;
          let isCloudToken = false;
          
          if (this.dropData.tokenData) {
            // New structure: check tokenData.source
            isLocalToken = this.dropData.tokenData.source === 'local';
            isCloudToken = this.dropData.tokenData.source === 'cloud';
          } else {
            // Fallback: check dropData.tokenSource (older structure)
            isLocalToken = this.dropData.tokenSource === 'local';
            isCloudToken = this.dropData.tokenSource === 'cloud';
          }
          
          // Check if this token has color variants
          const variantInfo = detectColorVariant(this.dropData.filename);
          const hasColorVariants = variantInfo.hasColorVariant;
          
          // Wildcard is available if:
          // - Local tokens with color variants (any user), OR
          // - Cloud tokens with color variants (authenticated users only)
          const canUseWildcard = hasColorVariants && (isLocalToken || (isCloudToken && isAuthenticated));

          return {
            actor: this.actor,
            dropData: this.dropData,
            currentTokenSrc: this.actor.img,
            newTokenSrc: this.dropData.thumbnailUrl || this.dropData.url,
            filename: this.dropData.filename,
            displayName: displayName,
            tokenSource: this.dropData.tokenSource,
            isCloudToken: isCloudToken,
            tier: this.dropData.tier,
            tokenSize: this.dropData.tokenSize,
            hasScale: this.dropData.tokenSize && this.dropData.tokenSize.scale !== 1,
            updateActorImageDefault: true,
            canUseWildcard: canUseWildcard
          };
        }
        
        _onRender(context, options) {
          super._onRender(context, options);
          
          // Add event listeners using event delegation
          this.element.addEventListener('click', (event) => {
            const action = event.target.closest('[data-action]')?.getAttribute('data-action');
            
            if (action === 'confirm') {
              const updateActorImage = this.element.querySelector('#update-actor-image')?.checked || false;
              const useWildcard = this.element.querySelector('#use-wildcard-token')?.checked || false;
              this.dropData._updateActorImage = updateActorImage;
              this.dropData._useWildcard = useWildcard;
              this.resolveCallback(true);
              this.close();
            } else if (action === 'cancel') {
              this.resolveCallback(false);
              this.close();
            }
          });
          
          // Handle escape key
          const escapeHandler = (event) => {
            if (event.key === 'Escape') {
              this.resolveCallback(false);
              this.close();
            }
          };
          document.addEventListener('keydown', escapeHandler);
          
          // Clean up event listener when dialog closes
          this.addEventListener('close', () => {
            document.removeEventListener('keydown', escapeHandler);
          });
        }
        
        _onClose() {
          // Ensure we resolve if dialog is closed without button click
          if (this.resolveCallback) {
            this.resolveCallback(false);
            this.resolveCallback = null;
          }
          super._onClose();
        }
      }
      
      // Get cursor coordinates from the event
      const cursorX = event?.clientX || window.innerWidth / 2;
      const cursorY = event?.clientY || window.innerHeight / 2;
      
      // Create and render the dialog
      const dialog = new ActorTokenUpdateDialog(actor, dropData, resolve, cursorX, cursorY);
      dialog.render(true);
    });
  }

  /**
   * Update an actor's prototype token with new token data
   * @param {Actor} actor - The actor to update
   * @param {Object} dropData - The token drop data
   * @private
   */
  static async _updateActorPrototypeToken(actor, dropData) {
    // Import required modules
    const { ActorFactory } = await import('./actor-factory.js');
    const { parseTokenSize } = await import('./geometry.js');
    const SystemDetection = await import('./system-detection.js');
    
    // Parse token size from filename
    const tokenSize = parseTokenSize(dropData.filename);
    
    // Get system info for system-specific handling
    const systemInfo = SystemDetection.getSystemInfo();
    
    // Determine the token URL to use
    let tokenUrl = dropData.url;
    
    // Handle wildcard tokens if enabled
    if (dropData._useWildcard) {
      console.log('fa-token-browser | Applying wildcard token mode');
      
      // Download all color variants first
      await TokenDragDropManager._downloadAllColorVariants(dropData);
      
      // Import and convert URL to wildcard format
      const { detectColorVariant } = await import('./search-engine.js');
      tokenUrl = TokenDragDropManager._convertToWildcardPath(dropData.url, detectColorVariant);
      console.log(`fa-token-browser | Converted to wildcard URL: ${tokenUrl}`);
    }
    
    // Start with base prototype token update data
    const prototypeTokenUpdate = {
      texture: {
        src: tokenUrl,
        scaleX: tokenSize.scale,
        scaleY: tokenSize.scale
      },
      width: tokenSize.gridWidth,
      height: tokenSize.gridHeight,
      lockRotation: false, // Uncheck "Lock Artwork Rotation" since our tokens are top-down style
      randomImg: dropData._useWildcard || false // Enable "Randomize Wildcard Images" when using wildcards
    };
    
    // Apply system-specific sizing logic
    if (systemInfo.id === 'pf2e') {
      // For PF2e, we need to handle the relationship between actor size and token scale
      const sizeCategory = ActorFactory._getCreatureSizeFromGridDimensions(tokenSize.gridWidth, tokenSize.gridHeight);
      
      // Set flags to preserve our custom scale and prevent PF2e from overriding it
      prototypeTokenUpdate.flags = prototypeTokenUpdate.flags || {};
      prototypeTokenUpdate.flags['fa-token-browser'] = {
        customScale: true,
        originalScale: tokenSize.scale
      };
      prototypeTokenUpdate.flags.pf2e = prototypeTokenUpdate.flags.pf2e || {};
      prototypeTokenUpdate.flags.pf2e.linkToActorSize = false;
      
      // Update actor's size trait to match token dimensions
      await actor.update({
        'system.traits.size': { value: sizeCategory }
      });
      
      console.log(`fa-token-browser | PF2e Actor Update: Set size to "${sizeCategory}" (${tokenSize.gridWidth}x${tokenSize.gridHeight}) with ${tokenSize.scale}x scale for ${actor.name}`);
      
    } else if (systemInfo.id === 'pf1') {
      // For PF1, similar logic but different data structure
      const sizeCategory = ActorFactory._getCreatureSizeFromGridDimensions(tokenSize.gridWidth, tokenSize.gridHeight);
      
      // Set flags to preserve our custom scale and prevent PF1 from overriding it
      prototypeTokenUpdate.flags = prototypeTokenUpdate.flags || {};
      prototypeTokenUpdate.flags['fa-token-browser'] = {
        customScale: true,
        originalScale: tokenSize.scale
      };
      prototypeTokenUpdate.flags.pf1 = prototypeTokenUpdate.flags.pf1 || {};
      prototypeTokenUpdate.flags.pf1.linkToActorSize = false;
      
      // Update actor's size trait to match token dimensions (PF1 uses string directly)
      await actor.update({
        'system.traits.size': sizeCategory
      });
      
      console.log(`fa-token-browser | PF1 Actor Update: Set size to "${sizeCategory}" (${tokenSize.gridWidth}x${tokenSize.gridHeight}) with ${tokenSize.scale}x scale for ${actor.name}`);
      
    } else if (systemInfo.id === 'dnd5e') {
      // For D&D 5e, handle creature size relationship
      const sizeCategory = ActorFactory._getCreatureSizeFromGridDimensions(tokenSize.gridWidth, tokenSize.gridHeight);
      
      // Update actor's size trait to match token dimensions
      await actor.update({
        'system.traits.size': sizeCategory
      });
      
      console.log(`fa-token-browser | D&D 5e Actor Update: Set size to "${sizeCategory}" (${tokenSize.gridWidth}x${tokenSize.gridHeight}) for ${actor.name}`);
    }
    
    // Prepare actor update data (conditionally update actor image)
    const actorUpdateData = {
      prototypeToken: prototypeTokenUpdate
    };
    
    // Update actor portrait if requested
    if (dropData._updateActorImage) {
      actorUpdateData.img = dropData.url;
    }
    
    // Update the actor with the prototype token changes
    await actor.update(actorUpdateData);
  }

  /**
   * Setup actors sidebar as a drop zone for token browser drops
   */
  static setupActorDropZone() {
    // Setup drop detection on the actors sidebar
    const setupActorDropListeners = () => {
      // Try multiple possible selectors for the actors panel
      const possibleSelectors = [
        '.actors-sidebar',
        '#actors',
        '#sidebar #actors',
        '.app.sidebar-tab[data-tab="actors"]',
        '.directory[data-tab="actors"]',
        '#sidebar-tabs + .scrollable .directory',
        '.actors.directory'
      ];
      
      let targetElement = null;
      
      for (const selector of possibleSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          targetElement = element;
          break;
        }
      }
      
      if (!targetElement) {
        return;
      }
      
      // Remove existing listeners to avoid duplicates
      const existingListeners = targetElement._faTokenBrowserListeners;
      if (existingListeners) {
        targetElement.removeEventListener('dragover', existingListeners.dragover);
        targetElement.removeEventListener('dragleave', existingListeners.dragleave);
        targetElement.removeEventListener('drop', existingListeners.drop);
      }
      
      // Create listener functions
      const dragoverHandler = (event) => {
        // Simple check - only respond if we have an active token browser drag
        if (!TokenDragDropManager._isTokenBrowserDragActive) {
          return;
        }
        
        // Find the actor element we're hovering over
        const actorElement = event.target.closest('.directory-item, .document, [data-entry-id]');
        
        if (actorElement) {
          const actorId = actorElement.getAttribute('data-entry-id') || 
                         actorElement.getAttribute('data-document-id') ||
                         actorElement.getAttribute('data-actor-id');
          
          if (actorId) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            
            // Only add visual feedback if not already present (reduce flickering)
            if (!actorElement.classList.contains('actor-drop-target')) {
              actorElement.classList.add('actor-drop-target');
            }
            
            // Mark this element as the current drop target
            if (targetElement._currentDropTarget !== actorElement) {
              // Remove previous drop target styling
              if (targetElement._currentDropTarget) {
                targetElement._currentDropTarget.classList.remove('actor-drop-target');
              }
              targetElement._currentDropTarget = actorElement;
              actorElement.classList.add('actor-drop-target');
            }
          } else {
            // Element exists but has no actor ID (like a folder) - clear highlights
            if (targetElement._currentDropTarget) {
              targetElement._currentDropTarget.classList.remove('actor-drop-target');
              targetElement._currentDropTarget = null;
            }
          }
        } else {
          // No actor element found (hovering over non-actor elements like folders) - clear highlights
          if (targetElement._currentDropTarget) {
            targetElement._currentDropTarget.classList.remove('actor-drop-target');
            targetElement._currentDropTarget = null;
          }
        }
      };
      
      const dragleaveHandler = (event) => {
        // Only respond if we have an active token browser drag
        if (!TokenDragDropManager._isTokenBrowserDragActive) {
          return;
        }
        
        // Check if we're leaving the entire actors panel
        if (event.target === targetElement && event.relatedTarget && 
            !targetElement.contains(event.relatedTarget)) {
          // Leaving the entire actors panel - remove all highlights
          targetElement.querySelectorAll('.actor-drop-target').forEach(el => {
            el.classList.remove('actor-drop-target');
          });
          targetElement._currentDropTarget = null;
          return;
        }
        
        // Only remove highlighting if we're leaving the entire actor element
        // Check if we're moving to a child element (relatedTarget)
        const actorElement = event.target.closest('.directory-item, .document, [data-entry-id]');
        if (actorElement && event.relatedTarget) {
          const relatedActor = event.relatedTarget.closest('.directory-item, .document, [data-entry-id]');
          // If we're still within the same actor element, don't remove highlighting
          if (relatedActor === actorElement) {
            return;
          }
        }
        
        // Remove visual feedback
        if (actorElement) {
          actorElement.classList.remove('actor-drop-target');
          if (targetElement._currentDropTarget === actorElement) {
            targetElement._currentDropTarget = null;
          }
        }
      };
      
      const dropHandler = async (event) => {
        // Remove all visual feedback
        targetElement.querySelectorAll('.actor-drop-target').forEach(el => {
          el.classList.remove('actor-drop-target');
        });
        targetElement._currentDropTarget = null;
        
        // Find the actor element we dropped onto
        const actorElement = event.target.closest('.directory-item, .document, [data-entry-id]');
        
        if (actorElement) {
          const actorId = actorElement.getAttribute('data-entry-id') || 
                         actorElement.getAttribute('data-document-id') ||
                         actorElement.getAttribute('data-actor-id');
          
          if (actorId) {
            event.preventDefault();
            event.stopPropagation();
            
            // Extract drag data
            let dragData = null;
            try {
              const transferData = event.dataTransfer.getData('text/plain');
              dragData = JSON.parse(transferData);
            } catch (error) {
              return;
            }
            
            // Verify this is our drag data
            if (dragData && dragData.source === 'token-browser' && dragData.type === 'fa-token-browser-token') {
              // Handle the actor drop
              await TokenDragDropManager.handleActorDrop(actorElement, dragData, event);
            }
          }
        }
      };
      
      // Add event listeners with delegation
      targetElement.addEventListener('dragover', dragoverHandler);
      targetElement.addEventListener('dragleave', dragleaveHandler);
      targetElement.addEventListener('drop', dropHandler);
      
      // Store references for cleanup
      targetElement._faTokenBrowserListeners = {
        dragover: dragoverHandler,
        dragleave: dragleaveHandler,
        drop: dropHandler
      };
    };
    
    // Setup immediately if actors sidebar is already rendered
    if (document.querySelector('.actors-sidebar, #actors, .directory')) {
      setupActorDropListeners();
    }
    
    // Also setup when actors sidebar renders
    Hooks.on('renderActorDirectory', () => {
      setTimeout(setupActorDropListeners, 100); // Small delay to ensure DOM is ready
    });
    
    // Also try when sidebar tab changes
    Hooks.on('renderSidebar', () => {
      setTimeout(setupActorDropListeners, 100);
    });
  }

  /**
   * Setup Intersection Observer for aggressive off-screen cleanup
   * @private
   */
  _setupIntersectionObserver() {
    if (!('IntersectionObserver' in window)) {
      return; // Fallback for older browsers
    }

    this._intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const tokenItem = entry.target;
        
        if (!entry.isIntersecting) {
          // Token is off-screen - clean up preloaded canvas after short delay
          if (tokenItem._offScreenTimeout) {
            clearTimeout(tokenItem._offScreenTimeout);
          }
          
          tokenItem._offScreenTimeout = setTimeout(() => {
            if (tokenItem._preloadedDragCanvas && 
                tokenItem._preloadedDragCanvas !== 'loading' &&
                !tokenItem._previewActive) {
              this.cleanupTokenPreload(tokenItem);
            }
          }, 2000); // Clean up after 2 seconds off-screen
        } else {
          // Token is on-screen - cancel cleanup
          if (tokenItem._offScreenTimeout) {
            clearTimeout(tokenItem._offScreenTimeout);
            tokenItem._offScreenTimeout = null;
          }
        }
      });
    }, {
      root: null, // Use viewport as root
      rootMargin: '50px', // Start cleanup when 50px off-screen
      threshold: 0 // Trigger when any part leaves viewport
    });
  }

  /**
   * Register existing tokens with intersection observer
   * @param {HTMLElement} gridElement - The grid element
   * @private
   */
  _registerTokensWithObserver(gridElement) {
    if (!this._intersectionObserver || !gridElement) return;
    
    const tokenItems = gridElement.querySelectorAll('.token-item');
    tokenItems.forEach(tokenItem => {
      this._intersectionObserver.observe(tokenItem);
    });
  }

  /**
   * Register a single token with intersection observer (for new tokens)
   * @param {HTMLElement} tokenItem - The token item element
   */
  registerTokenWithObserver(tokenItem) {
    if (this._intersectionObserver && tokenItem) {
      this._intersectionObserver.observe(tokenItem);
    }
  }

  /**
   * Convert a token path to wildcard format by replacing variant number with '*'
   * @param {string} tokenPath - The original token path
   * @param {Function} detectColorVariant - The color variant detection function
   * @returns {string} The wildcard token path
   * @private
   */
  static _convertToWildcardPath(tokenPath, detectColorVariant) {
    
    // Get filename from path
    const pathParts = tokenPath.split('/');
    const filename = pathParts[pathParts.length - 1];
    
    // Detect color variant
    const variantInfo = detectColorVariant(filename);
    
    if (!variantInfo.hasColorVariant) {
      // No color variant detected, return original path
      return tokenPath;
    }
    
    // Replace the variant number with '*'
    const fileExtension = filename.split('.').pop();
    let wildcardFilename = `${variantInfo.baseNameWithoutVariant}_*.${fileExtension}`;
    
    // Escape special characters that might cause issues with wildcards
    // Common problematic characters: ! [ ] ? ^ at the beginning of patterns
    wildcardFilename = TokenDragDropManager._escapeWildcardSpecialChars(wildcardFilename);
    
    // Reconstruct the full path
    pathParts[pathParts.length - 1] = wildcardFilename;
    return pathParts.join('/');
  }

  /**
   * Fix special characters in wildcard filenames to prevent issues
   * @param {string} filename - The filename to fix
   * @returns {string} Fixed filename
   * @private
   */
  static _escapeWildcardSpecialChars(filename) {
    // Replace problematic characters with safe alternatives
    return filename
      .replace(/!/g, '?')       // Replace ! with ? (safe wildcard character)
      .replace(/\[/g, '?')      // Replace [ with ? (avoid character class syntax)
      .replace(/\]/g, '?')      // Replace ] with ? (avoid character class syntax)
      .replace(/\^/g, '?');     // Replace ^ with ? (avoid anchor syntax)
  }



  /**
   * Download all color variants of a token when using wildcard mode
   * @param {Object} dropData - The token drop data
   * @private
   */
  static async _downloadAllColorVariants(dropData) {
    try {
      // Only download for cloud tokens - check both data structures
      let isCloudToken = false;
      
      if (dropData.tokenData) {
        // New structure: check tokenData.source (covers cached cloud tokens)
        isCloudToken = dropData.tokenData.source === 'cloud';
      } else {
        // Fallback: check dropData.tokenSource (uncached cloud tokens)
        isCloudToken = dropData.tokenSource === 'cloud';
      }
      
      if (!isCloudToken) {
        console.log('fa-token-browser | Skipping variant download for non-cloud token');
        return;
      }
      
      console.log('fa-token-browser | Starting variant download for cloud token:', dropData.filename);

      // Import necessary functions
      const { detectColorVariant, getColorVariants } = await import('./search-engine.js');
      
      // Get variant info
      const variantInfo = detectColorVariant(dropData.filename);
      if (!variantInfo.hasColorVariant) {
        console.log('fa-token-browser | No color variants detected for token');
        return;
      }

      // Get tokens from parent app (already loaded)
      // Try multiple ways to find the token browser app instance
      let parentApp = window.tokenBrowserApp;
      
      // Fallback: Check Foundry's application instances
      if (!parentApp) {
        // Try to get by known ID first
        parentApp = foundry.applications.instances.get('token-browser-app');
      }
      
      // Fallback: Check for any fa-token-browser app by iterating values
      if (!parentApp) {
        for (const app of foundry.applications.instances.values()) {
          if (app.constructor.name === 'TokenBrowserApp' || 
              app.element?.classList?.contains('token-browser-app')) {
            parentApp = app;
            break;
          }
        }
      }
      
      if (!parentApp || !parentApp._allImages) {
        console.log('fa-token-browser | No parent app or token data available for variant download');
        console.log('fa-token-browser | parentApp:', parentApp);
        console.log('fa-token-browser | Available instances:', Array.from(foundry.applications.instances.values()).map(app => app.constructor.name));
        return;
      }
      
      console.log(`fa-token-browser | Found parent app with ${parentApp._allImages.length} tokens`);
      
      // Convert UI tokens to TokenData format
      const allTokens = parentApp._allImages.map(uiToken => 
        parentApp.tokenDataService.getTokenDataFromUIObject(uiToken)
      ).filter(Boolean);
      
      // Filter to cloud tokens only
      const cloudTokens = allTokens.filter(token => token.source === 'cloud');
      
      // Find all color variants
      const variants = getColorVariants(variantInfo.baseNameWithoutVariant, cloudTokens);
      
      console.log(`fa-token-browser | Found ${variants.length} color variants for wildcard download`);
      
      // Show download start notification
      ui.notifications.info(`Downloading ${variants.length} color variants for wildcard token...`);
      
      // Download each variant using existing infrastructure
      const downloadPromises = variants.map(async (variant) => {
        try {
          // Use existing download infrastructure to get file path (downloads and caches)
          const cachedPath = await parentApp.tokenDataService.getFilePathForDragDrop(variant.imageData);
          console.log(`fa-token-browser | Downloaded variant: ${variant.filename}`);
          return cachedPath;
        } catch (error) {
          console.error(`fa-token-browser | Failed to download variant ${variant.filename}:`, error);
          return null;
        }
      });
      
      // Wait for all downloads to complete
      const results = await Promise.allSettled(downloadPromises);
      const successCount = results.filter(result => result.status === 'fulfilled' && result.value).length;
      
      console.log(`fa-token-browser | Downloaded ${successCount}/${variants.length} color variants for wildcard`);
      
      // Update cache indicators in the UI for all successfully downloaded variants
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          const variant = variants[index];
          if (variant && variant.imageData) {
            // Update the UI token object to reflect cache status
            const uiToken = parentApp._allImages?.find(token => token.filename === variant.filename);
            if (uiToken) {
              uiToken.isCached = true;
            }
            
            // Use a longer timeout to ensure the cache has been fully updated
            setTimeout(() => {
              parentApp.updateTokenStatusIcon(variant.filename, 'cached');
            }, 500);
          }
        }
      });
      
      // Show completion notification
      if (successCount === variants.length) {
        ui.notifications.info(`✅ Downloaded all ${successCount} color variants for wildcard token`);
      } else {
        ui.notifications.warn(`⚠️ Downloaded ${successCount}/${variants.length} color variants (${variants.length - successCount} failed)`);
      }
      
    } catch (error) {
      console.error('fa-token-browser | Error downloading color variants:', error);
    }
  }

  
} 