/**
 * Lazy Loading Management System for FA Token Browser
 * Handles scroll-based loading, image batching, skeleton animations, and layout calculations
 */

export class LazyLoadingManager {
  constructor(app) {
    this.app = app; // Reference to the main application
    
    // Lazy loading state
    this._loadBatchSize = 40;
    this._isLoading = false;
    this._lastScrollTime = 0;
    
    // MEMORY LEAK FIX: Track created elements for cleanup
    this._trackedElements = new Set();
  }

  /**
   * Get the current loading state
   * @returns {boolean}
   */
  get isLoading() {
    return this._isLoading;
  }

  /**
   * Get the batch size for loading
   * @returns {number}
   */
  get loadBatchSize() {
    return this._loadBatchSize;
  }

  /**
   * Setup simple scroll-based lazy loading
   */
  setupScrollLazyLoading() {
    const grid = this.app.element.querySelector('.token-grid');
    if (!grid) return;

    // Simple scroll handler that checks if near bottom
    const scrollHandler = () => {
      const now = Date.now();
      if (now - this._lastScrollTime < 100) return; // Throttle
      this._lastScrollTime = now;
      
      // Check if near bottom (within 500px) - increased threshold to prevent scrolling past loading
      const threshold = 500;
      const isNearBottom = grid.scrollTop + grid.clientHeight >= grid.scrollHeight - threshold;
      
      if (isNearBottom && !this._isLoading) {
        this.loadMoreImages();
      }
    };
    
    this.app.eventManager.registerScrollHandler(grid, scrollHandler);
  }

  /**
   * Load more images when scrolling near bottom
   */
  async loadMoreImages() {
    if (this._isLoading || !this.app.searchManager.canLoadMore()) {
      return;
    }
    
    this._isLoading = true;
    
    try {
      // Get next batch from search manager
      const nextBatch = this.app.searchManager.getNextBatch(this._loadBatchSize);
      
      if (nextBatch.length === 0) {
        this._isLoading = false;
        return;
      }
      
      const grid = this.app.element.querySelector('.token-grid');
      
      // Calculate approximate height needed for new items
      const itemHeight = this.getApproximateItemHeight();
      const itemsPerRow = this.getItemsPerRow();
      const newRows = Math.ceil(nextBatch.length / itemsPerRow);
      const neededHeight = newRows * itemHeight;
      
      // Create spacer to pre-extend the container
      const spacer = document.createElement('div');
      spacer.className = 'loading-spacer';
      spacer.style.height = `${neededHeight}px`;
      spacer.style.width = '100%';
      spacer.style.visibility = 'hidden';
      grid.appendChild(spacer);
      
      // Add to displayed images
      this.app._displayedImages.push(...nextBatch);
      
      // Create new items with skeletons
      const newItems = this.createImageElements(nextBatch);
      
      // Add items directly to DOM and register with intersection observer
      newItems.forEach(item => {
        grid.appendChild(item);
        // Register with intersection observer for off-screen cleanup
        if (this.app.dragDropManager) {
          this.app.dragDropManager.registerTokenWithObserver(item);
        }
      });
      
      // Remove spacer immediately - skeletons will handle the visual loading
      grid.removeChild(spacer);
      
      // Update stats
      this.app.searchManager.updateStats();
      
      // No need to re-setup hover previews or drag & drop event listeners!
      // Both systems use event delegation on the grid container.
      // However, we need to ensure the Foundry DragDrop instance knows about new elements
      if (this.app.dragDropManager._dragDrop) {
        // Re-bind only the DragDrop instance to pick up new .token-item elements
        this.app.dragDropManager._dragDrop.bind(grid);
      }
      
      // Clean up any lingering cloud token preparation state that might block repeated attempts
      this.app.dragDropManager._cleanupPreparationState();
      
    } catch (error) {
      console.error('fa-token-browser | Error loading more images:', error);
    } finally {
      // Always reset loading state
      this._isLoading = false;
    }
  }

  /**
   * Calculate initial batch size to fill viewport
   */
  calculateInitialBatchSize() {
    // Simple approach: load 150 items initially
    // This should fill any reasonable viewport and create scrollbar if more items exist
    return 150;
  }

  /**
   * Get approximate height of a token item for layout calculations
   */
  getApproximateItemHeight() {
    // Try to get actual grid size, fallback to medium
    let size = 'medium';
    const grid = this.app.element?.querySelector('.token-grid');
    if (grid) {
      size = grid.getAttribute('data-thumbnail-size') || 'medium';
    }
    
    // Base heights include thumbnail + padding + text
    const heights = {
      small: 140,   // 80px thumbnail + padding + text
      medium: 156,  // 96px thumbnail + padding + text  
      large: 188    // 128px thumbnail + padding + text
    };
    
    return heights[size] || heights.medium;
  }

  /**
   * Calculate approximate items per row for layout
   */
  getItemsPerRow() {
    const grid = this.app.element.querySelector('.token-grid');
    const gridWidth = grid.offsetWidth;
    const size = grid.getAttribute('data-thumbnail-size') || 'medium';
    
    // Approximate item widths including gaps
    const itemWidths = {
      small: 120,   // 100px min + gap
      medium: 136,  // 116px min + gap
      large: 168    // 148px min + gap
    };
    
    const itemWidth = itemWidths[size] || itemWidths.medium;
    return Math.floor(gridWidth / itemWidth) || 1;
  }

  /**
   * Create DOM elements for image batch with skeleton loading
   */
  createImageElements(images) {
    // MEMORY LEAK FIX: Clean up any orphaned elements from previous operations
    this._cleanupOrphanedElements();
    
    return images.map(imageData => {
      const tokenItem = document.createElement('div');
      
      // Add cloud token class if applicable
      const isCloudToken = imageData.source === 'cloud';
      tokenItem.className = isCloudToken ? 'token-base token-item cloud-token' : 'token-base token-item';
      
      // Set data attributes
      tokenItem.setAttribute('data-path', imageData.path);
      tokenItem.setAttribute('data-filename', imageData.filename);
      tokenItem.setAttribute('data-source', imageData.source || 'local');
      if (imageData.tier) {
        tokenItem.setAttribute('data-tier', imageData.tier);
      }
      
      // Start with draggable=false, will be enabled after preload completes
      tokenItem.setAttribute('draggable', 'false');
      tokenItem.style.cursor = 'grab';
      
      // Build token status icon
      let tokenStatusIconHTML = '';
      if (isCloudToken) {
        if (imageData.isCached) {
          tokenStatusIconHTML = `<div class="token-status-icon cached-cloud" title="Cloud token (cached locally)">
            <i class="fas fa-cloud-check"></i>
          </div>`;
        } else if (imageData.tier === 'premium') {
          tokenStatusIconHTML = `<div class="token-status-icon premium-cloud" title="Premium cloud token">
            <i class="fas fa-cloud-plus"></i>
          </div>`;
        } else {
          tokenStatusIconHTML = `<div class="token-status-icon free-cloud" title="Free cloud token">
            <i class="fas fa-cloud"></i>
          </div>`;
        }
      } else {
        tokenStatusIconHTML = `<div class="token-status-icon local-storage" title="Local storage">
          <i class="fas fa-folder"></i>
        </div>`;
      }
      
      // Build variant HTML if present
      const variantHTML = imageData.variant 
        ? `<div class="token-variant">${imageData.variant}</div>` 
        : '';
      
      // Build token details HTML
      const sizeHTML = imageData.size 
        ? `<span class="token-size">${imageData.size}</span>` 
        : '';
      const scaleHTML = imageData.scale 
        ? `<span class="token-scale">${imageData.scale}</span>` 
        : '';
      const creatureTypeHTML = imageData.creatureType 
        ? `<span class="token-creature-type">${imageData.creatureType}</span>` 
        : '';
      
      // Only create token-details div if there's at least one detail
      const hasDetails = imageData.size || imageData.scale || imageData.creatureType;
      const tokenDetailsHTML = hasDetails 
        ? `<div class="token-details">${sizeHTML}${scaleHTML}${creatureTypeHTML}</div>` 
        : '';
      
      tokenItem.innerHTML = `
        <div class="token-thumbnail">
          <div class="image-skeleton">
            <div class="skeleton-shimmer"></div>
            <i class="fas fa-image skeleton-icon"></i>
          </div>
          <img style="display: none;" alt="${imageData.filename}" />
          ${variantHTML}
        </div>
        <div class="token-info">
          <span class="token-name">${imageData.displayName}</span>
          ${tokenDetailsHTML}
        </div>
        ${tokenStatusIconHTML}
      `;
      
      // MEMORY LEAK FIX: Track this element for cleanup
      this._trackedElements.add(tokenItem);
      
      // Load image immediately - simple approach
      this.loadImageSimple(tokenItem, imageData.url);
      
      return tokenItem;
    });
  }

  /**
   * Simple image loading without complex queuing
   */
  loadImageSimple(tokenItem, imageUrl) {
    const img = tokenItem.querySelector('img');
    const skeleton = tokenItem.querySelector('.image-skeleton');
    
    if (!img || !skeleton) return;
    
    // MEMORY LEAK FIX: Store original cleanup function for this specific image
    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
      img.src = '';
      tokenItem._imageCleanup = null; // Clear the cleanup reference
    };
    tokenItem._imageCleanup = cleanup;
    
    img.onload = () => {
      // Smooth transition from skeleton to image
      skeleton.style.opacity = '0';
      this.app.eventManager.createTimeout(() => {
        skeleton.style.display = 'none';
        img.style.display = 'block';
        img.style.opacity = '0';
        
        // MEMORY LEAK FIX: Store animation frame ID for cleanup
        const animationId = requestAnimationFrame(() => {
          img.style.transition = 'opacity 0.3s ease';
          img.style.opacity = '1';
          // Clear the stored ID after animation starts
          if (tokenItem._animationFrameId === animationId) {
            tokenItem._animationFrameId = null;
          }
        });
        tokenItem._animationFrameId = animationId;
      }, 150);
    };
    
    img.onerror = () => {
      // Show error state
      skeleton.innerHTML = '<i class="fas fa-exclamation-triangle skeleton-error"></i>';
      skeleton.classList.add('skeleton-error-state');
    };
    
    // Start loading
    img.src = imageUrl;
  }

  /**
   * Initialize lazy loading with first batch of images
   * @param {Array} allImages - All available images
   * @param {Array} imagesToDisplay - Images to display based on search state
   * @returns {Array} Initial batch of displayed images
   */
  initializeWithBatch(allImages, imagesToDisplay) {
    // Calculate initial batch size based on viewport - use consistent logic
    const initialBatchSize = Math.min(this.calculateInitialBatchSize(), imagesToDisplay.length);
    
    // Initialize with first batch
    const displayedImages = imagesToDisplay.slice(0, initialBatchSize);
    
    return displayedImages;
  }

  /**
   * Create initial image elements for the first render
   * @param {Array} images - Images to create elements for
   * @returns {Array} Array of DOM elements
   */
  createInitialElements(images) {
    return this.createImageElements(images);
  }

  /**
   * Reset loading state (useful for search operations)
   */
  resetLoadingState() {
    this._isLoading = false;
    this._lastScrollTime = 0;
  }

  /**
   * Clean up all image event handlers and animations in the grid
   * @private
   */
  _cleanupImageHandlers() {
    // MEMORY LEAK FIX: Clean up orphaned elements first
    this._cleanupOrphanedElements();
    
    if (!this.app || !this.app.element) return;
    
    const grid = this.app.element.querySelector('.token-grid');
    if (!grid) return;
    
    // Find all token items and clean up animations
    const tokenItems = grid.querySelectorAll('.token-item');
    tokenItems.forEach(tokenItem => {
      this._cleanupTokenItem(tokenItem);
    });
  }

  /**
   * Clean up a specific token item's image handlers and animations
   * @param {HTMLElement} tokenItem - The token item to clean up
   * @private
   */
  _cleanupTokenItem(tokenItem) {
    // MEMORY LEAK FIX: Cancel pending animation frames
    if (tokenItem._animationFrameId) {
      cancelAnimationFrame(tokenItem._animationFrameId);
      tokenItem._animationFrameId = null;
    }
    
    // MEMORY LEAK FIX: Use stored cleanup function if available
    if (tokenItem._imageCleanup) {
      tokenItem._imageCleanup();
    }
    
    // MEMORY LEAK FIX: Clear CSS transitions and animations immediately
    const img = tokenItem.querySelector('img');
    const skeleton = tokenItem.querySelector('.image-skeleton');
    
    if (img) {
      img.style.transition = 'none'; // Force-stop transitions
      img.style.opacity = '';
      img.onload = null;
      img.onerror = null;
      img.src = ''; // Stop any pending loads
    }
    
    if (skeleton) {
      skeleton.style.transition = 'none'; // Force-stop transitions
      skeleton.style.opacity = '';
      skeleton.classList.remove('skeleton-error-state'); // Remove animation classes
    }
    
    // MEMORY LEAK FIX: Remove from tracking set
    this._trackedElements.delete(tokenItem);
  }

  /**
   * Clean up image handlers for a specific set of token items
   * This is called before grid regeneration to prevent memory leaks
   * @param {NodeList|Array} tokenItems - Token items to clean up
   */
  cleanupTokenItems(tokenItems) {
    if (!tokenItems) return;
    
    tokenItems.forEach(tokenItem => {
      this._cleanupTokenItem(tokenItem);
    });
  }

  /**
   * Clean up any orphaned DOM elements that might be detached but still have handlers
   * @private
   */
  _cleanupOrphanedElements() {
    // MEMORY LEAK FIX: Clean up tracked elements that are no longer in the DOM
    for (const tokenItem of this._trackedElements) {
      // Check if element is still in the DOM
      if (!document.contains(tokenItem)) {
        // Element is detached, clean it up
        this._cleanupTokenItem(tokenItem);
        // Note: _cleanupTokenItem will remove it from _trackedElements
        // Continue iterating through the set (safe in JavaScript)
      }
    }
    
    // Force garbage collection of detached elements by clearing global references
    // This helps with elements that were created but removed from DOM without proper cleanup
    if (typeof window !== 'undefined' && window.gc) {
      // If GC is exposed (dev tools), suggest garbage collection
      try {
        window.gc();
      } catch (e) {
        // Ignore if GC not available
      }
    }
    
    // Additional safeguard: look for any img elements in the current DOM that might be orphaned
    if (this.app && this.app.element) {
      const grid = this.app.element.querySelector('.token-grid');
      if (grid) {
        // Find any img elements without proper parent structure and clean them
        const orphanedImages = grid.querySelectorAll('img:not(.token-item img)');
        orphanedImages.forEach(img => {
          img.onload = null;
          img.onerror = null;
          img.src = '';
          if (img.parentNode) {
            img.parentNode.removeChild(img);
          }
        });
      }
    }
  }

  /**
   * Destroy the lazy loading manager and clean up
   */
  destroy() {
    // MEMORY LEAK FIX: Clean up all tracked elements first
    for (const tokenItem of this._trackedElements) {
      this._cleanupTokenItem(tokenItem);
    }
    this._trackedElements.clear();
    
    // Clean up all image event handlers to prevent memory leaks
    this._cleanupImageHandlers();
    
    this._isLoading = false;
    this._lastScrollTime = 0;
    this.app = null;
  }
} 