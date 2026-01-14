/**
 * UnoCloud Core Types
 */

// ============================================================================
// Tenant Configuration
// ============================================================================

export interface TenantConfig {
  id: string;
  name: string;
  azure: AzureConfig;
  mappings: SyncMapping[];
  options: SyncOptions;
  createdAt: string;
  updatedAt: string;
}

export interface AzureConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string; // Encrypted at rest
}

export interface SyncMapping {
  id: string;
  source: string; // Local file path
  destination: SharePointDestination;
  filters?: FileFilters;
  enabled: boolean;
}

export interface SharePointDestination {
  siteUrl: string;
  library: string;
  folder?: string;
}

export interface FileFilters {
  include?: string[]; // Glob patterns
  exclude?: string[]; // Glob patterns
  maxFileSize?: number; // Bytes
  minFileSize?: number; // Bytes
}

export interface SyncOptions {
  mode: 'full' | 'incremental';
  schedule?: string; // Cron expression
  deleteAfterSync: boolean;
  preserveTimestamps: boolean;
  preserveFolderStructure: boolean;
  conflictResolution: 'skip' | 'overwrite' | 'rename';
  maxConcurrentUploads: number;
  retryAttempts: number;
  retryDelayMs: number;
}

// ============================================================================
// Sync Tracking
// ============================================================================

export interface SyncedFile {
  id: number;
  tenantId: string;
  mappingId: string;
  localPath: string;
  remotePath: string;
  driveItemId: string;
  fileHash: string;
  fileSize: number;
  localModifiedAt: string;
  remoteModifiedAt: string;
  syncedAt: string;
  status: SyncStatus;
  errorMessage?: string;
}

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'deleted';

export interface SyncJob {
  id: string;
  tenantId: string;
  mappingId?: string; // If null, sync all mappings
  status: JobStatus;
  startedAt: string;
  completedAt?: string;
  filesTotal: number;
  filesProcessed: number;
  filesFailed: number;
  bytesTotal: number;
  bytesTransferred: number;
  errors: SyncError[];
}

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SyncError {
  filePath: string;
  error: string;
  timestamp: string;
  retryCount: number;
}

// ============================================================================
// File Scanning
// ============================================================================

export interface ScannedFile {
  path: string;
  relativePath: string;
  name: string;
  size: number;
  hash: string;
  createdAt: Date;
  modifiedAt: Date;
  isDirectory: boolean;
}

export interface ScanResult {
  mappingId: string;
  sourcePath: string;
  files: ScannedFile[];
  directories: string[];
  totalSize: number;
  scannedAt: Date;
}

// ============================================================================
// SharePoint / Graph API
// ============================================================================

export interface SharePointSite {
  id: string;
  name: string;
  webUrl: string;
  displayName: string;
}

export interface SharePointDrive {
  id: string;
  name: string;
  driveType: string;
  webUrl: string;
}

export interface SharePointItem {
  id: string;
  name: string;
  webUrl: string;
  size?: number;
  createdDateTime: string;
  lastModifiedDateTime: string;
  folder?: { childCount: number };
  file?: { mimeType: string; hashes?: { sha256Hash?: string } };
  parentReference?: {
    driveId: string;
    id: string;
    path: string;
  };
}

export interface UploadSession {
  uploadUrl: string;
  expirationDateTime: string;
}

export interface UploadResult {
  success: boolean;
  item?: SharePointItem;
  error?: string;
}

// ============================================================================
// Authentication
// ============================================================================

export interface AuthToken {
  accessToken: string;
  expiresAt: Date;
}

export interface TokenCache {
  [tenantId: string]: AuthToken;
}

// ============================================================================
// CLI
// ============================================================================

export interface CLIContext {
  configDir: string;
  dataDir: string;
  logDir: string;
  verbose: boolean;
}
