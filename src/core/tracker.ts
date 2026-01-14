/**
 * Sync Tracker
 * SQLite database for tracking synced files and sync jobs
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { SyncedFile, SyncJob, SyncStatus, JobStatus, SyncError } from '../types';
import { PATHS } from '../utils/constants';
import { logger } from '../utils/logger';

export class SyncTracker {
  private db: Database.Database;

  constructor(dataDir?: string) {
    const dir = dataDir || path.join(process.cwd(), PATHS.DATA_DIR);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const dbPath = path.join(dir, PATHS.DB_FILE);
    this.db = new Database(dbPath);

    this.initialize();
    logger.debug(`Initialized sync tracker: ${dbPath}`);
  }

  private initialize(): void {
    // Enable WAL mode for better concurrent performance
    this.db.pragma('journal_mode = WAL');

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS synced_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        mapping_id TEXT NOT NULL,
        local_path TEXT NOT NULL,
        remote_path TEXT NOT NULL,
        drive_item_id TEXT,
        file_hash TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        local_modified_at TEXT NOT NULL,
        remote_modified_at TEXT,
        synced_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error_message TEXT,
        UNIQUE(tenant_id, mapping_id, local_path)
      );

      CREATE TABLE IF NOT EXISTS sync_jobs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        mapping_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        started_at TEXT NOT NULL,
        completed_at TEXT,
        files_total INTEGER DEFAULT 0,
        files_processed INTEGER DEFAULT 0,
        files_failed INTEGER DEFAULT 0,
        bytes_total INTEGER DEFAULT 0,
        bytes_transferred INTEGER DEFAULT 0,
        errors TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_synced_files_tenant ON synced_files(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_synced_files_mapping ON synced_files(mapping_id);
      CREATE INDEX IF NOT EXISTS idx_synced_files_status ON synced_files(status);
      CREATE INDEX IF NOT EXISTS idx_sync_jobs_tenant ON sync_jobs(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status);
    `);
  }

  // ============================================================================
  // Synced Files
  // ============================================================================

  /**
   * Get a synced file record
   */
  getSyncedFile(tenantId: string, mappingId: string, localPath: string): SyncedFile | null {
    const row = this.db
      .prepare(
        `SELECT * FROM synced_files WHERE tenant_id = ? AND mapping_id = ? AND local_path = ?`
      )
      .get(tenantId, mappingId, localPath) as any;

    return row ? this.mapSyncedFile(row) : null;
  }

  /**
   * Get all synced files for a mapping
   */
  getSyncedFilesForMapping(tenantId: string, mappingId: string): SyncedFile[] {
    const rows = this.db
      .prepare(`SELECT * FROM synced_files WHERE tenant_id = ? AND mapping_id = ?`)
      .all(tenantId, mappingId) as any[];

    return rows.map(this.mapSyncedFile);
  }

  /**
   * Upsert a synced file record
   */
  upsertSyncedFile(file: Omit<SyncedFile, 'id'>): void {
    this.db
      .prepare(
        `INSERT INTO synced_files (
          tenant_id, mapping_id, local_path, remote_path, drive_item_id,
          file_hash, file_size, local_modified_at, remote_modified_at,
          synced_at, status, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, mapping_id, local_path) DO UPDATE SET
          remote_path = excluded.remote_path,
          drive_item_id = excluded.drive_item_id,
          file_hash = excluded.file_hash,
          file_size = excluded.file_size,
          local_modified_at = excluded.local_modified_at,
          remote_modified_at = excluded.remote_modified_at,
          synced_at = excluded.synced_at,
          status = excluded.status,
          error_message = excluded.error_message`
      )
      .run(
        file.tenantId,
        file.mappingId,
        file.localPath,
        file.remotePath,
        file.driveItemId,
        file.fileHash,
        file.fileSize,
        file.localModifiedAt,
        file.remoteModifiedAt,
        file.syncedAt,
        file.status,
        file.errorMessage
      );
  }

  /**
   * Update file status
   */
  updateFileStatus(
    tenantId: string,
    mappingId: string,
    localPath: string,
    status: SyncStatus,
    errorMessage?: string
  ): void {
    this.db
      .prepare(
        `UPDATE synced_files SET status = ?, error_message = ?, synced_at = ?
         WHERE tenant_id = ? AND mapping_id = ? AND local_path = ?`
      )
      .run(status, errorMessage, new Date().toISOString(), tenantId, mappingId, localPath);
  }

  /**
   * Check if file needs sync (based on hash comparison)
   */
  needsSync(tenantId: string, mappingId: string, localPath: string, currentHash: string): boolean {
    const existing = this.getSyncedFile(tenantId, mappingId, localPath);

    if (!existing) return true;
    if (existing.status === 'failed') return true;
    if (existing.fileHash !== currentHash) return true;

    return false;
  }

  /**
   * Delete synced file record
   */
  deleteSyncedFile(tenantId: string, mappingId: string, localPath: string): void {
    this.db
      .prepare(`DELETE FROM synced_files WHERE tenant_id = ? AND mapping_id = ? AND local_path = ?`)
      .run(tenantId, mappingId, localPath);
  }

  /**
   * Get sync statistics for a tenant
   */
  getStats(tenantId: string): { total: number; synced: number; pending: number; failed: number } {
    const stats = this.db
      .prepare(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'synced' THEN 1 ELSE 0 END) as synced,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
         FROM synced_files WHERE tenant_id = ?`
      )
      .get(tenantId) as any;

    return {
      total: stats.total || 0,
      synced: stats.synced || 0,
      pending: stats.pending || 0,
      failed: stats.failed || 0,
    };
  }

  // ============================================================================
  // Sync Jobs
  // ============================================================================

  /**
   * Create a new sync job
   */
  createJob(tenantId: string, mappingId?: string): SyncJob {
    const id = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const job: SyncJob = {
      id,
      tenantId,
      mappingId,
      status: 'pending',
      startedAt: new Date().toISOString(),
      filesTotal: 0,
      filesProcessed: 0,
      filesFailed: 0,
      bytesTotal: 0,
      bytesTransferred: 0,
      errors: [],
    };

    this.db
      .prepare(
        `INSERT INTO sync_jobs (id, tenant_id, mapping_id, status, started_at, errors)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(job.id, job.tenantId, job.mappingId, job.status, job.startedAt, JSON.stringify([]));

    return job;
  }

  /**
   * Update job progress
   */
  updateJobProgress(
    jobId: string,
    filesProcessed: number,
    bytesTransferred: number,
    filesFailed?: number
  ): void {
    this.db
      .prepare(
        `UPDATE sync_jobs SET
          files_processed = ?, bytes_transferred = ?, files_failed = COALESCE(?, files_failed)
         WHERE id = ?`
      )
      .run(filesProcessed, bytesTransferred, filesFailed, jobId);
  }

  /**
   * Set job totals
   */
  setJobTotals(jobId: string, filesTotal: number, bytesTotal: number): void {
    this.db
      .prepare(`UPDATE sync_jobs SET files_total = ?, bytes_total = ?, status = 'running' WHERE id = ?`)
      .run(filesTotal, bytesTotal, jobId);
  }

  /**
   * Complete a job
   */
  completeJob(jobId: string, status: JobStatus, errors: SyncError[] = []): void {
    this.db
      .prepare(
        `UPDATE sync_jobs SET status = ?, completed_at = ?, errors = ? WHERE id = ?`
      )
      .run(status, new Date().toISOString(), JSON.stringify(errors), jobId);
  }

  /**
   * Get job by ID
   */
  getJob(jobId: string): SyncJob | null {
    const row = this.db.prepare(`SELECT * FROM sync_jobs WHERE id = ?`).get(jobId) as any;
    return row ? this.mapSyncJob(row) : null;
  }

  /**
   * Get recent jobs for a tenant
   */
  getRecentJobs(tenantId: string, limit: number = 10): SyncJob[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM sync_jobs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT ?`
      )
      .all(tenantId, limit) as any[];

    return rows.map(this.mapSyncJob);
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private mapSyncedFile(row: any): SyncedFile {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      mappingId: row.mapping_id,
      localPath: row.local_path,
      remotePath: row.remote_path,
      driveItemId: row.drive_item_id,
      fileHash: row.file_hash,
      fileSize: row.file_size,
      localModifiedAt: row.local_modified_at,
      remoteModifiedAt: row.remote_modified_at,
      syncedAt: row.synced_at,
      status: row.status as SyncStatus,
      errorMessage: row.error_message,
    };
  }

  private mapSyncJob(row: any): SyncJob {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      mappingId: row.mapping_id,
      status: row.status as JobStatus,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      filesTotal: row.files_total,
      filesProcessed: row.files_processed,
      filesFailed: row.files_failed,
      bytesTotal: row.bytes_total,
      bytesTransferred: row.bytes_transferred,
      errors: JSON.parse(row.errors || '[]'),
    };
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}
