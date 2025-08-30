/**
 * FolderSelectionDialog - User-friendly interface for selecting multiple token folders
 */

const { HandlebarsApplicationMixin } = foundry.applications.api;

export class FolderSelectionDialog extends HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.selectedFolders = [];

    // Initialize handler references for cleanup
    this._boundAddFolderHandler = null;
    this._boundCheckboxHandlers = null;
    this._boundLabelHandlers = null;
    this._boundRemoveHandlers = null;
    this._boundEditHandlers = null;
    this._boundSaveHandler = null;
    this._boundCancelHandler = null;

    this.initializeFolders();
  }

  static DEFAULT_OPTIONS = {
    id: 'folder-selection-dialog',
    tag: 'form',
    window: {
      frame: true,
      positioned: true,
      resizable: true,
      title: 'Local Token Folders Config'
    },
    position: {
      width: 600,
      height: 500
    }
  };

  static PARTS = {
    form: {
      template: 'modules/fa-token-browser/templates/folder-selection-dialog.hbs'
    }
  };

  /**
   * Initialize folders from current settings
   */
  initializeFolders() {
    try {
      const folderData = game.settings.get('fa-token-browser', 'customTokenFolders') || '';
      if (folderData) {
        // Try to parse as JSON first (new format)
        try {
          const parsed = JSON.parse(folderData);
          if (Array.isArray(parsed)) {
            // Handle both old and new format
            this.selectedFolders = parsed.map(folder => {
              // Ensure backward compatibility - add enabled flag if missing
              return {
                path: folder.path,
                label: folder.label || folder.path.split('/').pop() || folder.path,
                enabled: folder.enabled !== undefined ? folder.enabled : true,
                customLabel: folder.customLabel || null
              };
            });
            return;
          }
        } catch (e) {
          // Fall back to comma-separated string format (legacy)
          this.selectedFolders = folderData
            .split(',')
            .map(folder => ({
              path: folder.trim(),
              label: folder.trim().split('/').pop() || folder.trim(),
              enabled: true,
              customLabel: null
            }))
            .filter(folder => folder.path.length > 0);
        }
      }
    } catch (error) {
      console.warn('fa-token-browser | Error initializing folders:', error);
      this.selectedFolders = [];
    }
  }

  /**
   * Prepare context for template rendering
   */
  async _prepareContext(options) {
    const enabledCount = this.selectedFolders.filter(folder => folder.enabled).length;

    return {
      folders: this.selectedFolders,
      hasFolders: this.selectedFolders.length > 0,
      enabledCount: enabledCount,
      totalCount: this.selectedFolders.length
    };
  }

  /**
   * Handle render event
   */
  _onRender(context, options) {
    super._onRender(context, options);
    this._activateEventListeners();
  }

  /**
   * Clean up event listeners when dialog closes
   */
  _onClose(options = {}) {
    // Clean up all event listeners to prevent memory leaks
    this._cleanupEventListeners();
    super._onClose(options);
  }

  /**
   * Clean up all event listeners
   */
  _cleanupEventListeners() {
    const form = this.element;
    if (!form) return;

    // Remove add folder button listener
    const addFolderBtn = form.querySelector('#add-folder-btn');
    if (addFolderBtn) {
      addFolderBtn.removeEventListener('click', this._boundAddFolderHandler);
    }

    // Remove checkbox listeners
    const checkboxes = form.querySelectorAll('.fa-token-browser-folder-checkbox');
    checkboxes.forEach((checkbox, index) => {
      checkbox.removeEventListener('change', this._boundCheckboxHandlers?.[index]);
    });

    // Remove label click listeners
    const labels = form.querySelectorAll('.fa-token-browser-folder-label');
    labels.forEach((label, index) => {
      label.removeEventListener('click', this._boundLabelHandlers?.[index]);
    });

    // Remove button listeners
    const removeButtons = form.querySelectorAll('.fa-token-browser-remove-folder-btn');
    removeButtons.forEach((button, index) => {
      button.removeEventListener('click', this._boundRemoveHandlers?.[index]);
    });

    const editButtons = form.querySelectorAll('.fa-token-browser-edit-folder-btn');
    editButtons.forEach((button, index) => {
      button.removeEventListener('click', this._boundEditHandlers?.[index]);
    });

    // Remove save/cancel listeners
    const saveBtn = form.querySelector('#save-folders-btn');
    if (saveBtn) {
      saveBtn.removeEventListener('click', this._boundSaveHandler);
    }

    const cancelBtn = form.querySelector('#cancel-folders-btn');
    if (cancelBtn) {
      cancelBtn.removeEventListener('click', this._boundCancelHandler);
    }

    // Clear handler references
    this._boundAddFolderHandler = null;
    this._boundCheckboxHandlers = null;
    this._boundLabelHandlers = null;
    this._boundRemoveHandlers = null;
    this._boundEditHandlers = null;
    this._boundSaveHandler = null;
    this._boundCancelHandler = null;
  }

  /**
   * Activate event listeners for the dialog
   */
  _activateEventListeners() {
    const form = this.element;

    // Initialize handler arrays
    this._boundCheckboxHandlers = [];
    this._boundLabelHandlers = [];
    this._boundRemoveHandlers = [];
    this._boundEditHandlers = [];

    // Add folder button
    const addFolderBtn = form.querySelector('#add-folder-btn');
    if (addFolderBtn) {
      this._boundAddFolderHandler = () => this._addFolder();
      addFolderBtn.addEventListener('click', this._boundAddFolderHandler);
    }

    // Folder enable/disable checkboxes
    const checkboxes = form.querySelectorAll('.fa-token-browser-folder-checkbox');
    checkboxes.forEach((checkbox, index) => {
      const handler = (event) => {
        const idx = parseInt(event.target.dataset.index);
        this._toggleFolderEnabled(idx, event.target.checked);
      };
      this._boundCheckboxHandlers[index] = handler;
      checkbox.addEventListener('change', handler);
    });

    // Folder label editing
    const labels = form.querySelectorAll('.fa-token-browser-folder-label');
    labels.forEach((label, index) => {
      const handler = (event) => {
        const idx = parseInt(event.target.dataset.index);
        this._editFolderLabel(idx);
      };
      this._boundLabelHandlers[index] = handler;
      label.addEventListener('click', handler);
    });

    // Remove folder buttons
    const removeButtons = form.querySelectorAll('.fa-token-browser-remove-folder-btn');
    removeButtons.forEach((button, index) => {
      const handler = (event) => {
        const idx = parseInt(event.target.dataset.index);
        this._removeFolder(idx);
      };
      this._boundRemoveHandlers[index] = handler;
      button.addEventListener('click', handler);
    });

    // Edit folder buttons
    const editButtons = form.querySelectorAll('.fa-token-browser-edit-folder-btn');
    editButtons.forEach((button, index) => {
      const handler = (event) => {
        const idx = parseInt(event.target.dataset.index);
        this._editFolder(idx);
      };
      this._boundEditHandlers[index] = handler;
      button.addEventListener('click', handler);
    });

    // Save button
    const saveBtn = form.querySelector('#save-folders-btn');
    if (saveBtn) {
      this._boundSaveHandler = () => this._saveFolders();
      saveBtn.addEventListener('click', this._boundSaveHandler);
    }

    // Cancel button
    const cancelBtn = form.querySelector('#cancel-folders-btn');
    if (cancelBtn) {
      this._boundCancelHandler = () => this.close();
      cancelBtn.addEventListener('click', this._boundCancelHandler);
    }
  }

  /**
   * Add a new folder
   */
  async _addFolder() {
    const FilePickerClass = globalThis.FilePicker || foundry.applications.apps.FilePicker;
    const filePicker = new FilePickerClass({
      type: 'folder',
      title: 'Select Token Folder',
      callback: (path) => {
        try {
          const activeSource = filePicker?.activeSource;
          // Prefix only for Bazaar; default sources (data/forgevtt) are implied by environment
          if (activeSource && (activeSource === 'forge-bazaar' || activeSource === 'bazaar') && !/^[^:]+:/.test(path)) {
            // Normalize by trimming any leading slash
            const normalized = path.startsWith('/') ? path.slice(1) : path;
            const source = activeSource === 'bazaar' ? 'forge-bazaar' : activeSource;
            path = `${source}:${normalized}`;
          }
        } catch (e) {
          // Non-fatal; keep original path
        }
        const folderName = path.split('/').pop() || path;
        this.selectedFolders.push({
          path: path,
          label: folderName,
          enabled: true,
          customLabel: null
        });
        this.render();
      }
    });
    filePicker.browse();
  }

  /**
   * Toggle folder enabled/disabled state
   */
  _toggleFolderEnabled(index, enabled) {
    if (index >= 0 && index < this.selectedFolders.length) {
      this.selectedFolders[index].enabled = enabled;
      this.render();
    }
  }

  /**
   * Edit folder label
   */
  _editFolderLabel(index) {
    if (index >= 0 && index < this.selectedFolders.length) {
      const folder = this.selectedFolders[index];
      const currentLabel = folder.customLabel || folder.label;

      // Create input field for editing
      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentLabel;
      input.className = 'fa-token-browser-folder-label-input';

      // Find the label element and replace it temporarily
      const labelElement = this.element.querySelector(`[data-index="${index}"].fa-token-browser-folder-label`);
      if (!labelElement) return;

      const originalContent = labelElement.textContent;
      labelElement.innerHTML = '';
      labelElement.appendChild(input);
      input.focus();
      input.select();

      // Handle save on Enter or blur
      const saveLabel = () => {
        const newLabel = input.value.trim();
        if (newLabel && newLabel !== currentLabel) {
          folder.customLabel = newLabel;
        } else if (!newLabel) {
          // If empty, remove custom label
          folder.customLabel = null;
        }
        this.render();
      };

      // Handle cancel on Escape
      const cancelEdit = () => {
        this.render();
      };

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          saveLabel();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelEdit();
        }
      });

      input.addEventListener('blur', saveLabel);
    }
  }

  /**
   * Edit an existing folder
   */
  async _editFolder(index) {
    const currentFolder = this.selectedFolders[index];
    if (!currentFolder) return;

    const FilePickerClass = globalThis.FilePicker || foundry.applications.apps.FilePicker;
    const filePicker = new FilePickerClass({
      type: 'folder',
      title: 'Select Token Folder',
      callback: (path) => {
        try {
          const activeSource = filePicker?.activeSource;
          if (activeSource && (activeSource === 'forge-bazaar' || activeSource === 'bazaar') && !/^[^:]+:/.test(path)) {
            const normalized = path.startsWith('/') ? path.slice(1) : path;
            const source = activeSource === 'bazaar' ? 'forge-bazaar' : activeSource;
            path = `${source}:${normalized}`;
          }
        } catch (e) {}
        const folderName = path.split('/').pop() || path;
        this.selectedFolders[index] = {
          path: path,
          label: folderName
        };
        this.render();
      }
    });
    filePicker.browse();
  }

  /**
   * Remove a folder
   */
  _removeFolder(index) {
    if (index >= 0 && index < this.selectedFolders.length) {
      this.selectedFolders.splice(index, 1);
      this.render();
    }
  }

  /**
   * Save the selected folders
   */
  _saveFolders() {
    try {
      // Save as JSON string for better structure
      const folderData = JSON.stringify(this.selectedFolders);
      game.settings.set('fa-token-browser', 'customTokenFolders', folderData);

      // Show success message
      ui.notifications.info(`Saved ${this.selectedFolders.length} token folder(s)`);

      // Close dialog
      this.close();

      // Note: Token browser will auto-refresh due to settings change
    } catch (error) {
      console.error('fa-token-browser | Error saving folders:', error);
      ui.notifications.error('Failed to save folder configuration');
    }
  }

  /**
   * Get folder paths as array (for compatibility with existing code)
   */
  getFolderPaths() {
    return this.selectedFolders.map(folder => folder.path);
  }

  /**
   * Get folder data as comma-separated string (for legacy compatibility)
   */
  getFoldersAsString() {
    return this.selectedFolders.map(folder => folder.path).join(', ');
  }
}
