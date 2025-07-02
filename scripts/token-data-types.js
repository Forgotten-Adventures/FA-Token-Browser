/**
 * TypeScript-style interfaces for Token Browser data structures
 * These define the unified data format for both local and cloud tokens
 */

/**
 * @typedef {Object} TokenUrls
 * @property {string} thumbnail - Thumbnail/grid display URL (local: same as full, cloud: CDN thumbnails)
 * @property {string} full - Full-resolution URL for both previews AND drag&drop (local: file path, cloud: CDN for free, signed for premium)
 */

/**
 * @typedef {Object} TokenMetadata
 * @property {number} fileSize - File size in bytes (from R2 database for cloud, file system for local)
 * @property {number} gridWidth - Grid squares (parsed from filename)
 * @property {number} gridHeight - Grid squares (parsed from filename)
 * @property {number} scale - Scale modifier (parsed from filename)
 * @property {Date} lastModified - From R2 database or file system
 * @property {number|null} width - Image pixel width (available from DOM after image loads)
 * @property {number|null} height - Image pixel height (available from DOM after image loads)
 */

/**
 * @typedef {Object} TokenCache
 * @property {boolean} isDownloaded - Is full file cached locally?
 * @property {string|null} localPath - Path to cached file if downloaded
 * @property {number|null} downloadedAt - When was it cached? (timestamp)
 * @property {number|null} lastAccessed - For LRU eviction (timestamp)
 */

/**
 * @typedef {Object} TokenData
 * @property {string} filename - Token filename (e.g., "dragon_large.png")
 * @property {string} path - Virtual path (local: actual file path, cloud: R2 path)
 * @property {'local'|'cloud'} source - Token source type
 * @property {TokenUrls} urls - URLs for different use cases
 * @property {TokenMetadata} metadata - Token metadata from various sources
 * @property {'free'|'premium'|null} tier - Cloud-specific tier (null for local tokens)
 * @property {TokenCache} cache - Cache status (for cloud tokens)
 */

/**
 * Token source types
 */
export const TOKEN_SOURCES = {
  LOCAL: 'local',
  CLOUD: 'cloud'
};

/**
 * Cloud token tiers
 */
export const TOKEN_TIERS = {
  FREE: 'free',
  PREMIUM: 'premium'
};

/**
 * Create a new TokenData object with default values
 * @param {Object} options - Token data options
 * @param {string} options.filename - Token filename
 * @param {string} options.path - Token path
 * @param {'local'|'cloud'} options.source - Token source
 * @param {Object} [options.metadata] - Additional metadata
 * @param {'free'|'premium'|null} [options.tier] - Cloud tier (null for local)
 * @returns {TokenData} New TokenData object
 */
export function createTokenData({
  filename,
  path,
  source,
  metadata = {},
  tier = null
}) {
  return {
    filename,
    path,
    source,
    urls: {
      thumbnail: null,
      full: null
    },
    metadata: {
      fileSize: metadata.fileSize || 0,
      gridWidth: metadata.gridWidth || 1,
      gridHeight: metadata.gridHeight || 1,
      scale: metadata.scale || 1.0,
      lastModified: metadata.lastModified || new Date(),
      width: metadata.width || null,
      height: metadata.height || null
    },
    tier,
    cache: {
      isDownloaded: false,
      localPath: null,
      downloadedAt: null,
      lastAccessed: null
    }
  };
}

/**
 * Validate TokenData object structure
 * @param {Object} tokenData - Token data to validate
 * @returns {boolean} True if valid
 */
export function isValidTokenData(tokenData) {
  if (!tokenData || typeof tokenData !== 'object') {
    return false;
  }
  
  const required = ['filename', 'path', 'source', 'urls', 'metadata', 'cache'];
  return required.every(prop => prop in tokenData);
}

/**
 * Check if token is a cloud token
 * @param {TokenData} tokenData - Token data
 * @returns {boolean} True if cloud token
 */
export function isCloudToken(tokenData) {
  return tokenData.source === TOKEN_SOURCES.CLOUD;
}

/**
 * Check if token is a local token
 * @param {TokenData} tokenData - Token data
 * @returns {boolean} True if local token
 */
export function isLocalToken(tokenData) {
  return tokenData.source === TOKEN_SOURCES.LOCAL;
}

 