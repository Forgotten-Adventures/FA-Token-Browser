// Token Browser Module for Foundry VTT (latest version)
import * as SystemDetection from './system-detection.js';
import { ActorFactory } from './actor-factory.js';
import { PatreonAuthService, PatreonOAuthApp } from './patreon-auth-service.js';
import { parseTokenSize, calcDragPreviewPixelDims } from './geometry.js';
import { matchesSearchQuery, SearchManager } from './search-engine.js';

import { TokenDataService } from './token-data-service.js';
import { TokenPreviewManager } from './token-preview-manager.js';
import { TokenDragDropManager } from './token-dragdrop-manager.js';
import { EventManager } from './event-manager.js';
import { LazyLoadingManager } from './lazy-loading-manager.js';

export const TOKEN_BROWSER_VERSION = "0.0.1";

Hooks.once('init', async () => {


  // Initialize simple global object for macro support (preserve existing properties)
  window.faTokenBrowser = {
    ...window.faTokenBrowser, // Preserve existing properties like PatreonAuthService, PatreonOAuthApp
    openTokenBrowser: () => {
      const existingApp = Object.values(foundry.applications.instances).find(app => app.id === 'token-browser-app');
      if (existingApp) {
        existingApp.maximize();
        existingApp.bringToTop();
      } else {
        new TokenBrowserApp().render(true);
      }
    },
    version: TOKEN_BROWSER_VERSION
  };

  // Preload the templates
  await foundry.applications.handlebars.loadTemplates([
    'modules/fa-token-browser/templates/token-browser.hbs',
    'modules/fa-token-browser/templates/oauth-window.hbs',
    'modules/fa-token-browser/templates/token-update-confirm.hbs'
  ]);

  // Register a module setting for a single custom token folder, shown in Game Settings
  game.settings.register('fa-token-browser', 'customTokenFolder', {
    name: 'Custom Token Folder',
    hint: 'Select a folder to include in the Token Browser.',
    scope: 'world',
    config: true, // Show in standard Game Settings UI
    type: String,
    default: '',
    filePicker: 'folder', // Adds a folder picker button
    restricted: true,
    onChange: value => {
      console.log('fa-token-browser | Custom Token Folder setting changed:', value);
    }
  });

  // Register actor folder setting  
  game.settings.register('fa-token-browser', 'actorFolder', {
    name: 'Actor Creation Folder',
    hint: 'Name of the folder where new actors will be created. Leave empty to create actors in the root directory.',
    scope: 'world',
    config: true,
    type: String,
    default: '',
    restricted: true,
    onChange: value => {
      console.log('fa-token-browser | Actor Folder setting changed:', value || 'root directory');
    }
  });

  // Register position storage setting (hidden from UI)
  game.settings.register('fa-token-browser', 'tokenBrowserPosition', {
    name: 'Token Browser Window Position',
    scope: 'client',
    config: false, // Hidden from UI
    type: Object,
    default: {},
    restricted: false
  });

  // Register larger previews setting
  game.settings.register('fa-token-browser', 'largerPreviews', {
    name: 'Larger Previews',
    hint: 'Use larger preview images (350px instead of 200px base size) when hovering over tokens.',
    scope: 'client',
    config: true, // Show in Game Settings UI
    type: Boolean,
    default: false,
    restricted: false,
    onChange: value => {
      console.log('fa-token-browser | Larger Previews setting changed:', value);
    }
  });

  // Register thumbnail size setting (hidden from UI, controlled by size selector)
  game.settings.register('fa-token-browser', 'thumbnailSize', {
    name: 'Preferred Thumbnail Size',
    scope: 'client',
    config: false, // Hidden from UI - controlled by size selector
    type: String,
    default: 'medium',
    restricted: false,
    choices: {
      'small': 'Small',
      'medium': 'Medium', 
      'large': 'Large'
    }
  });

  // Register Patreon authentication data setting (hidden from UI)
  game.settings.register('fa-token-browser', 'patreon_auth_data', {
    name: 'Patreon Authentication Data',
    scope: 'world',
    config: false, // Hidden from settings UI
    type: Object,
    default: null,
    restricted: true
  });

  // Register cache directory setting
  game.settings.register('fa-token-browser', 'cacheDirectory', {
    name: 'Token Cache Directory',
    hint: 'Directory where cloud tokens are cached locally. Relative to Foundry Data folder. Default: fa-token-browser-cache',
    scope: 'world',
    config: true,
    type: String,
    default: 'fa-token-browser-cache',
    filePicker: 'folder', // Adds a folder picker button
    restricted: true,
    onChange: value => {
      console.log('fa-token-browser | Cache Directory setting changed:', value);
    }
  });

  // Register max cache size setting
  game.settings.register('fa-token-browser', 'maxCacheSize', {
    name: 'Maximum Cache Size (MB)',
    hint: 'Maximum size of token cache in megabytes. Set to 0 for unlimited cache size. Older files will be deleted when limit is exceeded.',
    scope: 'world',
    config: true,
    type: Number,
    default: 500,
    range: {
      min: 0,
      max: 5000,
      step: 50
    },
    restricted: true,
    onChange: value => {
      console.log('fa-token-browser | Max Cache Size setting changed:', value === 0 ? 'unlimited' : `${value} MB`);
    }
  });

  // Register max cache age setting
  game.settings.register('fa-token-browser', 'maxCacheAge', {
    name: 'Maximum Cache Age (Days)',
    hint: 'Maximum age of cached tokens in days. Set to 0 to keep files indefinitely. Older files will be automatically deleted.',
    scope: 'world',
    config: true,
    type: Number,
    default: 7,
    range: {
      min: 0,
      max: 365,
      step: 1
    },
    restricted: true,
    onChange: value => {
      console.log('fa-token-browser | Max Cache Age setting changed:', value === 0 ? 'unlimited' : `${value} days`);
    }
  });

  // Register canvas drop handler hook (only once)
  // Use Hooks.once to ensure it's only registered once even during dev reloads
  if (!window.faTokenBrowser.dropHandlerRegistered) {
    Hooks.on('dropCanvasData', async (canvas, data, event) => {
      return await TokenDragDropManager.handleCanvasDrop(canvas, data, event);
    });
    window.faTokenBrowser.dropHandlerRegistered = true;
  
  }

  // Setup canvas as drop zone when ready
  Hooks.once('canvasReady', () => {
    TokenDragDropManager.setupCanvasDropZone();
  });
  
  // Setup actors sidebar as drop zone when ready
  Hooks.once('ready', () => {
    TokenDragDropManager.setupActorDropZone();
  });

  // Define and expose TokenBrowserApp after Foundry is initialized
  const { HandlebarsApplicationMixin } = foundry.applications.api;
  class TokenBrowserApp extends HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
    
    constructor(...args) {
      super(...args);
      // Initialize Patreon authentication service
      this.patreonAuth = new PatreonAuthService();
      // Initialize token data service with parent app reference
      this.tokenDataService = new TokenDataService(this);
      // Initialize event manager FIRST (needed by other managers)
      this.eventManager = new EventManager(this);
      // Initialize preview manager with TokenDataService and EventManager
      this.previewManager = new TokenPreviewManager(this.tokenDataService, this.eventManager);
      // Initialize drag drop manager
      this.dragDropManager = new TokenDragDropManager(this);
      // Initialize search manager
      this.searchManager = new SearchManager(this);
      // Initialize lazy loading manager
      this.lazyLoadingManager = new LazyLoadingManager(this);
      // Image state
      this._allImages = [];
      this._displayedImages = [];
    }

    static DEFAULT_OPTIONS = {
      id: 'token-browser-app',
      tag: 'form',
      window: {
        title: 'Token Browser',
        frame: true,
        positioned: true,
        resizable: true
      },
      position: {
        width: Math.min(1000, Math.max(600, window.innerWidth * 0.7)),
        height: Math.min(700, Math.max(500, window.innerHeight * 0.8))
      }
    };

    static PARTS = {
      form: {
        template: 'modules/fa-token-browser/templates/token-browser.hbs'
      }
    };

    _initializeApplicationOptions(options) {
      // Get stored position from client settings
      const storedPosition = game.settings.get('fa-token-browser', 'tokenBrowserPosition') || {};
      
      // Use stored position if available, otherwise use responsive defaults
      const defaultOptions = super._initializeApplicationOptions(options);
      
      // Validate and apply stored dimensions
      if (storedPosition.width && storedPosition.height) {
        // Ensure dimensions are within reasonable bounds
        const minWidth = 455;
        const minHeight = 455;
        const maxWidth = Math.min(window.innerWidth * 0.95, 1600);
        const maxHeight = Math.min(window.innerHeight * 0.95, 1200);
        
        defaultOptions.position.width = Math.max(minWidth, Math.min(maxWidth, storedPosition.width));
        defaultOptions.position.height = Math.max(minHeight, Math.min(maxHeight, storedPosition.height));
      }
      
      // Validate and apply stored position
      if (storedPosition.left !== undefined && storedPosition.top !== undefined) {
        // Ensure window is visible on screen (at least partially)
        const minVisible = 100; // Minimum pixels that must be visible
        const maxLeft = window.innerWidth - minVisible;
        const maxTop = window.innerHeight - minVisible;
        
        defaultOptions.position.left = Math.max(-50, Math.min(maxLeft, storedPosition.left));
        defaultOptions.position.top = Math.max(0, Math.min(maxTop, storedPosition.top));
        

      }
      
      return defaultOptions;
    }

    _onClose(options = {}) {
  
      
      // Save current position before closing
      this.eventManager.savePosition();
      
      // Clean up event manager (handles all timers and event handlers)
      if (this.eventManager) {
        this.eventManager.destroy();
      }
      
      // Clean up search manager
      if (this.searchManager) {
        this.searchManager.destroy();
      }
      
      // Clean up lazy loading manager
      if (this.lazyLoadingManager) {
        this.lazyLoadingManager.destroy();
      }
      
      // Clean up drag and drop manager
      if (this.dragDropManager) {
        this.dragDropManager.destroy();
      }
      
      // Clean up preview manager
      if (this.previewManager) {
        this.previewManager.destroy();
      }
      
      super._onClose(options);
    }

    /**
     * Handle position changes and persist them to settings
     * @param {ApplicationPosition} position - The new position data
     */
    _onPosition(position) {
      super._onPosition(position);
      this.eventManager.handlePositionChange(position);
    }

    /**
     * Enhanced render method to add header customizations
     */
    _onRender(context, options) {
      super._onRender(context, options);
      
      // Add custom header elements (Patreon auth and stats)
      this._enhanceHeader(context);
      
      // Initialize preview manager
      this.previewManager.initialize();
      // Activate size selector
      this._activateSizeSelector();
      // Setup simple scroll-based lazy loading
      this.lazyLoadingManager.setupScrollLazyLoading();
      // Activate search functionality
      this.searchManager.activateSearch();
      // Setup hover previews
      this._setupHoverPreviews();
      // Setup drag and drop functionality
      this._setupDragAndDrop();
    }

    /**
     * Enhance the window header with Patreon auth and token stats
     */
    _enhanceHeader(context) {
      const header = this.element.querySelector('.window-header');
      if (!header) return;

      // Create header content container if it doesn't exist
      let headerContent = header.querySelector('.header-content');
      if (!headerContent) {
        headerContent = document.createElement('div');
        headerContent.className = 'header-content';
        
        // Move existing title into the content container and enhance it
        const title = header.querySelector('.window-title');
        if (title) {
          // Add custom FA icon before title text
          this._addCustomIcon(title);
          // Update title text to include token stats
          this._updateTitleWithStats(title, context);
          headerContent.appendChild(title);
        }
        
        header.insertBefore(headerContent, header.firstChild);
      } else {
        // Update existing title with new stats
        const title = headerContent.querySelector('.window-title');
        if (title) {
          this._updateTitleWithStats(title, context);
        }
      }
      
      // Add Patreon auth to header
      this._addPatreonAuthToHeader(headerContent, context);
    }

    /**
     * Add custom FA icon to the title
     */
    _addCustomIcon(titleElement) {
      // Remove any existing custom icon
      const existingIcon = titleElement.querySelector('.custom-fa-icon');
      if (existingIcon) {
        existingIcon.remove();
      }

      // Create custom icon element
      const iconImg = document.createElement('img');
      iconImg.className = 'custom-fa-icon';
      iconImg.src = 'modules/fa-token-browser/images/cropped-FA-Icon-Plain-v2.png';
      iconImg.alt = 'FA Token Browser';
      iconImg.title = 'Forgotten Adventures Token Browser';
      
      // Insert at the beginning of the title
      titleElement.insertBefore(iconImg, titleElement.firstChild);
    }

    /**
     * Update the title text to include token statistics
     */
    _updateTitleWithStats(titleElement, context) {
      // Remove existing title content except the custom icon
      const customIcon = titleElement.querySelector('.custom-fa-icon');
      titleElement.innerHTML = '';
      if (customIcon) {
        titleElement.appendChild(customIcon);
      }

      // Create title with stats
      const titleTextSpan = document.createElement('span');
      titleTextSpan.textContent = 'Token Browser';
      titleElement.appendChild(titleTextSpan);

      // Add token stats if we have both cloud and local tokens
      if (context.cloudTokenCount > 0 && context.localTokenCount >= 0) {
        const statsSpan = document.createElement('span');
        statsSpan.className = 'title-stats';
        statsSpan.innerHTML = ` ( ${context.cloudTokenCount} <i class="fas fa-cloud title-cloud-icon"></i> + ${context.localTokenCount} local Tokens )`;
        titleElement.appendChild(statsSpan);
      }
    }

    /**
     * Add Patreon authentication UI to the header
     */
    _addPatreonAuthToHeader(headerContent, context) {
      // Remove existing auth UI if it exists
      const existingAuth = headerContent.querySelector('.header-patreon-auth');
      if (existingAuth) {
        existingAuth.remove();
      }

      const authContainer = document.createElement('div');
      authContainer.className = 'header-patreon-auth';
      
      if (context.isAuthenticated) {
        const statusDisplay = document.createElement('div');
        statusDisplay.className = 'auth-status-display';
        statusDisplay.innerHTML = `
          <i class="fas fa-check-circle"></i>
          <span class="auth-tier-text">${context.userTier} supporter</span>
        `;
        
        // Attach click handler for disconnect functionality
        statusDisplay.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          console.log('fa-token-browser | Patreon disconnect button clicked');
          this.patreonAuth.handlePatreonDisconnect(this, true); // Show confirmation for manual disconnect
        });
        statusDisplay.style.cursor = 'pointer';
        statusDisplay.title = 'Click to disconnect';
        
        authContainer.appendChild(statusDisplay);
      } else {
        const connectBtn = document.createElement('button');
        connectBtn.type = 'button';
        connectBtn.id = 'patreon-connect-btn';
        connectBtn.className = 'patreon-connect-button';
        connectBtn.innerHTML = `
          <i class="fas fa-user-shield"></i>
          <span class="auth-text">Connect Patreon</span>
        `;
        
        // Attach click handler immediately when button is created
        connectBtn.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          console.log('fa-token-browser | Patreon connect button clicked');
          try {
            await this.patreonAuth.handlePatreonConnect(this);
          } catch (error) {
            console.error('fa-token-browser | Error in Patreon connect handler:', error);
            ui.notifications.error(`Failed to connect to Patreon: ${error.message}`);
          }
        });
        
        authContainer.appendChild(connectBtn);
      }
      
      headerContent.appendChild(authContainer);
    }

    /**
     * Clean up drag and drop event listeners
     */
    _cleanupDragAndDrop() {
      const grid = this.element?.querySelector('.token-grid');
      if (this.dragDropManager) {
        this.dragDropManager.cleanupAllPreloads(grid);
      }
    }

    async _prepareContext(options) {
      // Provide the manifest of images for the template
      try {
        const customTokenFolder = game.settings.get('fa-token-browser', 'customTokenFolder') || '';
        
        // Get combined local and cloud tokens using TokenDataService
        const combinedTokenData = await this.tokenDataService.getCombinedTokens(customTokenFolder, true);
        
        // Convert TokenData to UI-compatible format for gradual migration
        this._allImages = this.tokenDataService.convertTokenDataForUI(combinedTokenData);
        
        // Get images to display based on search state
        const imagesToDisplay = this.searchManager.getImagesToDisplay(this._allImages);
        
        // Initialize with first batch using lazy loading manager
        this._displayedImages = this.lazyLoadingManager.initializeWithBatch(this._allImages, imagesToDisplay);
        
        // Count local vs cloud tokens for logging
        const localCount = this._allImages.filter(img => img.source === 'local').length;
        const cloudCount = this._allImages.filter(img => img.source === 'cloud').length;
        

        
        const searchContext = this.searchManager.getSearchContext();
        
        // Get authentication data for template
        const authData = game.settings.get('fa-token-browser', 'patreon_auth_data');
        const isAuthenticated = authData && authData.authenticated;
        const userTier = isAuthenticated ? authData.tier : null;
        
        return { 
          images: this._displayedImages,
          customTokenFolder,
          cloudTokenCount: cloudCount,
          localTokenCount: localCount,
          // Auth context for template
          isAuthenticated,
          userTier,
          ...searchContext
        };
      } catch (error) {
        console.error("TokenBrowserApp _prepareContext error:", error);
        return { 
          images: [],
          customTokenFolder: '',
          cloudTokenCount: 0,
          localTokenCount: 0,
          totalImages: 0,
          hasMore: false,
          searchQuery: '',
          error: error.message,
          // Auth context for error case
          isAuthenticated: false,
          userTier: null
        };
      }
    }

    /**
     * Update the status icon for a specific token across all visible instances
     * @param {string} filename - The filename of the token to update
     * @param {string} newStatus - The new status ('cached', 'free', 'premium', 'local')
     */
    updateTokenStatusIcon(filename, newStatus) {
      if (!filename || !this.element) {
        return;
      }

      // Find all token items with this filename
      const tokenItems = this.element.querySelectorAll(`[data-filename="${filename}"]`);
      
      tokenItems.forEach(tokenItem => {
        const statusIcon = tokenItem.querySelector('.token-status-icon');
        if (!statusIcon) {
          return;
        }

        // Remove all status classes
        statusIcon.classList.remove('local-storage', 'free-cloud', 'premium-cloud', 'cached-cloud');
        
        // Find the icon element
        const iconElement = statusIcon.querySelector('i');
        if (!iconElement) {
          return;
        }

        // Update based on new status
        switch (newStatus) {
          case 'cached':
            statusIcon.classList.add('cached-cloud');
            statusIcon.title = 'Cloud token (cached locally)';
            iconElement.className = 'fas fa-cloud-check';
            break;
          case 'free':
            statusIcon.classList.add('free-cloud');
            statusIcon.title = 'Free cloud token';
            iconElement.className = 'fas fa-cloud';
            break;
          case 'premium':
            statusIcon.classList.add('premium-cloud');
            statusIcon.title = 'Premium cloud token';
            iconElement.className = 'fas fa-cloud-plus';
            break;
          case 'local':
            statusIcon.classList.add('local-storage');
            statusIcon.title = 'Local storage';
            iconElement.className = 'fas fa-folder';
            break;
        }

        // Add a subtle animation to draw attention to the change
        statusIcon.style.transform = 'scale(1.2)';
        statusIcon.style.transition = 'transform 0.3s ease';
        
        setTimeout(() => {
          statusIcon.style.transform = 'scale(1)';
          setTimeout(() => {
            statusIcon.style.transition = '';
          }, 300);
        }, 200);
      });
    }

    static async renderApp() {
      const app = new this();
      return app.render(true);
    }

    /**
     * Activate the thumbnail size selector
     */
    _activateSizeSelector() {
      const sizeButtons = this.element.querySelectorAll('.size-btn');
      const grid = this.element.querySelector('.token-grid');
      
      if (!sizeButtons.length || !grid) return;

      // Load and apply saved thumbnail size
      const savedSize = game.settings.get('fa-token-browser', 'thumbnailSize') || 'medium';
      
      // Set initial state based on saved setting
      sizeButtons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-size') === savedSize) {
          btn.classList.add('active');
        }
      });
      
      // Apply saved size to grid
      grid.setAttribute('data-thumbnail-size', savedSize);

      sizeButtons.forEach(button => {
        const handler = (event) => {
          const newSize = button.getAttribute('data-size');
          
          // Skip if already active (avoid unnecessary work)
          if (button.classList.contains('active')) {
            return;
          }
          
          // Update active state
          sizeButtons.forEach(btn => btn.classList.remove('active'));
          button.classList.add('active');
          
          // Save the new thumbnail size to settings
          game.settings.set('fa-token-browser', 'thumbnailSize', newSize);
          
          // Check token count for performance optimization
          const tokenCount = grid.querySelectorAll('.token-item').length;
          const usePerformanceMode = tokenCount > 500; // Disable transitions for 500+ tokens
          
          if (usePerformanceMode) {
            // Performance mode: instant changes for large token counts
            grid.classList.add('performance-mode');
            grid.setAttribute('data-thumbnail-size', newSize);
            
            // Brief visual feedback without transitions
            grid.style.opacity = '0.9';
            requestAnimationFrame(() => {
              grid.style.opacity = '1';
            });
            
            // Optional: Subtle notification for first time in performance mode
            if (!grid._performanceNotified) {
              console.log(`fa-token-browser | Performance mode active (${tokenCount} tokens) - transitions disabled for better performance`);
              grid._performanceNotified = true;
            }
          } else {
            // Normal mode: smooth transitions for smaller token counts
            grid.classList.remove('performance-mode');
            
            // Performance optimization: Use transform for smooth transition
            grid.style.transform = 'scale(0.98)';
            grid.style.opacity = '0.8';
            
            // Apply the size change with requestAnimationFrame for better performance
            requestAnimationFrame(() => {
              grid.setAttribute('data-thumbnail-size', newSize);
              
              // Batch the restoration
              requestAnimationFrame(() => {
                grid.style.transform = 'scale(1)';
                grid.style.opacity = '1';
              });
            });
          }
        };
        
        this.eventManager.registerSizeButtonHandler(button, handler);
      });
    }

    /**
     * Setup hover previews for token images
     */
    _setupHoverPreviews() {
      // Delegate hover events to the grid container
      const grid = this.element.querySelector('.token-grid');
      if (!grid) return;

      // Define event handlers
      const mouseEnterHandler = (event) => {
        const tokenItem = event.target.closest('.token-item');
        if (!tokenItem) return;

        // Prevent multiple triggers on the same token
        if (tokenItem._previewActive) return;
        tokenItem._previewActive = true;

        // Cancel any pending cleanup since user is hovering again
        if (tokenItem._cleanupTimeout) {
          this.eventManager.clearTimeout(tokenItem._cleanupTimeout);
          tokenItem._cleanupTimeout = null;
        }

        // Start preloading immediately but don't enable dragging yet
        this.dragDropManager.preloadDragImage(tokenItem).catch(error => {
          console.warn('fa-token-browser | Failed to preload drag image:', error);
        });
        
        // Check if preload is ready and enable dragging if so
        this.dragDropManager.checkAndEnableDragging(tokenItem);

        const img = tokenItem.querySelector('img');
        if (!img || !img.complete) return;

        // Get TokenData for enhanced preview
        const filename = tokenItem.getAttribute('data-filename');
        const uiToken = this._allImages.find(token => token.filename === filename);
        const tokenData = uiToken ? this.tokenDataService.getTokenDataFromUIObject(uiToken) : null;

        // Use preview manager to show preview with delay (enhanced with TokenData)
        this.previewManager.showPreviewWithDelay(img, tokenItem, 400, tokenData);
      };

      const mouseLeaveHandler = (event) => {
        const tokenItem = event.target.closest('.token-item');
        if (!tokenItem) return;

        // Reset preview flag
        tokenItem._previewActive = false;

        // Use preview manager to hide preview
        this.previewManager.hidePreview();

        // Clean up old-style pre-loaded drag image (for backward compatibility)
        if (tokenItem._preloadedDragImage) {
          delete tokenItem._preloadedDragImage;
        }

        // Clean up preloaded canvas after a delay (user might come back)
        if (tokenItem._cleanupTimeout) {
          this.eventManager.clearTimeout(tokenItem._cleanupTimeout);
        }
        
        tokenItem._cleanupTimeout = this.eventManager.createTimeout(() => {
          this.dragDropManager.cleanupTokenPreload(tokenItem);
        }, 5000); // Clean up after 5 seconds of not hovering
      };

      // NOTE: Mousedown drag preparation is now handled by TokenDragDropManager
      // No need for duplicate mousedown handler here

      // Add mouseup handler to clean up pre-loaded images
      const mouseUpHandler = (event) => {
        const tokenItem = event.target.closest('.token-item');
        if (tokenItem) {
          // Clean up old-style preloaded drag image if it exists (for backward compatibility)
          if (tokenItem._preloadedDragImage) {
            this.eventManager.createTimeout(() => {
              if (tokenItem._preloadedDragImage) {
                delete tokenItem._preloadedDragImage;
              }
            }, 100);
          }
          // Note: Canvas-based preloading is handled by the drag drop manager
        }
      };

      const scrollHandler = () => {
        // Use preview manager to hide preview on scroll
        this.previewManager.hidePreview();
      };

      // Register all handlers with the event manager
      this.eventManager.registerHoverHandlers(grid, {
        mouseEnter: mouseEnterHandler,
        mouseLeave: mouseLeaveHandler,
        mouseUp: mouseUpHandler,
        scroll: scrollHandler
      });
    }

    /**
     * Setup drag and drop functionality for token items using Foundry's DragDrop class
     */
    _setupDragAndDrop() {
      const grid = this.element.querySelector('.token-grid');
      this.dragDropManager.initialize(grid);
    }

    

  }
  
});


Hooks.on('renderActorDirectory', (app, html) => {
    // Remove any existing token browser buttons to prevent duplicates
    $(html).find('.token-browser-btn').remove();
    
    // Add the "Open Token Browser" button to the Actors tab
    const tokenBrowserButton = $(`
        <button type="button" class="token-browser-btn">
            <i class="fas fa-sword"></i>   FA Token Browser   <i class="fas fa-dragon"></i>
        </button>
    `);

    tokenBrowserButton.on('click', (e) => {
        e.preventDefault();
        window.faTokenBrowser.openTokenBrowser();
    });

    // Add styling to match Foundry's directory buttons
    tokenBrowserButton.css({
        width: 'calc(100% - 16px)', // Account for left/right margin
        'margin': '8px',
        'line-height': '24px',
        'padding': '6px 12px',
        'font-size': '14px'
    });

    // Find the directory footer or append to the end of the directory
    const directoryFooter = $(html).find('.directory-footer');
    if (directoryFooter.length) {
        directoryFooter.before(tokenBrowserButton);
    } else {
        // Fallback: append to the end of the entire directory
        $(html).append(tokenBrowserButton);
    }
});




