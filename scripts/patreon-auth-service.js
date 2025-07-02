/**
 * PatreonOAuthApp - A Foundry ApplicationV2 for handling Patreon OAuth
 * Uses external window instead of iframe to avoid X-Frame-Options issues
 */
export class PatreonOAuthApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
    constructor(patreonAuthService, options = {}) {
        super(options);
        this.patreonAuthService = patreonAuthService;
        this.pollingInterval = null;
    }

    static DEFAULT_OPTIONS = {
        id: "patreon-oauth-app",
        tag: "div",
        window: {
            title: "Patreon Authentication",
            icon: "fas fa-user-shield",
            resizable: true
        },
        position: {
            width: 500,
            height: 450
        },
        classes: ["patreon-oauth"]
    };

    static PARTS = {
        form: {
            template: "modules/fa-token-browser/templates/oauth-window.hbs" 
        }
    };

    /**
     * @override
     * @param {boolean} initial
     * @param {object} context
     */
    async _onRender(initial, context) {
        await super._onRender(initial, context);
        
        // Add click handler for the Patreon auth button
        const authButton = this.element.querySelector('#start-auth-btn');
        if (authButton) {
            authButton.addEventListener('click', (event) => {
                event.preventDefault();
                this.openExternalAuth();
            });
        }
    }

    openExternalAuth() {
        const authUrl = this.patreonAuthService.getAuthUrl();
        
        // Get the pending state from the service
        const state = this.patreonAuthService._pendingState;
        if (!state) {
            this.handleAuthComplete(null, 'No state token found');
            return;
        }
        
        // Open external authentication window
        window.open(authUrl, '_blank');

        // Update UI to show waiting state
        const button = this.element.querySelector('#start-auth-btn');
        const status = this.element.querySelector('#auth-status');
        
        if (button) {
            button.disabled = true;
            button.textContent = 'Waiting for authentication...';
        }
        
        if (status) {
            status.textContent = 'Please complete authentication in the new tab and return here.';
            status.className = 'auth-status waiting';
        }

        // Start polling for authentication result
        this.startPolling(state);
    }

    /**
     * Start polling the n8n webhook endpoint to check for authentication results
     * @param {string} state - The state token to check for
     */
    startPolling(state) {
        // Clear any existing polling interval
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }

        // Set up polling configuration
        const pollUrl = 'https://n8n.forgotten-adventures.net/webhook/foundry-authcheck';
        const pollInterval = 3000; // Poll every 3 seconds
        const maxPollAttempts = 20; // Maximum 1 minute of polling (20 * 3 seconds)
        const gracePeriodAttempts = 5; // Treat "invalid state" as "not ready" for first 5 attempts (15 seconds)
        let pollAttempts = 0;

        // Add initial delay to allow database insert to complete and user to click auth button
        setTimeout(() => {
            this.pollingInterval = setInterval(async () => {
                pollAttempts++;

                try {
                    const response = await fetch(`${pollUrl}?state=${encodeURIComponent(state)}`, {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/json',
                        }
                    });

                    if (!response.ok) {
                        // Handle 400 errors (bad request/validation failures)
                        if (response.status === 400) {
                            // During grace period, treat "invalid state" as "not ready yet"
                            if (pollAttempts <= gracePeriodAttempts) {
                                try {
                                    const errorData = await response.json();
                                    const errorMessage = errorData.message || errorData.error || '';
                                    
                                    // If it's an "invalid state" error during grace period, continue polling
                                    if (errorMessage.toLowerCase().includes('invalid state')) {
                                        console.log(`fa-token-browser | Grace period: Invalid state (attempt ${pollAttempts}/${gracePeriodAttempts}), continuing...`);
                                        if (pollAttempts >= maxPollAttempts) {
                                            this.stopPolling();
                                            this.handleAuthComplete(null, 'Authentication timeout - please try again');
                                        }
                                        return;
                                    }
                                } catch (jsonError) {
                                    // If we can't parse JSON, treat as generic error
                                }
                            }
                            
                            // After grace period or non-state errors, stop polling and show error
                            this.stopPolling();
                            try {
                                const errorData = await response.json();
                                const errorMessage = errorData.message || errorData.error || 'Authentication failed - invalid request';
                                this.handleAuthComplete(null, errorMessage);
                            } catch (jsonError) {
                                this.handleAuthComplete(null, 'Authentication failed - invalid request');
                            }
                            return;
                        }
                        
                        // Handle 401 errors (authentication failures) - stop polling and extract error
                        if (response.status === 401) {
                            this.stopPolling();
                            try {
                                const errorData = await response.json();
                                const errorMessage = errorData.message || errorData.error || 'Authentication failed - insufficient access level';
                                this.handleAuthComplete(null, errorMessage);
                            } catch (jsonError) {
                                this.handleAuthComplete(null, 'Authentication failed - insufficient access level');
                            }
                            return;
                        }
                        
                        // If we get a 404, the auth hasn't completed yet
                        if (response.status === 404) {
                            if (pollAttempts >= maxPollAttempts) {
                                this.stopPolling();
                                this.handleAuthComplete(null, 'Authentication timeout - please try again');
                            }
                            return;
                        }
                        
                        // Other errors should stop polling
                        this.stopPolling();
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    const data = await response.json();

                    // Stop polling since we got a response
                    this.stopPolling();

                    if (data.success === "true") {
                        this.handleAuthComplete(data);
                    } else {
                        this.handleAuthComplete(null, data.error || 'Authentication failed');
                    }

                } catch (error) {
                    console.error('fa-token-browser | PatreonOAuthApp: Polling error:', error);
                    
                    // Stop polling on network errors after max attempts
                    if (pollAttempts >= maxPollAttempts) {
                        this.stopPolling();
                        this.handleAuthComplete(null, `Authentication failed: ${error.message}`);
                    }
                }
            }, pollInterval);
        }, 3000); // 3 second initial delay
    }

    /**
     * Stop the polling interval
     */
    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    /**
     * Handle authentication completion (success or failure)
     * @param {Object|null} authData - Authentication data from webhook (null for errors)
     * @param {string|null} errorMessage - Error message if authentication failed
     */
    async handleAuthComplete(authData = null, errorMessage = null) {
        const button = this.element.querySelector('#start-auth-btn');
        const status = this.element.querySelector('#auth-status');
        
        // Reset button state
        if (button) {
            button.disabled = false;
            button.textContent = '🔐 Start Authentication';
        }
        
        if (errorMessage) {
            // Handle error case
            console.error('fa-token-browser | Patreon authentication failed:', errorMessage);
            
            if (status) {
                status.textContent = `❌ Error: ${errorMessage}`;
                status.className = 'auth-status error';
            }
            
            ui.notifications.error(`❌ Authentication failed: ${errorMessage}`);
        } else {
            // Handle success case
            try {
                const result = await this.patreonAuthService.handleAuthResult(authData);
                
                if (status) {
                    status.textContent = `✅ Authenticated as ${result.tier} supporter!`;
                    status.className = 'auth-status success';
                }
                
                ui.notifications.info(`🎉 Authenticated as ${result.tier} supporter!`);
                
                // Close after a delay
                setTimeout(() => this.close(), 2000);
                
            } catch (error) {
                // If processing the success data fails, treat it as an error
                this.handleAuthComplete(null, error.message);
            }
        }
    }

    async close(options = {}) {
        // Stop polling
        this.stopPolling();
        
        // Notify the auth service that this window is closing
        // so it can clean up the main app polling as well
        if (this.patreonAuthService._activeOAuthWindow === this) {
            this.patreonAuthService._activeOAuthWindow = null;
            console.log('fa-token-browser | OAuth window closed, notifying auth service');
        }

        return super.close(options);
    }
}

/**
 * PatreonAuthService - Handles Patreon OAuth authentication flow
 * for cloud token access in Foundry VTT
 */
export class PatreonAuthService {
    constructor() {
        // OAuth configuration - only public values that are safe to expose
        this.config = {
            clientId: 'm5zOd0zkfYoQz9J8JuXTzN728poxUcYiShCBTVymi3D4AVawLvz_RjeugeLF2wY-',
            redirectUri: 'https://n8n.forgotten-adventures.net/webhook/patreonconnection-foundry',
            scopes: 'identity%20identity%5Bemail%5D%20identity.memberships', // URL encoded scopes
            authUrl: 'https://www.patreon.com/oauth2/authorize'
        };
        // Track active OAuth window and polling to prevent duplicates
        this._activeOAuthWindow = null;
        this._activePollingInterval = null;
        this._activePollingTimeout = null;
    }

    /**
     * @returns {string} UUID string for state parameter
     */
    static generateStateUUID() {
        return crypto.randomUUID();
    }

    /**
     * Get the complete Patreon authorization URL with state parameter
     * @returns {string} Complete authorization URL with state
     */
    getAuthUrl() {
        const state = PatreonAuthService.generateStateUUID();
        
        // Store the state token in the auth data temporarily
        this._pendingState = state;
        
        // Build complete authorization URL
        return `${this.config.authUrl}?response_type=code&client_id=${this.config.clientId}&redirect_uri=${encodeURIComponent(this.config.redirectUri)}&scope=${this.config.scopes}&state=${encodeURIComponent(state)}`;
    }

    /**
     * Handle authentication result from the webhook
     * This would typically be called after the user completes OAuth
     * This is strictly for UI purposes, the actual authentication is handled server side
     * @param {Object} authData - Authentication data from webhook
     * @returns {Promise<Object>} Processed authentication result
     */
    async handleAuthResult(authData) {
        try {
            
            // Store authentication data including the state for persistence
            const authResult = {
                authenticated: true,
                tier: authData.tier || 'unknown',
                timestamp: Date.now(),
                state: this._pendingState // Store the state that was used for this auth
            };

            // Store in Foundry settings for persistence
            await game.settings.set('fa-token-browser', 'patreon_auth_data', authResult);
            
            // Clear the pending state
            delete this._pendingState;
            
            console.log('fa-token-browser | Patreon authentication successful:', authResult);
            
            return authResult;
        } catch (error) {
            console.error('fa-token-browser | Patreon authentication failed:', error);
            
            // Clear any stored auth data on failure
            await game.settings.set('fa-token-browser', 'patreon_auth_data', null);
            delete this._pendingState;
            
            throw error;
        }
    }

    /**
     * Setup Patreon authentication UI and handlers for a token browser app
     * @param {Object} app - The token browser application instance
     * @deprecated This method is no longer used. Event handlers are now attached directly
     * in _addPatreonAuthToHeader() for better reliability and timing.
     */
    setupPatreonAuthUI(app) {
        // NOTE: Event handlers are now attached directly when buttons are created
        // in TokenBrowserApp._addPatreonAuthToHeader() to prevent timing issues
        // and ensure handlers persist through re-renders.
        console.warn('fa-token-browser | setupPatreonAuthUI is deprecated - event handlers attached directly in _addPatreonAuthToHeader');
    }

    /**
     * Update authentication UI based on current status
     * @param {Object} app - The token browser application instance
     */
    async updateAuthUI(app) {
        // Instead of manually manipulating DOM, trigger a full re-render
        // This ensures all UI elements (auth status, token counts, etc.) update properly
  
        try {
            await app.render();
        } catch (error) {
            console.error('fa-token-browser | Failed to re-render application after auth change:', error);
        }
    }

    /**
     * Clean up any active OAuth window and polling
     * @param {Object} app - The token browser application instance
     */
    _cleanupActiveAuth(app) {
        // Close existing OAuth window if open
        if (this._activeOAuthWindow && this._activeOAuthWindow.rendered) {
            try {
                this._activeOAuthWindow.close();
            } catch (error) {
                console.warn('fa-token-browser | Failed to close OAuth window:', error);
            }
        }
        this._activeOAuthWindow = null;
        
        // Clear polling interval
        if (this._activePollingInterval) {
            console.log('fa-token-browser | Cleaning up existing auth polling interval');
            app.eventManager.clearInterval(this._activePollingInterval);
            this._activePollingInterval = null;
        }
        
        // Clear polling timeout
        if (this._activePollingTimeout) {
            app.eventManager.clearTimeout(this._activePollingTimeout);
            this._activePollingTimeout = null;
        }
    }

    /**
     * Handle Patreon connect button click
     * @param {Object} app - The token browser application instance
     */
    async handlePatreonConnect(app) {
        try {
            console.log('fa-token-browser | Starting Patreon authentication...');
            
            // Clear any existing OAuth window and polling to prevent duplicates
            this._cleanupActiveAuth(app);
            
            const oauthApp = new PatreonOAuthApp(this);
            this._activeOAuthWindow = oauthApp;
            oauthApp.render(true);

            // Periodically check for authentication changes
            this._activePollingInterval = app.eventManager.createInterval(async () => {
                const authData = game.settings.get('fa-token-browser', 'patreon_auth_data');
                if (authData && authData.authenticated) {
                    console.log('fa-token-browser | Authentication detected, updating UI and refreshing tokens');
                    await this.updateAuthUI(app);
                    // Refresh tokens when authentication completes (only once)
                    await this.refreshTokens(app);
                    // Clean up after successful authentication
                    this._cleanupActiveAuth(app);
                }
            }, 1000);

            // Stop checking after a timeout
            this._activePollingTimeout = app.eventManager.createTimeout(() => {
                console.log('fa-token-browser | Auth polling timeout reached, cleaning up');
                this._cleanupActiveAuth(app);
            }, 300000); // 5 minutes

        } catch (error) {
            console.error('fa-token-browser | Failed to open Patreon authentication:', error);
            ui.notifications.error(`Failed to open authentication: ${error.message}`);
            // Clean up on error
            this._cleanupActiveAuth(app);
        }
    }

    /**
     * Refresh tokens after authentication changes
     * @param {Object} app - The token browser application instance
     */
    async refreshTokens(app) {
        try {
            // Prevent multiple simultaneous refreshes by checking if we already processed this auth
            const authData = game.settings.get('fa-token-browser', 'patreon_auth_data');
            const currentTime = Date.now();
            
            // Skip if we recently processed this authentication (within 5 seconds)
            if (this._lastRefreshTime && (currentTime - this._lastRefreshTime) < 5000) {
                console.log('fa-token-browser | Skipping duplicate token refresh');
                return;
            }
            
            this._lastRefreshTime = currentTime;
            
            // Show notification about token refresh
            if (authData && authData.authenticated) {
                ui.notifications.info("✅ Premium tokens loaded!");
            } else {
                ui.notifications.info("ℹ️ Switched to free tokens only");
            }
            
        } catch (error) {
            console.error('fa-token-browser | Failed to refresh tokens:', error);
            ui.notifications.error(`Failed to refresh tokens: ${error.message}`);
        }
    }

    /**
     * Handle Patreon disconnect (manual or automatic)
     * @param {Object} app - The token browser application instance
     * @param {boolean} [showConfirmation=false] - Whether to show confirmation dialog
     */
    async handlePatreonDisconnect(app, showConfirmation = false) {
        try {
            // Show confirmation dialog if requested (for manual disconnects)
            if (showConfirmation) {
                const confirmed = await foundry.applications.api.DialogV2.confirm({
                    window: { 
                        title: "Disconnect Patreon" 
                    },
                    content: `<p>Are you sure you want to disconnect your Patreon account?</p><p>You'll lose access to cloud tokens until you reconnect.</p>`,
                    modal: true,
                    rejectClose: false,
                    yes: { 
                        icon: "fas fa-sign-out-alt", 
                        label: "Disconnect" 
                    },
                    no: { 
                        icon: "fas fa-times", 
                        label: "Cancel" 
                    }
                });

                if (!confirmed) return;
            }

            // Clear authentication data
            await game.settings.set('fa-token-browser', 'patreon_auth_data', null);
            
            // Show appropriate notification
            if (showConfirmation) {
                ui.notifications.info("Disconnected from Patreon");
            }
            
            // Update UI
            await this.updateAuthUI(app);
            
            // Refresh to show only free tokens
            await this.refreshTokens(app);
            
            console.log('fa-token-browser | Patreon disconnected successfully');
            
        } catch (error) {
            console.error('fa-token-browser | Failed to disconnect Patreon:', error);
            ui.notifications.error(`Failed to disconnect: ${error.message}`);
        }
    }




}

 