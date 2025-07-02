// Search engine and management system for FA Token Browser
// Contains both pure search functions and DOM-aware search management

/**
 * Tokenize a user search query into terms and operators (AND implicit, OR, NOT)
 * @param {string} query
 * @returns {Array<{type:'TERM'|'OR'|'NOT', value?:string}>}
 */
export function tokenizeQuery(query='') {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      if (/^or$/i.test(tok)) return { type: 'OR' };
      if (/^not$/i.test(tok)) return { type: 'NOT' };
      return { type: 'TERM', value: tok.toLowerCase() };
    });
}

/**
 * Group tokens by OR operations so evaluation becomes easier.
 * Example: [dragon fire OR ice NOT small] -> [[dragon],[fire,OR,ice],[NOT,small]]
 * @param {ReturnType<typeof tokenizeQuery>} tokens
 */
function groupTokens(tokens) {
  const groups = [];
  let current = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.type === 'NOT') {
      // finish any group in progress
      if (current.length) {
        groups.push(current);
        current = [];
      }

      // build NOT group: NOT + immediately following TERM
      const notGroup = [tok];
      if (i + 1 < tokens.length && tokens[i + 1].type === 'TERM') {
        notGroup.push(tokens[i + 1]);
        i += 1; // skip the term we just consumed
      }
      groups.push(notGroup);
      continue;
    }

    current.push(tok);

    if (tok.type === 'TERM') {
      const next = tokens[i + 1];
      if (!next || (next.type !== 'OR' && next.type !== 'NOT')) {
        groups.push(current);
        current = [];
      }
    }
  }

  if (current.length) groups.push(current);
  return groups;
}

function evaluateGroup(group, haystack) {
  if (!group.length) return true;

  if (group[0].type === 'NOT') {
    const terms = group.slice(1).filter((t) => t.type === 'TERM');
    return !terms.some((t) => haystack.includes(t.value));
  }

  if (group.some((t) => t.type === 'OR')) {
    return group.filter((t) => t.type === 'TERM').some((t) => haystack.includes(t.value));
  }

  return group.filter((t) => t.type === 'TERM').every((t) => haystack.includes(t.value));
}

function evaluateTokens(tokens, haystack) {
  const groups = groupTokens(tokens);
  return groups.every((g) => evaluateGroup(g, haystack));
}

export function matchesSearchQuery(imageData, query) {
  if (!query) return true;
  
  // Build comprehensive searchable text including all token information
  const searchableFields = [
    imageData.filename || '',
    imageData.path || '',
    imageData.displayName || '',
    imageData.variant || '',
    imageData.size || '',
    imageData.scale || '',
    imageData.creatureType || '',
    imageData.source || '', // 'local' or 'cloud'
    imageData.tier || '', // 'free' or 'premium'
    // Add storage-specific terms
    imageData.source === 'local' ? 'local storage folder' : '',
    imageData.source === 'cloud' ? 'cloud online' : '',
    imageData.isCached ? 'cached downloaded' : '',
    imageData.tier === 'premium' ? 'premium patreon supporter' : '',
    imageData.tier === 'free' || !imageData.tier ? 'free' : ''
  ];
  
  const haystack = searchableFields.join(' ').toLowerCase();
  const tokens = tokenizeQuery(query);
  return evaluateTokens(tokens, haystack);
}

/**
 * Search Management System for FA Token Browser
 * Handles search state, filtering, grid regeneration, and result display
 */
export class SearchManager {
  constructor(app) {
    this.app = app; // Reference to the main application
    
    // Search state
    this._searchQuery = '';
    this._filteredImages = [];
  }

  /**
   * Get the current search query
   * @returns {string}
   */
  get searchQuery() {
    return this._searchQuery;
  }

  /**
   * Get the current filtered images
   * @returns {Array}
   */
  get filteredImages() {
    return this._filteredImages;
  }

  /**
   * Check if search is currently active
   * @returns {boolean}
   */
  get isSearchActive() {
    return !!this._searchQuery;
  }

  /**
   * Get images to display based on search state
   * @param {Array} allImages - All available images
   * @returns {Array}
   */
  getImagesToDisplay(allImages) {
    return this.isSearchActive ? this._filteredImages : allImages;
  }

  /**
   * Activate search functionality and set up event handlers
   */
  activateSearch() {
    const searchInput = this.app.element.querySelector('#token-search');
    const clearButton = this.app.element.querySelector('.clear-search');
    const wrapper = this.app.element.querySelector('.search-input-wrapper');
    
    if (!searchInput || !clearButton || !wrapper) return;

    // Restore search query if any
    if (this._searchQuery) {
      searchInput.value = this._searchQuery;
      wrapper.classList.add('has-text');
    }

    // Real-time search as user types
    let searchTimeout;
    const inputHandler = (event) => {
      const query = event.target.value.trim();
      
      // Update UI state
      if (query) {
        wrapper.classList.add('has-text');
      } else {
        wrapper.classList.remove('has-text');
      }
      
      // Debounce search using tracked timeout
      if (searchTimeout) {
        this.app.eventManager.clearTimeout(searchTimeout);
      }
      searchTimeout = this.app.eventManager.createTimeout(() => {
        this.performSearch(query);
      }, 600);
    };

    // Clear search
    const clearHandler = () => {
      searchInput.value = '';
      wrapper.classList.remove('has-text');
      this.performSearch('');
      searchInput.focus();
    };

    // Handle Enter key
    const keydownHandler = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (searchTimeout) {
          this.app.eventManager.clearTimeout(searchTimeout);
          this.performSearch(searchInput.value.trim());
        }
      }
    };

    // Register event handlers with the event manager
    this.app.eventManager.registerSearchHandlers(searchInput, clearButton, inputHandler, clearHandler, keydownHandler);
  }

  /**
   * Perform search and update display
   * @param {string} query - The search query
   */
  performSearch(query) {
    this._searchQuery = query.toLowerCase();
    
    if (this._searchQuery) {
      // Parse search query and filter images using the search engine functions
      this._filteredImages = this.app._allImages.filter((img) => matchesSearchQuery(img, this._searchQuery));
    } else {
      this._filteredImages = [];
    }
    
    // Reset display and re-render
    this.app._displayedImages = [];
    this.regenerateGrid();
    
    // Scroll to top to show search results from beginning
    // Use tracked timeout to ensure DOM is updated before scrolling
    this.app.eventManager.createTimeout(() => {
      const grid = this.app.element.querySelector('.token-grid');
      if (grid) {
        grid.scrollTop = 0;
      }
    }, 50);
  }

  /**
   * Regenerate the token grid with current search/filter
   */
  regenerateGrid() {
    const grid = this.app.element.querySelector('.token-grid');
    if (!grid) return;
    
    // Clean up preloaded canvases before clearing DOM
    const existingItems = grid.querySelectorAll('.token-item');
    existingItems.forEach(item => this.app.dragDropManager.cleanupTokenPreload(item));
    
    // Clear existing items
    grid.innerHTML = '';
    
    // Get images to display
    const imagesToDisplay = this.getImagesToDisplay(this.app._allImages);
    
    // Initialize with first batch using lazy loading manager
    this.app._displayedImages = this.app.lazyLoadingManager.initializeWithBatch(this.app._allImages, imagesToDisplay);
    
    // Create and add new items with skeleton loading
    const newItems = this.app.lazyLoadingManager.createImageElements(this.app._displayedImages);
    newItems.forEach(item => {
      grid.appendChild(item);
      // Register with intersection observer for off-screen cleanup
      if (this.app.dragDropManager) {
        this.app.dragDropManager.registerTokenWithObserver(item);
      }
    });
    
    // Update stats
    this.updateStats();
    
    // Show no results message if needed
    if (imagesToDisplay.length === 0 && this.isSearchActive) {
      this.showNoResults();
    } else {
      this.hideNoResults();
    }
    
    // Re-setup hover previews for new grid
    this.app._setupHoverPreviews();
    
    // Re-setup drag and drop since clearing innerHTML breaks the DragDrop binding
    try {
      this.app._setupDragAndDrop();
    } catch (error) {
      console.error('fa-token-browser | Drag & Drop: Error during setup:', error);
    }
    

  }

  /**
   * Update the token count display with search-aware stats
   */
  updateStats() {
    const statsElement = this.app.element.querySelector('.token-browser-stats span');
    if (statsElement) {
      const imagesToDisplay = this.getImagesToDisplay(this.app._allImages);
      const hasMore = this.app._displayedImages.length < imagesToDisplay.length;
      
      if (this.isSearchActive) {
        statsElement.textContent = hasMore 
          ? `${this.app._displayedImages.length} of ${imagesToDisplay.length} results shown (${this.app._allImages.length} total)`
          : `${imagesToDisplay.length} results found (${this.app._allImages.length} total)`;
      } else {
        statsElement.textContent = hasMore 
          ? `${this.app._displayedImages.length} of ${this.app._allImages.length} tokens loaded`
          : `${this.app._allImages.length} tokens found`;
      }
    }
  }

  /**
   * Show no search results message
   */
  showNoResults() {
    let noResults = this.app.element.querySelector('.no-search-results');
    if (!noResults) {
      noResults = document.createElement('div');
      noResults.className = 'no-search-results';
      noResults.innerHTML = `
        <div class="empty-search-state">
          <i class="fas fa-search"></i>
          <p>No tokens found matching "<strong>${this._searchQuery}</strong>"</p>
          <p>Try different keywords or check your spelling.</p>
        </div>
      `;
      this.app.element.querySelector('.token-grid').parentNode.appendChild(noResults);
    } else {
      noResults.querySelector('strong').textContent = this._searchQuery;
      noResults.style.display = 'block';
    }
  }

  /**
   * Hide no search results message
   */
  hideNoResults() {
    const noResults = this.app.element.querySelector('.no-search-results');
    if (noResults) {
      noResults.style.display = 'none';
    }
  }

  /**
   * Clear the current search and reset to show all images
   */
  clearSearch() {
    this.performSearch('');
    
    // Clear the search input UI
    const searchInput = this.app.element.querySelector('#token-search');
    const wrapper = this.app.element.querySelector('.search-input-wrapper');
    
    if (searchInput) {
      searchInput.value = '';
    }
    if (wrapper) {
      wrapper.classList.remove('has-text');
    }
  }

  /**
   * Get search context for template rendering
   * @returns {Object}
   */
  getSearchContext() {
    const imagesToDisplay = this.getImagesToDisplay(this.app._allImages);
    
    return {
      searchQuery: this._searchQuery,
      totalImages: imagesToDisplay.length,
      hasMore: this.app._displayedImages.length < imagesToDisplay.length,
      isSearchActive: this.isSearchActive
    };
  }

  /**
   * Check if more images can be loaded based on search state
   * @returns {boolean}
   */
  canLoadMore() {
    const imagesToDisplay = this.getImagesToDisplay(this.app._allImages);
    return this.app._displayedImages.length < imagesToDisplay.length;
  }

  /**
   * Get the next batch of images for lazy loading
   * @param {number} batchSize - Number of items to load
   * @returns {Array}
   */
  getNextBatch(batchSize) {
    const imagesToDisplay = this.getImagesToDisplay(this.app._allImages);
    const currentLength = this.app._displayedImages.length;
    return imagesToDisplay.slice(currentLength, currentLength + batchSize);
  }

  /**
   * Destroy the search manager and clean up
   */
  destroy() {
    this._searchQuery = '';
    this._filteredImages = [];
    this.app = null;
  }
}