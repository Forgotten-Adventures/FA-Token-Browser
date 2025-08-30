/**
 * LocalTokenService - Handles local file system token operations
 * Wraps existing local token logic in the new abstraction layer
 */

import { parseTokenSize } from './geometry.js';
import { createTokenData, TOKEN_SOURCES } from './token-data-types.js';
import { forgeIntegration } from './forge-integration.js';

export class LocalTokenService {
  constructor() {
  }

  /**
   * Recursively scan a Foundry data folder for token images.
   * Returns an array of { path, filename, url, type }.
   * @param {string} folder - path inside the Foundry data FS (e.g. 'tokens/Adversaries')
   * @returns {Promise<Array<{path:string,filename:string,url:string,type:string}>>}
   */
  async scanTokenFolder(folder) {
    if (!folder) {
      console.warn('fa-token-browser | scanTokenFolder: no folder selected');
      return [];
    }

    const manifest = [];
    const exts = ['.png', '.jpg', '.jpeg', '.webp'];
    const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;

    // Determine the correct FilePicker source and target path from the provided folder string
    const resolveSourceAndPath = (folderPath) => {
      let source = 'data';
      let target = folderPath;
      let options = {};

      if (!folderPath) return { source, target, options };

      // Normalize any "data:" prefix
      if (folderPath.startsWith('data:')) {
        target = folderPath.slice('data:'.length);
        return { source, target, options };
      }

      // Handle explicit protocol prefixes
      if (folderPath.startsWith('forgevtt:')) {
        source = 'forgevtt';
        target = folderPath.slice('forgevtt:'.length);
        options = forgeIntegration.getBucketOptions();
        return { source, target, options };
      }
      if (folderPath.startsWith('forge-bazaar:') || folderPath.startsWith('bazaar:')) {
        source = 'forge-bazaar';
        target = folderPath.replace(/^[^:]+:/, '');
        return { source, target, options };
      }

      // Handle Forge assets URLs
      const bazaarRe = /^https?:\/\/assets\.forge-vtt\.com\/bazaar\/assets\/(.+)$/i;
      const assetsRe = /^https?:\/\/assets\.forge-vtt\.com\/[^\/]+\/(.+)$/i; // accountId/<path>

      if (bazaarRe.test(folderPath)) {
        source = 'forge-bazaar';
        target = folderPath.replace(bazaarRe, 'assets/$1');
        return { source, target, options };
      }

      if (assetsRe.test(folderPath)) {
        source = 'forgevtt';
        target = folderPath.replace(assetsRe, '$1');
        options = forgeIntegration.getBucketOptions();
        return { source, target, options };
      }

      // Remove any leading slash to keep relative to source root
      if (target.startsWith('/')) target = target.slice(1);
      return { source, target, options };
    };

    const envDefaultSource = forgeIntegration.isRunningOnForge() ? 'forgevtt' : 'data';
    const resolved = resolveSourceAndPath(folder);
    const source = resolved.source || envDefaultSource;
    const target = resolved.target;
    const options = resolved.options || (source === 'forgevtt' ? forgeIntegration.getBucketOptions() : {});

    async function recurse(path) {
      let result;
      try {
        result = await FilePickerImpl.browse(source, path, options);
      } catch (err) {
        // Fallbacks: try alternate Forge sources if the first attempt fails
        try {
          if (source === 'forge-bazaar') {
            result = await FilePickerImpl.browse('bazaar', path, options);
          } else if (source === 'forgevtt') {
            result = await FilePickerImpl.browse('data', path);
          } else {
            throw err;
          }
        } catch (err2) {
          console.warn(`fa-token-browser | Error reading folder (${source}:${path})`, err2);
          return;
        }
      }
      for (const file of result.files) {
        const ext = file.split('.').pop().toLowerCase();
        if (ext && exts.includes(`.${ext}`)) {
          manifest.push({
            path: file,
            filename: file.split('/').pop(),
            url: file,
            fullUrl: file,
            type: ext,
            source: 'local' // Treat as local in the unified model
          });
        }
      }
      for (const dir of result.dirs) await recurse(dir);
    }

    await recurse(target);
    return manifest;
  }

  /**
   * Convert existing local token object to TokenData format
   * @param {Object} localToken - Local token object from scanTokenFolder
   * @returns {TokenData} Unified TokenData object
   */
  convertLocalToken(localToken) {
    // Parse grid dimensions from filename using existing logic
    const parsed = parseTokenSize(localToken.filename);
    
    // Create TokenData object
    const tokenData = createTokenData({
      filename: localToken.filename,
      path: localToken.path,
      source: TOKEN_SOURCES.LOCAL,
      metadata: {
        gridWidth: parsed.gridWidth,
        gridHeight: parsed.gridHeight,
        scale: parsed.scale,
        // File size and lastModified will be extracted later if needed
        fileSize: 0,
        lastModified: new Date()
      }
    });

    // For local tokens, thumbnail and full URLs are the same (the file path)
    tokenData.urls.thumbnail = localToken.url || localToken.path;
    tokenData.urls.full = localToken.url || localToken.path;

    return tokenData;
  }

  /**
   * Convert array of local tokens to TokenData format
   * @param {Array} localTokens - Array of local token objects
   * @returns {Array<TokenData>} Array of TokenData objects
   */
  convertLocalTokens(localTokens) {
    return localTokens.map(token => this.convertLocalToken(token));
  }

  /**
   * Get thumbnail URL for local token
   * @param {TokenData} tokenData - Token data
   * @returns {string} Thumbnail URL (same as full URL for local tokens)
   */
  getThumbnailURL(tokenData) {
    return tokenData.urls.thumbnail || tokenData.path;
  }

  /**
   * Get full URL for local token (used for both previews and drag & drop)
   * @param {TokenData} tokenData - Token data
   * @returns {string} Full URL (file path for local tokens)
   */
  getFullURL(tokenData) {
    return tokenData.urls.full || tokenData.path;
  }

  /**
   * Extract metadata from local token file
   * @param {TokenData} tokenData - Token data
   * @returns {Promise<Object>} Metadata object with file size and dimensions
   */
  async extractMetadata(tokenData) {
    try {
      // For local tokens, we'll rely on metadata from the file system
      // File size can be obtained when needed, but avoiding HEAD requests for now
      const metadata = {
        fileSize: tokenData.metadata.fileSize || 0, // Will be 0 if not available
        gridWidth: tokenData.metadata.gridWidth,
        gridHeight: tokenData.metadata.gridHeight,
        scale: tokenData.metadata.scale,
        lastModified: tokenData.metadata.lastModified,
        // Pixel dimensions will be available from DOM after image loads
        width: null,
        height: null
      };

      return metadata;
    } catch (error) {
      console.warn('fa-token-browser | Failed to extract local metadata:', error);
      return tokenData.metadata; // Return existing metadata as fallback
    }
  }

  /**
   * Format file size in human readable format (existing logic)
   * @param {number} bytes - File size in bytes
   * @returns {string} Formatted file size
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Check if local token file exists (simplified - assumes local files exist)
   * @param {TokenData} tokenData - Token data
   * @returns {Promise<boolean>} True (assumes local files exist if in manifest)
   */
  async fileExists(tokenData) {
    // For local tokens, if they're in our manifest, we assume they exist
    // This avoids HEAD requests and potential issues
    return true;
  }
} 