// Token Browser Module for Foundry VTT (latest version)
import * as SystemDetection from './system-detection.js';
import { ActorFactory } from './actor-factory.js';
import { PatreonAuthService, PatreonOAuthApp } from './patreon-auth-service.js';
import { parseTokenSize, calcDragPreviewPixelDims } from './geometry.js';
import { matchesSearchQuery, SearchManager, detectColorVariant, getColorVariants } from './search-engine.js';

import { TokenDataService } from './token-data-service.js';
import { TokenPreviewManager } from './token-preview-manager.js';
import { TokenDragDropManager } from './token-dragdrop-manager.js';
import { EventManager } from './event-manager.js';
import { LazyLoadingManager } from './lazy-loading-manager.js';
import { ForgeIntegrationService, forgeIntegration } from './forge-integration.js';
import { FolderSelectionDialog } from './folder-selection-dialog.js';

export const TOKEN_BROWSER_VERSION = "0.0.1";

/**
 * Loading indicator utility for Token Browser
 */
class TokenBrowserLoadingIndicator {
  constructor() {
    this.isShowing = false;
    this.loadingElement = null;
    this.cancelled = false;
  }

  /**
   * Show loading indicator
   */
  show() {
    if (this.isShowing) return;
    
    this.isShowing = true;
    
    // Create loading notification (non-blocking)
    this.loadingElement = document.createElement('div');
    this.loadingElement.id = 'fa-token-browser-loading';
    this.loadingElement.innerHTML = `
      <div class="loading-content">
        <div class="loading-header">
          <button class="loading-cancel" title="Cancel loading">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="loading-text">Loading FA Token Browser...</div>
        <div class="loading-subtext">Fetching cloud tokens and initializing...</div>
        <div class="loading-spinner">
          <i class="fas fa-spinner"></i>
        </div>
      </div>
    `;
    
    document.body.appendChild(this.loadingElement);
    
    // Reset cancelled state when showing
    this.cancelled = false;
    
    // Add cancel button functionality
    const cancelButton = this.loadingElement.querySelector('.loading-cancel');
    if (cancelButton) {
      cancelButton.addEventListener('click', () => {
        console.log('fa-token-browser | Loading cancelled by user');
        this.cancelled = true;
        this.hide();
        // Show notification that loading was cancelled
        ui.notifications.info('FA Token Browser loading cancelled');
      });
    }
    
    // Animate in using CSS classes - MEMORY LEAK FIX: Store animation frame ID
    this._loadingAnimationId = requestAnimationFrame(() => {
      this.loadingElement.classList.add('visible');
      this._loadingAnimationId = null; // Clear after use
    });
  }

  /**
   * Hide loading indicator
   */
  hide() {
    if (!this.isShowing || !this.loadingElement) return;
    
    this.isShowing = false;
    
    // MEMORY LEAK FIX: Cancel any pending animation frame
    if (this._loadingAnimationId) {
      cancelAnimationFrame(this._loadingAnimationId);
      this._loadingAnimationId = null;
    }
    
    // Animate out using CSS classes
    this.loadingElement.classList.remove('visible');
    
    setTimeout(() => {
      if (this.loadingElement && this.loadingElement.parentNode) {
        this.loadingElement.parentNode.removeChild(this.loadingElement);
      }
      this.loadingElement = null;
    }, 300);
  }

  /**
   * Update loading text
   * @param {string} text - New loading text
   * @param {string} subtext - New loading subtext
   */
  updateText(text, subtext) {
    if (!this.loadingElement) return;
    
    const textElement = this.loadingElement.querySelector('.loading-text');
    const subtextElement = this.loadingElement.querySelector('.loading-subtext');
    
    if (textElement) textElement.textContent = text;
    if (subtextElement) subtextElement.textContent = subtext;
  }

  /**
   * Check if loading was cancelled by user
   * @returns {boolean} True if cancelled
   */
  wasCancelled() {
    return this.cancelled;
  }
}

// Global loading indicator instance
const tokenBrowserLoader = new TokenBrowserLoadingIndicator();

Hooks.once('init', async () => {


  // Initialize simple global object for macro support (preserve existing properties)
  window.faTokenBrowser = {
    ...window.faTokenBrowser, // Preserve existing properties like PatreonAuthService, PatreonOAuthApp
    openTokenBrowser: async () => {
      const existingApp = foundry.applications.instances.get('token-browser-app');
      if (existingApp) {
        existingApp.maximize();
        existingApp.bringToFront();
        return;
      }
      
      // Prevent multiple simultaneous openings
      if (tokenBrowserLoader.isShowing) {
        console.log('fa-token-browser | App is already loading, please wait...');
        return;
      }
      
      // Show loading indicator
      tokenBrowserLoader.show();
      
      try {
        // Create and render new app
        const app = new TokenBrowserApp();
        await app.render(true);
        
        // Check if user cancelled during loading
        if (tokenBrowserLoader.wasCancelled()) {
          console.log('fa-token-browser | App opened but loading was cancelled, closing...');
          app.close();
          return;
        }
        
        // Loading indicator will be hidden by the app's _onRender method
        // after all initialization is complete
      } catch (error) {
        console.error('fa-token-browser | Error opening Token Browser:', error);
        tokenBrowserLoader.hide();
        
        // Show error notification
        ui.notifications.error(`Failed to open FA Token Browser: ${error.message}`);
      }
    },
    version: TOKEN_BROWSER_VERSION
  };

  // Preload the templates
  await foundry.applications.handlebars.loadTemplates([
    'modules/fa-token-browser/templates/token-browser.hbs',
    'modules/fa-token-browser/templates/oauth-window.hbs',
    'modules/fa-token-browser/templates/token-update-confirm.hbs',
    'modules/fa-token-browser/templates/folder-selection-dialog.hbs'
  ]);

  // Register the actual folder data setting (hidden from UI)
  game.settings.register('fa-token-browser', 'customTokenFolders', {
    name: 'Custom Token Folders Data',
    scope: 'world',
    config: false, // Hidden from UI
    type: String,
    default: '[]',
    restricted: true,
    onChange: async value => {
      console.log('fa-token-browser | Custom Token Folders setting changed:', value);
      const existingApp = foundry.applications.instances.get('token-browser-app');
      if (existingApp) {
        console.log('fa-token-browser | Auto-refreshing Token Browser due to custom token folders change');

        // Preserve search state before refresh
        const currentSearchQuery = existingApp.searchManager?.searchQuery || '';

        // Refresh the app
        await existingApp.render(true);

        // Restore search state after refresh
        if (currentSearchQuery && existingApp.searchManager) {

          const searchInput = existingApp.element?.querySelector('#token-search');
          if (searchInput) {
            searchInput.value = currentSearchQuery;
            const wrapper = existingApp.element?.querySelector('.search-input-wrapper');
            if (wrapper) {
              wrapper.classList.add('has-text');
            }
            // Re-run the search with the restored query
            existingApp.searchManager.performSearch(currentSearchQuery);
          }
        }
      }
    }
  });

  // Register a menu setting for folder configuration
  game.settings.registerMenu('fa-token-browser', 'folderSelectionMenu', {
    name: 'Local Token Folders',
    label: 'Configure Sources',
    hint: 'Open the folder selection dialog to configure which folders contain your token images. In Local-Only mode, this is your primary token source.',
    icon: 'fas fa-folder',
    type: FolderSelectionDialog,
    restricted: true
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

  // Register show duplicates setting
  game.settings.register('fa-token-browser', 'showDuplicates', {
    name: 'Show Duplicate Tokens',
    hint: 'When disabled (default), only show one instance of each token when the same token exists in multiple sources (Cloud and Local). When enabled, show all instances.',
    scope: 'client',
    config: true, // Show in Game Settings UI
    type: Boolean,
    default: false,
    restricted: false,
    onChange: async value => {
      console.log('fa-token-browser | Show Duplicates setting changed:', value);
      // Auto-refresh the browser when the setting changes
      const existingApp = foundry.applications.instances.get('token-browser-app');
      if (existingApp) {
        console.log('fa-token-browser | Auto-refreshing Token Browser due to show duplicates change');

        // Preserve search state before refresh
        const currentSearchQuery = existingApp.searchManager?.searchQuery || '';

        // Refresh the app
        await existingApp.render(true);

        // Restore search state after refresh
        if (currentSearchQuery && existingApp.searchManager) {

          const searchInput = existingApp.element?.querySelector('#token-search');
          if (searchInput) {
            searchInput.value = currentSearchQuery;
            const wrapper = existingApp.element?.querySelector('.search-input-wrapper');
            if (wrapper) {
              wrapper.classList.add('has-text');
            }
            // Re-run the search with the restored query
            existingApp.searchManager.performSearch(currentSearchQuery);
          }
        }
      }
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

  // Register main color filter setting (hidden from UI, controlled by checkbox)
  game.settings.register('fa-token-browser', 'mainColorOnly', {
    name: 'Show Main Color Variants Only',
    scope: 'client',
    config: false, // Hidden from UI - controlled by checkbox
    type: Boolean,
    default: true, // Default to main colors only (variants panel mode)
    restricted: false
  });

  // Register hide locked filter setting (hidden from UI, controlled by checkbox)
  game.settings.register('fa-token-browser', 'hideLocked', {
    name: 'Hide Locked Tokens',
    scope: 'client',
    config: false, // Hidden from UI - controlled by checkbox
    type: Boolean,
    default: false, // Default to showing locked tokens
    restricted: false
  });

  // Register sort setting (hidden from UI, controlled by dropdown)
  game.settings.register('fa-token-browser', 'sortBy', {
    name: 'Sort Tokens By',
    scope: 'client',
    config: false, // Hidden from UI - controlled by dropdown
    type: String,
    default: 'default',
    restricted: false,
    choices: {
      'default': 'Default Sorting',
      'name': 'Sort by Name',
      'modified': 'Sort by Latest'
    }
  });



  // Register Patreon authentication data setting (hidden from UI, user-specific)
  // NOTE: Authentication is user-specific because server validates both auth state AND IP address
  // This prevents confusion where users see "authenticated" status but can't access premium tokens
  game.settings.register('fa-token-browser', 'patreon_auth_data', {
    name: 'Patreon Authentication Data',
    scope: 'client', // User-specific authentication (matches IP-based server validation)
    config: false, // Hidden from settings UI
    type: Object,
    default: null,
    restricted: false // Allow all users to store their own auth data
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

  // Register local-only mode setting
  game.settings.register('fa-token-browser', 'localOnlyMode', {
    name: 'Local-Only Mode',
    hint: 'Disable Cloud features for users who only want to use locally stored tokens.',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
    restricted: false,
    onChange: async value => {
      console.log('fa-token-browser | Local-Only Mode setting changed:', value);
      // Auto-refresh the browser when the setting changes
      const existingApp = foundry.applications.instances.get('token-browser-app');
      if (existingApp) {
        console.log('fa-token-browser | Auto-refreshing Token Browser due to local-only mode change');

        // Preserve search state before refresh
        const currentSearchQuery = existingApp.searchManager?.searchQuery || '';

        // Refresh the app
        await existingApp.render(true);

        // Restore search state after refresh
        if (currentSearchQuery && existingApp.searchManager) {

          const searchInput = existingApp.element?.querySelector('#token-search');
          if (searchInput) {
            searchInput.value = currentSearchQuery;
            const wrapper = existingApp.element?.querySelector('.search-input-wrapper');
            if (wrapper) {
              wrapper.classList.add('has-text');
            }
            // Re-run the search with the restored query
            existingApp.searchManager.performSearch(currentSearchQuery);
          }
        }
      }
    }
  });


  // Register Forge-specific settings
  ForgeIntegrationService.registerSettings();

    // Register canvas drop handler hook (only once)
  // Use Hooks.once to ensure it's only registered once even during dev reloads
  if (!window.faTokenBrowser.dropHandlerRegistered) {
    Hooks.on('dropCanvasData', async (canvas, data, event) => {
      return await TokenDragDropManager.handleCanvasDrop(canvas, data, event);
    });
    window.faTokenBrowser.dropHandlerRegistered = true;

  }

  // Initialize DSA5 scale restoration for supported systems
  ActorFactory._initializeDSA5ScaleFix();

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
      // Track loading state
      this._isInitialLoad = true;
      // Color variant panel reference
      this._activeVariantPanel = null;
      
      // Update Forge bucket choices when app opens
      forgeIntegration.updateForgeBucketChoices();
    }

    static DEFAULT_OPTIONS = {
      id: 'token-browser-app',
      tag: 'form',
      window: {
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

      // Set dynamic title based on local-only mode
      const localOnlyMode = game.settings.get('fa-token-browser', 'localOnlyMode') || false;
      defaultOptions.window.title = localOnlyMode ? 'Local Token Browser' : 'Token Browser';
      
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
      
      // MEMORY LEAK FIX: Force cleanup all CSS animations and transitions first
      this._forceCleanupAnimations();
      
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
      // Disconnect theme observer
      if (this._themeObserver) {
        try { this._themeObserver.disconnect(); } catch (e) {}
        this._themeObserver = null;
      }
      
      // Clean up preview manager
      if (this.previewManager) {
        this.previewManager.destroy();
      }
      
      // Clean up color variant panel
      this._hideColorVariantsPanel();
      
      // Clean up token data service (includes cache and cloud service cleanup)
      if (this.tokenDataService) {
        this.tokenDataService.destroy();
      }
      
      // MEMORY LEAK FIX: Clear large token arrays to prevent memory leaks
      this._allImages = [];
      this._displayedImages = [];
      
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
      
      // Apply theme class according to setting
      this._applyThemeMode();
      this._observeHostThemeChanges();

      // Add custom header elements (Patreon auth and stats)
      this._enhanceHeader(context);
      
      // Initialize preview manager
      this.previewManager.initialize();
      // Activate size selector
      this._activateSizeSelector();
      // Activate main color filter (pass context for hasColorVariants info)
      this._activateMainColorFilter(context);
      // Activate hide locked filter (only for non-authenticated users)
      if (!this.isAuthenticated) {
        this._activateHideLockedFilter();
      }
      // Setup right-click color variant functionality
      this._setupColorVariantRightClick();
      // Setup simple scroll-based lazy loading
      this.lazyLoadingManager.setupScrollLazyLoading();
      // Activate search functionality
      this.searchManager.activateSearch();
      // Setup hover previews
      this._setupHoverPreviews();
      // Setup drag and drop functionality
      this._setupDragAndDrop();
      
      // Hide loading indicator when app is fully rendered (only on initial load)
      if (this._isInitialLoad) {
        this._isInitialLoad = false;
        // Check if user cancelled before hiding loading indicator
        if (tokenBrowserLoader.wasCancelled()) {
          console.log('fa-token-browser | Render completed but loading was cancelled');
          tokenBrowserLoader.hide();
          // Close the app since user cancelled
          setTimeout(() => this.close(), 50);
          return;
        }
        // Use a small delay to ensure all UI elements are fully rendered
        setTimeout(() => {
          tokenBrowserLoader.hide();
        }, 600);
      }
    }



    /**
     * Apply theme mode classes to the app root
     */
    _applyThemeMode() {
      if (!this.element) return;
      const mode = this._getHostTheme();
      this.element.classList.remove('fa-theme-dark', 'fa-theme-light');
      if (mode === 'dark') this.element.classList.add('fa-theme-dark');
      if (mode === 'light') this.element.classList.add('fa-theme-light');
      // Sync active variant panel if present
      if (this._activeVariantPanel) {
        this._activeVariantPanel.classList.remove('fa-theme-dark', 'fa-theme-light');
        if (mode === 'dark') this._activeVariantPanel.classList.add('fa-theme-dark');
        if (mode === 'light') this._activeVariantPanel.classList.add('fa-theme-light');
      }
    }

    /**
     * Inspect Foundry UI container to determine current Applications theme
     * @returns {('dark'|'light')} current theme
     */
    _getHostTheme() {
      try {
        const apps = document.getElementById('ui-applications');
        if (apps) {
          if (apps.classList.contains('theme-dark')) return 'dark';
          if (apps.classList.contains('theme-light')) return 'light';
        }
        // Fallback: check body classes
        const body = document.body;
        if (body.dataset && typeof body.dataset.theme === 'string') {
          if (body.dataset.theme === 'dark') return 'dark';
          if (body.dataset.theme === 'light') return 'light';
        }
        if (body.classList.contains('theme-dark')) return 'dark';
        if (body.classList.contains('theme-light')) return 'light';
      } catch (e) {}
      return 'dark';
    }

    /**
     * Observe host theme changes and re-apply our theme instantly
     */
    _observeHostThemeChanges() {
      if (this._themeObserver) return; // already observing
      try {
        const callback = () => this._applyThemeMode();
        const observer = new MutationObserver(callback);
        observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
        this._themeObserver = observer;
      } catch (e) {}
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
      const localOnlyMode = game.settings.get('fa-token-browser', 'localOnlyMode') || false;
      titleTextSpan.textContent = localOnlyMode ? 'Local Token Browser' : 'Token Browser';
      titleElement.appendChild(titleTextSpan);

      // Add token stats for both cloud and local-only modes
      if (localOnlyMode && context.localTokenCount >= 0) {
        // Show local-only stats
        const statsSpan = document.createElement('span');
        statsSpan.className = 'title-stats';
        statsSpan.innerHTML = ` ( ${context.localTokenCount} local Tokens )`;
        titleElement.appendChild(statsSpan);
      } else if (!localOnlyMode && context.cloudTokenCount > 0 && context.localTokenCount >= 0) {
        // Show combined cloud + local stats
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

      // Skip Patreon auth UI in local-only mode
      const localOnlyMode = game.settings.get('fa-token-browser', 'localOnlyMode') || false;
      if (localOnlyMode) {
        return;
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
        
        // Attach comprehensive event handlers for disconnect functionality
        const handleDisconnect = (event) => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          console.log('fa-token-browser | Patreon disconnect button clicked');
          this.patreonAuth.handlePatreonDisconnect(this, true); // Show confirmation for manual disconnect
        };
        
        // Prevent header drag on all mouse events
        const preventHeaderDrag = (event) => {
          event.stopPropagation();
          event.stopImmediatePropagation();
        };
        
        statusDisplay.addEventListener('click', handleDisconnect);
        statusDisplay.addEventListener('mousedown', preventHeaderDrag);
        statusDisplay.addEventListener('pointerdown', preventHeaderDrag);
        statusDisplay.style.cursor = 'pointer';
        statusDisplay.style.pointerEvents = 'auto';
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
        
        // Attach comprehensive event handlers for connect functionality
        const handleConnect = async (event) => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          console.log('fa-token-browser | Patreon connect button clicked');
          try {
            await this.patreonAuth.handlePatreonConnect(this);
          } catch (error) {
            console.error('fa-token-browser | Error in Patreon connect handler:', error);
            ui.notifications.error(`Failed to connect to Patreon: ${error.message}`);
          }
        };
        
        // Prevent header drag on all mouse events
        const preventHeaderDrag = (event) => {
          event.stopPropagation();
          event.stopImmediatePropagation();
        };
        
        connectBtn.addEventListener('click', handleConnect);
        connectBtn.addEventListener('mousedown', preventHeaderDrag);
        connectBtn.addEventListener('pointerdown', preventHeaderDrag);
        connectBtn.style.pointerEvents = 'auto';
        
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
        // Parse folder configuration from JSON
        const customTokenFoldersData = game.settings.get('fa-token-browser', 'customTokenFolders') || '[]';
        let folderConfig = [];
        try {
          folderConfig = JSON.parse(customTokenFoldersData);
          if (!Array.isArray(folderConfig)) {
            folderConfig = [];
          }
        } catch (error) {
          console.warn('fa-token-browser | Error parsing folder configuration:', error);
          folderConfig = [];
        }

        // Extract folder paths and filter to only enabled folders
        const allFolderPaths = folderConfig.map(folder => folder.path).filter(path => path && path.length > 0);
        const customTokenFolders = this.tokenDataService.filterEnabledFolders(allFolderPaths);
        const customTokenFoldersString = customTokenFolders.join(', ');

        // Update loading progress during initial load
        if (this._isInitialLoad) {
          const localOnlyMode = game.settings.get('fa-token-browser', 'localOnlyMode') || false;
          const loadingText = localOnlyMode ? 'Loading FA Token Browser...' : 'Loading FA Token Browser...';
          const subText = localOnlyMode ? 'Initializing local tokens...' : 'Initializing local & cloud tokens...';
          tokenBrowserLoader.updateText(loadingText, subText);
        }

        // Check if loading was cancelled
        if (this._isInitialLoad && tokenBrowserLoader.wasCancelled()) {
          console.log('fa-token-browser | Data loading cancelled by user');
          throw new Error('Loading cancelled by user');
        }

        // Get combined local and cloud tokens using TokenDataService
        // Respect local-only mode setting
        const localOnlyMode = game.settings.get('fa-token-browser', 'localOnlyMode') || false;
        const combinedTokenData = await this.tokenDataService.getCombinedTokens(customTokenFolders, !localOnlyMode);
        
        // Check again after potentially long cloud token fetch
        if (this._isInitialLoad && tokenBrowserLoader.wasCancelled()) {
          console.log('fa-token-browser | Data processing cancelled by user');
          throw new Error('Loading cancelled by user');
        }
        
        // Update loading progress
        if (this._isInitialLoad) {
          const localOnlyMode = game.settings.get('fa-token-browser', 'localOnlyMode') || false;
          const loadingText = localOnlyMode ? 'Loading FA Token Browser...' : 'Loading FA Token Browser...';
          const subText = localOnlyMode ? 'Processing local token data...' : 'Processing token data...';
          tokenBrowserLoader.updateText(loadingText, subText);
        }
        
        // Convert TokenData to UI-compatible format for gradual migration
        const showDuplicates = game.settings.get('fa-token-browser', 'showDuplicates') || false;
        this._allImages = this.tokenDataService.convertTokenDataForUI(combinedTokenData, showDuplicates);
        
        // Get images to display based on search state
        const imagesToDisplay = this.searchManager.getImagesToDisplay(this._allImages);
        
        // Initialize with first batch using lazy loading manager
        this._displayedImages = this.lazyLoadingManager.initializeWithBatch(this._allImages, imagesToDisplay);
        
        // Count local vs cloud tokens for logging
        const localCount = this._allImages.filter(img => img.source === 'local').length;
        const cloudCount = this._allImages.filter(img => img.source === 'cloud').length;
        
        // Update loading progress
        if (this._isInitialLoad) {
          const localOnlyMode = game.settings.get('fa-token-browser', 'localOnlyMode') || false;
          if (localOnlyMode) {
            tokenBrowserLoader.updateText('FA Token Browser Ready!', `Found ${localCount} local tokens.`);
          } else {
            tokenBrowserLoader.updateText('FA Token Browser Ready!', `Found ${localCount} local and ${cloudCount} cloud tokens.`);
          }
        }
        
        const searchContext = this.searchManager.getSearchContext();
        
        // Get authentication data for template
        const authData = game.settings.get('fa-token-browser', 'patreon_auth_data');
        const isAuthenticated = authData && authData.authenticated;
        const userTier = isAuthenticated ? authData.tier : null;
        
        // Check if color variants are available (simplified logic)
        const hasColorVariants = this._hasColorVariantsAvailable();
        
        return {
          images: this._displayedImages,
          customTokenFolders,
          customTokenFoldersString,
          cloudTokenCount: cloudCount,
          localTokenCount: localCount,
          // Auth context for template
          isAuthenticated,
          userTier,
          // Color variants availability for template
          hasColorVariants,
          ...searchContext
        };
      } catch (error) {
        console.error("TokenBrowserApp _prepareContext error:", error);
        
        // Hide loading indicator on error during initial load
        if (this._isInitialLoad) {
          this._isInitialLoad = false;
          tokenBrowserLoader.hide();
        }
        
        // Don't show error notification if user cancelled
        if (error.message === 'Loading cancelled by user') {
          console.log('fa-token-browser | _prepareContext cancelled by user, skipping error display');
        }
        
        return {
          images: [],
          customTokenFolders: [],
          customTokenFoldersString: '',
          cloudTokenCount: 0,
          localTokenCount: 0,
          totalImages: 0,
          hasMore: false,
          searchQuery: '',
          error: error.message,
          // Auth context for error case
          isAuthenticated: false,
          userTier: null,
          // Color variants availability for error case
          hasColorVariants: false
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

      // Find all token items with this filename (main window and variant panels)
      const mainTokens = this.element.querySelectorAll(`[data-filename="${filename}"]`);
      const variantTokens = this._activeVariantPanel ? 
        this._activeVariantPanel.querySelectorAll(`[data-filename="${filename}"]`) : [];
      
      const tokenItems = [...mainTokens, ...variantTokens];
      
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
            // MEMORY LEAK FIX: Store animation frame ID for cleanup
            grid._feedbackAnimationId = requestAnimationFrame(() => {
              grid.style.opacity = '1';
              grid._feedbackAnimationId = null; // Clear after use
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
            
            // Apply the size change with requestAnimationFrame for better performance - MEMORY LEAK FIX: Store IDs
            grid._sizeAnimationId1 = requestAnimationFrame(() => {
              grid.setAttribute('data-thumbnail-size', newSize);
              
              // Batch the restoration
              grid._sizeAnimationId2 = requestAnimationFrame(() => {
                grid.style.transform = 'scale(1)';
                grid.style.opacity = '1';
                // Clear both IDs after completion
                grid._sizeAnimationId1 = null;
                grid._sizeAnimationId2 = null;
              });
            });
          }
        };
        
        this.eventManager.registerSizeButtonHandler(button, handler);
      });
    }

    /**
     * Activate the main color filter checkbox
     * @param {Object} context - The template context containing hasColorVariants flag
     */
    _activateMainColorFilter(context) {
      const checkbox = this.element.querySelector('#main-color-only');
      
      if (!checkbox) return;

      // Get color variants availability from context
      const hasColorVariants = context?.hasColorVariants ?? false;

      // Load and apply saved main color filter state
      const savedState = game.settings.get('fa-token-browser', 'mainColorOnly');
      checkbox.checked = savedState;

      // If no color variants available, disable the checkbox and uncheck it
      if (!hasColorVariants) {
        checkbox.disabled = true;
        checkbox.checked = false;
        // Also save the disabled state to settings
        game.settings.set('fa-token-browser', 'mainColorOnly', false);
        console.log('fa-token-browser | No color variants available, disabling variants checkbox');
        return;
      }

      const handler = (event) => {
        const isChecked = event.target.checked;
        
        // Save the new main color filter state to settings
        game.settings.set('fa-token-browser', 'mainColorOnly', isChecked);
        
        // Regenerate the grid with the new filter
        this.searchManager.regenerateGrid();
        
        console.log(`fa-token-browser | Color variants on right click ${isChecked ? 'enabled' : 'disabled'}`);
      };
      
      // Register event handler
      this.eventManager.registerMainColorFilterHandler(checkbox, handler);
    }

    /**
     * Activate the hide locked filter checkbox
     */
    _activateHideLockedFilter() {
      const checkbox = this.element.querySelector('#hide-locked');
      
      if (!checkbox) return;

      // Load and apply saved hide locked filter state
      const savedState = game.settings.get('fa-token-browser', 'hideLocked');
      checkbox.checked = savedState;

      const handler = (event) => {
        const isChecked = event.target.checked;
        
        // Save the new hide locked filter state to settings
        game.settings.set('fa-token-browser', 'hideLocked', isChecked);
        
        // Regenerate the grid with the new filter
        this.searchManager.regenerateGrid();
        
        console.log(`fa-token-browser | Hide locked tokens ${isChecked ? 'enabled' : 'disabled'}`);
      };
      
      // Register event handler
      this.eventManager.registerHideLockedFilterHandler(checkbox, handler);
    }

    /**
     * Update the checkbox state based on currently available images
     */
    _updateColorVariantsCheckboxState() {
      const checkbox = this.element.querySelector('#main-color-only');
      if (!checkbox) return;

      const hasColorVariants = this._hasColorVariantsAvailable();

      const label = this.element.querySelector('.main-color-checkbox');
      
      if (!hasColorVariants) {
        checkbox.disabled = true;
        checkbox.checked = false;
        if (label) {
          label.classList.add('disabled');
        }
        // Also save the disabled state to settings
        game.settings.set('fa-token-browser', 'mainColorOnly', false);
      } else {
        checkbox.disabled = false;
        if (label) {
          label.classList.remove('disabled');
        }
        // Restore saved state when variants become available
        const savedState = game.settings.get('fa-token-browser', 'mainColorOnly');
        checkbox.checked = savedState;
      }
    }

    /**
     * Check if color variants are available (updated for premium visibility)
     * @returns {boolean} True if color variants feature should be enabled
     */
    _hasColorVariantsAvailable() {
      // Get local tokens count
      const localTokenCount = this._allImages.filter(img => img.source === 'local').length;
      
      // Get cloud tokens count (both free and premium)
      const cloudTokenCount = this._allImages.filter(img => img.source === 'cloud').length;
      
      // Color variants are available if:
      // 1. User has local tokens loaded (may have custom variants), OR
      // 2. User has cloud tokens loaded (both free and premium tokens may have variants)
      //    Even non-authenticated users can see premium tokens now, so variants should be available
      const hasVariants = localTokenCount > 0 || cloudTokenCount > 0;
      
      // Get authentication status for logging
      const authData = game.settings.get('fa-token-browser', 'patreon_auth_data');
      const isAuthenticated = authData && authData.authenticated;
      
      console.log(`fa-token-browser | Color variants check: authenticated=${isAuthenticated}, localTokens=${localTokenCount}, cloudTokens=${cloudTokenCount}, enabled=${hasVariants}`);
      
      return hasVariants;
    }

    /**
     * Setup right-click color variant functionality
     */
    _setupColorVariantRightClick() {
      const grid = this.element.querySelector('.token-grid');
      if (!grid) return;

      const contextMenuHandler = (event) => {
        // Only handle right-click on token items when main color filter is active
        const mainColorOnly = game.settings.get('fa-token-browser', 'mainColorOnly');
        if (!mainColorOnly) return;

        const tokenItem = event.target.closest('.token-item');
        if (!tokenItem) return;

        event.preventDefault();
        event.stopPropagation();

        // Hide any active preview to prevent it getting stuck
        this.previewManager.hidePreview();

        const filename = tokenItem.getAttribute('data-filename');
        if (!filename) return;

        // Detect color variant information
        const variantInfo = detectColorVariant(filename);
        if (!variantInfo.hasColorVariant) {
          ui.notifications.info('This token has no color variants.');
          return;
        }

        // Check if variants panel is already open for this same token
        if (this._activeVariantPanel) {
          const currentVariantBase = this._activeVariantPanel._baseNameWithoutVariant;
          if (currentVariantBase === variantInfo.baseNameWithoutVariant) {
            // Same token - close the panel instead of refreshing
            this._hideColorVariantsPanel();
            return;
          }
        }

        // Get all color variants for this token
        const colorVariants = getColorVariants(variantInfo.baseNameWithoutVariant, this._allImages);
        
        if (colorVariants.length <= 1) {
          ui.notifications.info('This token has no other color variants.');
          return;
        }

        // Show color variants (expand next to token or fallback to search)
        this._showColorVariantsExpanded(tokenItem, variantInfo.baseNameWithoutVariant, colorVariants);
      };

      // Register the context menu handler
      this.eventManager.registerContextMenuHandler(grid, contextMenuHandler);
    }

    /**
     * Show color variants in an expanded view next to the token
     * @param {HTMLElement} tokenItem - The right-clicked token element
     * @param {string} baseNameWithoutVariant - Base token name without color variant
     * @param {Array} colorVariants - Array of color variant data
     */
    _showColorVariantsExpanded(tokenItem, baseNameWithoutVariant, colorVariants) {
      // Remove any existing variant panel
      this._hideColorVariantsPanel();
      
      // Check authentication status for variant panel
      const authData = game.settings.get('fa-token-browser', 'patreon_auth_data');
      const isAuthenticated = authData && authData.authenticated;
      
      // Create variant panel
      const variantPanel = document.createElement('div');
      variantPanel.className = 'color-variants-panel';
      // Propagate theme to variants panel
      try {
        const mode = this._getHostTheme();
        if (mode === 'dark') variantPanel.classList.add('fa-theme-dark');
        if (mode === 'light') variantPanel.classList.add('fa-theme-light');
      } catch (e) {}
      variantPanel.innerHTML = `
        <div class="variant-header">
          <span class="variant-title">${baseNameWithoutVariant}</span>
          <button class="variant-close" title="Close">×</button>
        </div>
        <div class="variant-grid"></div>
      `;
      
      const variantGrid = variantPanel.querySelector('.variant-grid');
      
      // Create thumbnail for each color variant (make them work like real token items)
      colorVariants.forEach(variant => {
        const variantItem = document.createElement('div');
        
        // Check if this variant is a locked premium token
        const isPremiumToken = variant.imageData.source === 'cloud' && variant.imageData.tier === 'premium';
        const isLockedToken = isPremiumToken && !isAuthenticated && !variant.imageData.isCached;
        const isCloudToken = variant.imageData.source === 'cloud';
        
        let className = 'token-base token-item variant-item';
        if (isCloudToken) {
          className += ' cloud-token';
        }
        if (isLockedToken) {
          className += ' locked-token';
        }
        variantItem.className = className;
        
        variantItem.setAttribute('data-filename', variant.filename);
        variantItem.setAttribute('data-path', variant.imageData.path);
        variantItem.setAttribute('data-source', variant.imageData.source);
        if (variant.imageData.tier) {
          variantItem.setAttribute('data-tier', variant.imageData.tier);
        }
        
        // Set draggable state based on lock status
        if (isLockedToken) {
          variantItem.setAttribute('draggable', 'false');
          variantItem.style.cursor = 'not-allowed';
        } else {
          variantItem.setAttribute('draggable', 'true');
        }
        
        // Store the imageData directly on the element for hover preview
        // Convert UI format back to TokenData format using the stored _tokenData
        variantItem._variantImageData = variant.imageData;
        variantItem._variantTokenData = variant.imageData._tokenData;
        
        // Build status icon HTML based on token source and cache status
        let statusIconHTML = '';
        if (variant.imageData.source === 'cloud') {
          if (variant.imageData.isCached) {
            statusIconHTML = `
              <div class="token-status-icon cached-cloud" title="Cloud token (cached locally)">
                <i class="fas fa-cloud-check"></i>
              </div>`;
          } else if (variant.imageData.tier === 'premium') {
            if (isAuthenticated) {
              statusIconHTML = `
                <div class="token-status-icon premium-cloud" title="Premium cloud token">
                  <i class="fas fa-cloud-plus"></i>
                </div>`;
            } else {
              statusIconHTML = `
                <div class="token-status-icon premium-cloud locked" title="Premium cloud token (authentication required)">
                  <i class="fas fa-lock"></i>
                </div>`;
            }
          } else {
            statusIconHTML = `
              <div class="token-status-icon free-cloud" title="Free cloud token">
                <i class="fas fa-cloud"></i>
              </div>`;
          }
        } else {
          statusIconHTML = `
            <div class="token-status-icon local-storage" title="Local storage">
              <i class="fas fa-folder"></i>
            </div>`;
        }

        variantItem.innerHTML = `
          <div class="token-thumbnail">
            <img src="${variant.imageData.url}" alt="${variant.filename}" />
            <div class="variant-number">${variant.colorVariant}</div>
          </div>
          ${statusIconHTML}
        `;
        
        variantGrid.appendChild(variantItem);
      });
      
      // Set up drag & drop and hover previews for variant items
      this._setupVariantInteractions(variantPanel);
      
      // Add close button handler
      const closeBtn = variantPanel.querySelector('.variant-close');
      closeBtn.addEventListener('click', () => {
        this._hideColorVariantsPanel();
      });
      
      // Position panel next to the token
      this._positionVariantPanel(variantPanel, tokenItem);
      
      // Add to document
      document.body.appendChild(variantPanel);
      this._activeVariantPanel = variantPanel;
      
      // Store the base name for toggle comparison
      variantPanel._baseNameWithoutVariant = baseNameWithoutVariant;
      
      // Show with animation - MEMORY LEAK FIX: Store animation frame ID
      const showAnimationId = requestAnimationFrame(() => {
        variantPanel.classList.add('visible');
        variantPanel._showAnimationId = null; // Clear after use
      });
      variantPanel._showAnimationId = showAnimationId;
      
      // Add click outside to close
      setTimeout(() => {
        const closeOnClickOutside = (event) => {
          if (!variantPanel.contains(event.target)) {
            this._hideColorVariantsPanel();
            document.removeEventListener('click', closeOnClickOutside);
          }
        };
        document.addEventListener('click', closeOnClickOutside);
        // Store reference for cleanup
        variantPanel._clickOutsideHandler = closeOnClickOutside;
      }, 100);
    }

    /**
     * Set up drag & drop and hover interactions for variant items
     * @param {HTMLElement} variantPanel - The variant panel element
     */
    _setupVariantInteractions(variantPanel) {
      const variantItems = variantPanel.querySelectorAll('.token-item');
      
      // Set up drag & drop for each variant item
      variantItems.forEach(variantItem => {
        // Register with drag drop manager for proper drag functionality
        if (this.dragDropManager) {
          this.dragDropManager.registerTokenWithObserver(variantItem);
        }
      });

      // Set up Foundry DragDrop system for the variants grid (same as main window)
      const variantGrid = variantPanel.querySelector('.variant-grid');
      if (variantGrid) {
        // Create DragDrop instance for variants panel using Foundry's system
        const variantDragDrop = new foundry.applications.ux.DragDrop({
          dragSelector: '.token-item:not(.locked-token)',
          dropSelector: null, // We don't handle drops in variants panel
          permissions: {
            // Allow all drag starts - we'll check authentication in the callback
            dragstart: () => true,
            drop: () => false
          },
          callbacks: {
            dragstart: async (event) => {
              const variantItem = event.currentTarget;
              
              // Override _getTokenDataFromElement temporarily for variant items
              const originalGetTokenData = this.dragDropManager._getTokenDataFromElement;
              this.dragDropManager._getTokenDataFromElement = (element) => {
                if (element === variantItem && variantItem._variantTokenData) {
                  return variantItem._variantTokenData;
                }
                return originalGetTokenData.call(this.dragDropManager, element);
              };
              
              // Use the main drag drop manager's _onDragStart method with variant context
              try {
                const result = await this.dragDropManager._onDragStart(event);
                
                // Ensure drag state is set (backup in case main method didn't set it)
                if (result !== false) {
                  const { TokenDragDropManager } = await import('./token-dragdrop-manager.js');
                  TokenDragDropManager._isTokenBrowserDragActive = true;
                  TokenDragDropManager._currentDragData = result;
                }
                
                // Hide variants panel after a short delay to allow drag to start properly
                // Immediate hiding can interrupt HTML5 drag & drop
                if (result !== false) {
                  setTimeout(() => {
                    this._hideColorVariantsPanel();
                  }, 100);
                }
                
                return result;
              } finally {
                // Restore original method
                this.dragDropManager._getTokenDataFromElement = originalGetTokenData;
              }
            }
          }
        });
        
        // Bind the DragDrop system to the variants grid
        variantDragDrop.bind(variantGrid);
        
        // Store reference for cleanup
        variantPanel._variantDragDrop = variantDragDrop;
        
        // Set up hover previews AND drag preloading using the same system as main grid
        const mouseEnterHandler = (event) => {
          const tokenItem = event.target?.closest('.token-item');
          if (!tokenItem) return;
          
          // Prevent multiple triggers on the same token
          if (tokenItem._previewActive) return;
          tokenItem._previewActive = true;

          // Cancel any pending cleanup since user is hovering again
          if (tokenItem._cleanupTimeout) {
            this.eventManager.clearTimeout(tokenItem._cleanupTimeout);
            tokenItem._cleanupTimeout = null;
          }

          // Override _getTokenDataFromElement temporarily for preloading
          const originalGetTokenData = this.dragDropManager._getTokenDataFromElement;
          this.dragDropManager._getTokenDataFromElement = (element) => {
            if (element === tokenItem && tokenItem._variantTokenData) {
              return tokenItem._variantTokenData;
            }
            return originalGetTokenData.call(this.dragDropManager, element);
          };
          
          // Start preloading immediately but don't enable dragging yet (same as main grid)
          this.dragDropManager.preloadDragImage(tokenItem).catch(error => {
            console.warn('fa-token-browser | Failed to preload drag image in variant panel:', error);
          }).finally(() => {
            // Check if preload is ready and enable dragging BEFORE restoring the override
            // This ensures _getTokenDataFromElement works correctly for cached token detection
            this.dragDropManager.checkAndEnableDragging(tokenItem);
            
            
            // Restore original method
            this.dragDropManager._getTokenDataFromElement = originalGetTokenData;
          });
          
          const img = tokenItem.querySelector('img');
          if (!img) return;
          
          // Get TokenData for enhanced preview - use stored variant TokenData or fallback to search
          let tokenData = tokenItem._variantTokenData;
          if (!tokenData) {
            const filename = tokenItem.getAttribute('data-filename');
            const uiToken = this._allImages?.find(token => token.filename === filename);
            tokenData = uiToken ? this.tokenDataService.getTokenDataFromUIObject(uiToken) : null;
          }
          
          this.previewManager.showPreviewWithDelay(img, tokenItem, 400, tokenData);
        };

        const mouseLeaveHandler = (event) => {
          const tokenItem = event.target?.closest('.token-item');
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

        variantGrid.addEventListener('mouseenter', mouseEnterHandler, true);
        variantGrid.addEventListener('mouseleave', mouseLeaveHandler, true);
        
        // Store handlers for cleanup
        variantPanel._mouseEnterHandler = mouseEnterHandler;
        variantPanel._mouseLeaveHandler = mouseLeaveHandler;
      }
    }

    /**
     * Position the variant panel next to the token
     * @param {HTMLElement} variantPanel - The variant panel element
     * @param {HTMLElement} tokenItem - The token element
     */
    _positionVariantPanel(variantPanel, tokenItem) {
      const tokenRect = tokenItem.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // Default positioning to the right of the token
      let left = tokenRect.right + 10;
      let top = tokenRect.top;
      
      // Get more accurate panel dimensions
      const panelWidth = 300; // Fixed by CSS max-width
      // Estimate height based on number of variants (header + grid + padding)
      const variantCount = variantPanel.querySelectorAll('.variant-item').length;
      const itemsPerRow = Math.floor(panelWidth / 120); // ~120px per item including gap
      const rows = Math.ceil(variantCount / itemsPerRow);
      const panelHeight = Math.min(400, 80 + (rows * 120)); // Header + rows, max 400px
      
      if (left + panelWidth > viewportWidth - 20) {
        // Position to the left of the token
        left = tokenRect.left - panelWidth - 10;
      }
      
      // If still off-screen, center it
      if (left < 20) {
        left = Math.max(20, (viewportWidth - panelWidth) / 2);
      }
      
      // Adjust vertical position if needed (like hover previews)
      if (top + panelHeight > viewportHeight - 20) {
        // Keep at same level but constrain bottom edge to viewport
        // Add extra buffer for header and scrollbar visibility
        top = Math.max(20, viewportHeight - panelHeight - 70);
      }
      
      variantPanel.style.left = `${left}px`;
      variantPanel.style.top = `${top}px`;
    }

    /**
     * Force cleanup of all CSS animations and transitions 
     * @private
     */
    _forceCleanupAnimations() {
      if (!this.element) return;
      
      // Find all elements with potential animations/transitions and force-stop them
      const elementsWithAnimations = this.element.querySelectorAll('*');
      elementsWithAnimations.forEach(element => {
        // Force-stop any CSS transitions
        if (element.style.transition || getComputedStyle(element).transition !== 'all 0s ease 0s') {
          element.style.transition = 'none';
        }
        
        // Force-stop any CSS animations  
        if (element.style.animation || getComputedStyle(element).animation !== 'none') {
          element.style.animation = 'none';
        }
        
        // Remove common animation classes
        element.classList.remove('visible', 'skeleton-error-state', 'preloading');
        
        // Cancel any stored animation frame IDs
        if (element._animationFrameId) {
          cancelAnimationFrame(element._animationFrameId);
          element._animationFrameId = null;
        }
        if (element._showAnimationId) {
          cancelAnimationFrame(element._showAnimationId);
          element._showAnimationId = null;
        }
        
        // Cancel grid-specific animation frames (from size selector)
        if (element._feedbackAnimationId) {
          cancelAnimationFrame(element._feedbackAnimationId);
          element._feedbackAnimationId = null;
        }
        if (element._sizeAnimationId1) {
          cancelAnimationFrame(element._sizeAnimationId1);
          element._sizeAnimationId1 = null;
        }
        if (element._sizeAnimationId2) {
          cancelAnimationFrame(element._sizeAnimationId2);
          element._sizeAnimationId2 = null;
        }
      });
    }

    /**
     * Hide the color variants panel
     */
    _hideColorVariantsPanel() {
      if (this._activeVariantPanel) {
        // Store reference to current panel before clearing the active reference
        const panelToRemove = this._activeVariantPanel;
        this._activeVariantPanel = null; // Clear immediately to prevent race conditions
        
        // Clean up event handlers
        const variantGrid = panelToRemove.querySelector('.variant-grid');
        if (variantGrid && panelToRemove._mouseEnterHandler) {
          variantGrid.removeEventListener('mouseenter', panelToRemove._mouseEnterHandler, true);
          variantGrid.removeEventListener('mouseleave', panelToRemove._mouseLeaveHandler, true);
        }
        
        // Clean up drag drop registrations
        const variantItems = panelToRemove.querySelectorAll('.token-item');
        variantItems.forEach(item => {
          if (this.dragDropManager) {
            this.dragDropManager.cleanupTokenPreload(item);
          }
        });
        
        // MEMORY LEAK FIX: Cancel any pending animation frames
        if (panelToRemove._showAnimationId) {
          cancelAnimationFrame(panelToRemove._showAnimationId);
          panelToRemove._showAnimationId = null;
        }
        
        // MEMORY LEAK FIX: Clear CSS transitions and animations immediately
        panelToRemove.style.transition = 'none'; // Force-stop panel transitions
        panelToRemove.classList.remove('visible'); // Remove immediately, no animation
        
        // MEMORY LEAK FIX: Clean up image event handlers and animations in variant panel
        const variantTokenItems = panelToRemove.querySelectorAll('.token-item');
        variantTokenItems.forEach(tokenItem => {
          // Cancel token-level animation frames
          if (tokenItem._animationFrameId) {
            cancelAnimationFrame(tokenItem._animationFrameId);
            tokenItem._animationFrameId = null;
          }
          
          const img = tokenItem.querySelector('img');
          if (img) {
            img.style.transition = 'none'; // Force-stop transitions
            img.style.opacity = '';
            img.onload = null;
            img.onerror = null;
            img.src = ''; // Stop any pending loads
          }
        });
        
        // Clean up Foundry DragDrop instance
        if (panelToRemove._variantDragDrop) {
          // Note: Foundry's DragDrop doesn't have an explicit cleanup method
          // but removing the reference should be sufficient
          panelToRemove._variantDragDrop = null;
        }
        
        // Remove click outside handler if it exists
        if (panelToRemove._clickOutsideHandler) {
          document.removeEventListener('click', panelToRemove._clickOutsideHandler);
          panelToRemove._clickOutsideHandler = null;
        }
        
        // MEMORY LEAK FIX: Remove from DOM immediately (no animation delay)
        if (panelToRemove && panelToRemove.parentNode) {
          panelToRemove.parentNode.removeChild(panelToRemove);
        }
      }
    }



    /**
     * Show color variants by populating the search field (fallback method)
     * @param {string} baseNameWithoutVariant - Base token name without color variant
     * @param {Array} colorVariants - Array of color variant data
     */
    _showColorVariants(baseNameWithoutVariant, colorVariants) {
      const searchInput = this.element.querySelector('#token-search');
      if (!searchInput) return;

      // Clear the main color filter temporarily to show all variants
      const checkbox = this.element.querySelector('#main-color-only');
      if (checkbox) {
        checkbox.checked = false;
        game.settings.set('fa-token-browser', 'mainColorOnly', false);
      }

      // Populate search with base name (this will show all variants)
      searchInput.value = baseNameWithoutVariant;
      
      // Update UI state
      const wrapper = this.element.querySelector('.search-input-wrapper');
      if (wrapper) {
        wrapper.classList.add('has-text');
      }
      
      // Perform the search
      this.searchManager.performSearch(baseNameWithoutVariant);
      
      // Show notification
      ui.notifications.info(`Showing ${colorVariants.length} color variants for "${baseNameWithoutVariant}"`);
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


Hooks.on('renderActorDirectory', (_, html) => {
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




