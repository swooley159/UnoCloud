/**
 * Application Constants
 */

// SharePoint limits
export const SHAREPOINT = {
  MAX_FILE_SIZE: 250 * 1024 * 1024 * 1024, // 250 GB
  MAX_PATH_LENGTH: 400,
  CHUNK_SIZE: 10 * 1024 * 1024, // 10 MB chunks for large file upload
  SMALL_FILE_THRESHOLD: 4 * 1024 * 1024, // 4 MB - files smaller use simple upload

  // Invalid characters in SharePoint file/folder names
  INVALID_CHARS: ['~', '#', '%', '&', '*', '{', '}', '\\', ':', '<', '>', '?', '/', '|', '"'],

  // Reserved names in SharePoint
  RESERVED_NAMES: [
    '.lock', 'CON', 'PRN', 'AUX', 'NUL',
    'COM0', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT0', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
    '_vti_', 'desktop.ini',
  ],
};

// Graph API
export const GRAPH_API = {
  BASE_URL: 'https://graph.microsoft.com/v1.0',
  SCOPES: ['https://graph.microsoft.com/.default'],

  // Rate limiting
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  MAX_RETRY_DELAY_MS: 30000,
};

// Default sync options
export const DEFAULT_SYNC_OPTIONS = {
  mode: 'incremental' as const,
  deleteAfterSync: false,
  preserveTimestamps: true,
  preserveFolderStructure: true,
  conflictResolution: 'skip' as const,
  maxConcurrentUploads: 3,
  retryAttempts: 3,
  retryDelayMs: 1000,
};

// Application paths
export const PATHS = {
  CONFIG_DIR: process.env.UNOCLOUD_CONFIG_DIR || '.unocloud',
  DATA_DIR: process.env.UNOCLOUD_DATA_DIR || '.unocloud/data',
  LOG_DIR: process.env.UNOCLOUD_LOG_DIR || '.unocloud/logs',
  DB_FILE: 'unocloud.db',
  TENANTS_FILE: 'tenants.json',
};
