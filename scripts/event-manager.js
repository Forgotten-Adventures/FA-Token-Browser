/**
 * Event Management System for FA Token Browser
 * Handles timeout/interval tracking, event handler management, and cleanup
 */
export class EventManager {
  constructor(app) {
    this.app = app; // Reference to the main application
    
    // Timer tracking
    this._activeTimeouts = new Set();
    this._activeIntervals = new Set();
    
    // Position saving
    this._savePositionTimeout = null;
    
    // Event handlers for cleanup - comprehensive tracking
    this._scrollHandler = null;
    this._handleMouseOver = null;
    this._handleMouseOut = null;
    this._handleMouseDown = null;
    this._handleMouseUp = null;
    this._handleScroll = null;
    
    // Search event handlers
    this._searchInputHandler = null;
    this._searchClearHandler = null;
    this._searchKeydownHandler = null;
    
    // Size selector handlers
    this._sizeButtonHandlers = [];
    
    // Main color filter handler
    this._mainColorFilterHandler = null;
    
    // Context menu handler
    this._contextMenuHandler = null;
    
    // Drag event handlers
    this._boundDragEndHandler = null;
  }

  /**
   * Helper method to create tracked setTimeout
   * @param {Function} callback - Function to execute
   * @param {number} delay - Delay in milliseconds
   * @returns {number} Timeout ID
   */
  createTimeout(callback, delay) {
    const timeoutId = setTimeout(() => {
      this._activeTimeouts.delete(timeoutId);
      callback();
    }, delay);
    this._activeTimeouts.add(timeoutId);
    return timeoutId;
  }

  /**
   * Helper method to create tracked setInterval
   * @param {Function} callback - Function to execute
   * @param {number} delay - Delay in milliseconds  
   * @returns {number} Interval ID
   */
  createInterval(callback, delay) {
    const intervalId = setInterval(callback, delay);
    this._activeIntervals.add(intervalId);
    return intervalId;
  }

  /**
   * Helper method to clear tracked timeout
   * @param {number} timeoutId - Timeout ID to clear
   */
  clearTimeout(timeoutId) {
    if (timeoutId) {
      clearTimeout(timeoutId);
      this._activeTimeouts.delete(timeoutId);
    }
  }

  /**
   * Helper method to clear tracked interval
   * @param {number} intervalId - Interval ID to clear
   */
  clearInterval(intervalId) {
    if (intervalId) {
      clearInterval(intervalId);
      this._activeIntervals.delete(intervalId);
    }
  }

  /**
   * Clean up all tracked timeouts and intervals
   */
  cleanupAllTimers() {
    // Clean up specific tracked timeouts
    if (this._savePositionTimeout) {
      this.clearTimeout(this._savePositionTimeout);
      this._savePositionTimeout = null;
    }
    
    // Clean up all tracked timeouts
    this._activeTimeouts.forEach(timeoutId => {
      clearTimeout(timeoutId);
    });
    this._activeTimeouts.clear();
    
    // Clean up all tracked intervals
    this._activeIntervals.forEach(intervalId => {
      clearInterval(intervalId);
    });
    this._activeIntervals.clear();
  }

  /**
   * Clean up all event handlers
   */
  cleanupAllEventHandlers() {
    // If the application element is already null/removed, only clean non-DOM handlers
    if (!this.app.element) {
      console.info('fa-token-browser | EventManager: Element removed, cleaning non-DOM handlers only');
      
      // Still clean up document-level handlers and stored references
      if (this._boundDragEndHandler) {
        document.removeEventListener('dragend', this._boundDragEndHandler, { capture: true });
        this._boundDragEndHandler = null;
      }
      
      // Clear all stored handler references
      this._searchInputHandler = null;
      this._searchKeydownHandler = null;
      this._searchClearHandler = null;
      this._sizeButtonHandlers = [];
      this._mainColorFilterHandler = null;
      this._contextMenuHandler = null;
      this._scrollHandler = null;
      this._handleMouseEnter = null;
      this._handleMouseLeave = null;
      this._handleMouseDown = null;
      this._handleMouseUp = null;
      this._handleScroll = null;
      
      return;
    }

    const grid = this.app.element.querySelector('.token-grid');
    const searchInput = this.app.element.querySelector('#token-search');
    const clearButton = this.app.element.querySelector('.clear-search');
    
    // Clean up scroll handler
    if (this._scrollHandler && grid) {
      grid.removeEventListener('scroll', this._scrollHandler);
      this._scrollHandler = null;
    }
    
    // Clean up hover preview handlers
    if (grid) {
      if (this._handleMouseEnter) {
        grid.removeEventListener('mouseenter', this._handleMouseEnter, true);
        this._handleMouseEnter = null;
      }
      if (this._handleMouseLeave) {
        grid.removeEventListener('mouseleave', this._handleMouseLeave, true);
        this._handleMouseLeave = null;
      }
      if (this._handleMouseDown) {
        grid.removeEventListener('mousedown', this._handleMouseDown);
        this._handleMouseDown = null;
      }
      if (this._handleMouseUp) {
        grid.removeEventListener('mouseup', this._handleMouseUp);
        this._handleMouseUp = null;
      }
      if (this._handleScroll) {
        grid.removeEventListener('scroll', this._handleScroll);
        this._handleScroll = null;
      }
    }
    
    // Clean up search handlers
    if (searchInput) {
      if (this._searchInputHandler) {
        searchInput.removeEventListener('input', this._searchInputHandler);
        this._searchInputHandler = null;
      }
      if (this._searchKeydownHandler) {
        searchInput.removeEventListener('keydown', this._searchKeydownHandler);
        this._searchKeydownHandler = null;
      }
    }
    
    if (clearButton && this._searchClearHandler) {
      clearButton.removeEventListener('click', this._searchClearHandler);
      this._searchClearHandler = null;
    }
    
    // Clean up size selector handlers
    this._sizeButtonHandlers.forEach(({ button, handler }) => {
      if (button) {
        button.removeEventListener('click', handler);
      }
    });
    this._sizeButtonHandlers = [];
    
    // Clean up main color filter handler
    if (this._mainColorFilterHandler) {
      const { checkbox, handler } = this._mainColorFilterHandler;
      if (checkbox) {
        checkbox.removeEventListener('change', handler);
      }
      this._mainColorFilterHandler = null;
    }
    
    // Clean up context menu handler
    if (this._contextMenuHandler) {
      const { grid, handler } = this._contextMenuHandler;
      if (grid) {
        grid.removeEventListener('contextmenu', handler);
      }
      this._contextMenuHandler = null;
    }
    
    // Clean up drag event handlers
    if (this._boundDragEndHandler) {
      document.removeEventListener('dragend', this._boundDragEndHandler, { capture: true });
      this._boundDragEndHandler = null;
    }
    

  }

  /**
   * Handle position changes and persist them to settings with throttling
   * @param {ApplicationPosition} position - The new position data
   */
  handlePositionChange(position) {
    // Save position with a small delay to avoid excessive saves during dragging
    if (this._savePositionTimeout) {
      this.clearTimeout(this._savePositionTimeout);
      this._savePositionTimeout = null;
    }
    
    this._savePositionTimeout = this.createTimeout(() => {
      this.savePosition();
      this._savePositionTimeout = null;
    }, 500); // Save after 500ms of no position changes
  }

  /**
   * Save current window position and size to client settings
   */
  savePosition() {
    try {
      const currentPosition = {
        width: this.app.position.width,
        height: this.app.position.height,
        left: this.app.position.left,
        top: this.app.position.top
      };
      
      game.settings.set('fa-token-browser', 'tokenBrowserPosition', currentPosition);
    } catch (error) {
      console.warn('fa-token-browser | EventManager: Failed to save window position:', error);
    }
  }

  /**
   * Register a size button handler for cleanup tracking
   * @param {HTMLElement} button - The button element
   * @param {Function} handler - The event handler function
   */
  registerSizeButtonHandler(button, handler) {
    button.addEventListener('click', handler);
    this._sizeButtonHandlers.push({ button, handler });
  }

  /**
   * Register main color filter checkbox handler for cleanup tracking
   * @param {HTMLElement} checkbox - The checkbox element
   * @param {Function} handler - The event handler function
   */
  registerMainColorFilterHandler(checkbox, handler) {
    checkbox.addEventListener('change', handler);
    this._mainColorFilterHandler = { checkbox, handler };
  }

  /**
   * Register context menu handler for cleanup tracking
   * @param {HTMLElement} grid - The grid element
   * @param {Function} handler - The event handler function
   */
  registerContextMenuHandler(grid, handler) {
    grid.addEventListener('contextmenu', handler);
    this._contextMenuHandler = { grid, handler };
  }

  /**
   * Register search event handlers for cleanup tracking
   * @param {HTMLElement} searchInput - The search input element
   * @param {HTMLElement} clearButton - The clear button element
   * @param {Function} inputHandler - The input event handler
   * @param {Function} clearHandler - The clear button handler
   * @param {Function} keydownHandler - The keydown event handler
   */
  registerSearchHandlers(searchInput, clearButton, inputHandler, clearHandler, keydownHandler) {
    if (searchInput) {
      this._searchInputHandler = inputHandler;
      this._searchKeydownHandler = keydownHandler;
      searchInput.addEventListener('input', inputHandler);
      searchInput.addEventListener('keydown', keydownHandler);
    }
    
    if (clearButton) {
      this._searchClearHandler = clearHandler;
      clearButton.addEventListener('click', clearHandler);
    }
  }

  /**
   * Register hover preview handlers for cleanup tracking
   * @param {HTMLElement} grid - The grid element
   * @param {Object} handlers - Object containing all the handler functions
   */
  registerHoverHandlers(grid, handlers) {
    // Remove any existing listeners to avoid duplicates
    this.cleanupHoverHandlers(grid);

    // Store and register new handlers
    this._handleMouseEnter = handlers.mouseEnter;
    this._handleMouseLeave = handlers.mouseLeave;
    this._handleMouseDown = handlers.mouseDown;
    this._handleMouseUp = handlers.mouseUp;
    this._handleScroll = handlers.scroll;

    // Add the event listeners
    grid.addEventListener('mouseenter', this._handleMouseEnter, true); // Use capture for delegation
    grid.addEventListener('mouseleave', this._handleMouseLeave, true); // Use capture for delegation
    grid.addEventListener('mousedown', this._handleMouseDown);
    grid.addEventListener('mouseup', this._handleMouseUp);
    grid.addEventListener('scroll', this._handleScroll);
  }

  /**
   * Clean up only the hover-related handlers
   * @param {HTMLElement} grid - The grid element
   */
  cleanupHoverHandlers(grid) {
    if (!grid) return;

    if (this._handleMouseEnter) {
      grid.removeEventListener('mouseenter', this._handleMouseEnter, true);
      this._handleMouseEnter = null;
    }
    if (this._handleMouseLeave) {
      grid.removeEventListener('mouseleave', this._handleMouseLeave, true);
      this._handleMouseLeave = null;
    }
    if (this._handleMouseDown) {
      grid.removeEventListener('mousedown', this._handleMouseDown);
      this._handleMouseDown = null;
    }
    if (this._handleMouseUp) {
      grid.removeEventListener('mouseup', this._handleMouseUp);
      this._handleMouseUp = null;
    }
    if (this._handleScroll) {
      grid.removeEventListener('scroll', this._handleScroll);
      this._handleScroll = null;
    }
  }

  /**
   * Register scroll lazy loading handler
   * @param {HTMLElement} grid - The grid element
   * @param {Function} scrollHandler - The scroll event handler
   */
  registerScrollHandler(grid, scrollHandler) {
    // Remove existing listener if any
    if (this._scrollHandler && grid) {
      grid.removeEventListener('scroll', this._scrollHandler);
    }

    this._scrollHandler = scrollHandler;
    grid.addEventListener('scroll', scrollHandler, { passive: true });
  }

  /**
   * Destroy the event manager and clean up everything
   */
  destroy() {
    this.cleanupAllTimers();
    this.cleanupAllEventHandlers();
    
    // Clear all references
    this.app = null;
  }
} 