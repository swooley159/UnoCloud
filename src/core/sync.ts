/**
 * Sync Engine
 * Orchestrates the file synchronization process
 */

import fs from 'fs';
import path from 'path';
import { TenantConfig, SyncMapping, ScannedFile, SyncJob, SyncError } from '../types';
import { TenantManager } from './tenant';
import { GraphClient } from './graph';
import { fileScanner } from './scanner';
import { SyncTracker } from './tracker';
import { logger } from '../utils/logger';

export interface SyncProgress {
  job: SyncJob;
  currentFile?: string;
  phase: 'scanning' | 'uploading' | 'complete' | 'error';
}

export type ProgressCallback = (progress: SyncProgress) => void;

export class SyncEngine {
  private tenantManager: TenantManager;
  private tracker: SyncTracker;

  constructor(tenantManager: TenantManager, tracker: SyncTracker) {
    this.tenantManager = tenantManager;
    this.tracker = tracker;
  }

  /**
   * Sync a specific mapping for a tenant
   */
  async syncMapping(
    tenant: TenantConfig,
    mapping: SyncMapping,
    onProgress?: ProgressCallback
  ): Promise<SyncJob> {
    const job = this.tracker.createJob(tenant.id, mapping.id);

    const updateProgress = (phase: SyncProgress['phase'], currentFile?: string) => {
      const updatedJob = this.tracker.getJob(job.id)!;
      onProgress?.({ job: updatedJob, currentFile, phase });
    };

    try {
      logger.info(`Starting sync for mapping ${mapping.id}: ${mapping.source}`);
      updateProgress('scanning');

      // Phase 1: Scan source directory
      const scanResult = await fileScanner.scan(mapping, (scanned, current) => {
        updateProgress('scanning', current);
      });

      const filesToSync = scanResult.files.filter((file) =>
        this.tracker.needsSync(tenant.id, mapping.id, file.path, file.hash)
      );

      logger.info(`Found ${filesToSync.length} files to sync out of ${scanResult.files.length} total`);

      this.tracker.setJobTotals(
        job.id,
        filesToSync.length,
        filesToSync.reduce((sum, f) => sum + f.size, 0)
      );

      if (filesToSync.length === 0) {
        this.tracker.completeJob(job.id, 'completed');
        updateProgress('complete');
        return this.tracker.getJob(job.id)!;
      }

      // Phase 2: Connect to SharePoint
      updateProgress('uploading');
      const graphClient = await GraphClient.forTenant(tenant);

      // Get site and drive
      const site = await graphClient.getSite(mapping.destination.siteUrl);
      const drive = await graphClient.getDrive(site.id, mapping.destination.library);

      // Ensure destination folder exists
      const destFolder = mapping.destination.folder || '';
      if (destFolder) {
        await graphClient.ensureFolder(drive.id, destFolder);
      }

      // Phase 3: Upload files
      const errors: SyncError[] = [];
      let processed = 0;
      let bytesTransferred = 0;

      for (const file of filesToSync) {
        try {
          updateProgress('uploading', file.relativePath);

          // Calculate remote path
          const remotePath = tenant.options.preserveFolderStructure
            ? path.join(destFolder, file.relativePath)
            : path.join(destFolder, file.name);

          const remoteDir = path.dirname(remotePath);

          // Ensure parent folder exists
          if (remoteDir && remoteDir !== '.' && remoteDir !== destFolder) {
            await graphClient.ensureFolder(drive.id, remoteDir);
          }

          // Read file content
          const content = fs.readFileSync(file.path);

          // Upload file
          const item = await graphClient.uploadFile(
            drive.id,
            remoteDir === '.' ? '' : remoteDir,
            file.name,
            content,
            (uploaded, total) => {
              // Could emit per-file progress here
            }
          );

          // Record successful sync
          this.tracker.upsertSyncedFile({
            tenantId: tenant.id,
            mappingId: mapping.id,
            localPath: file.path,
            remotePath: remotePath,
            driveItemId: item.id,
            fileHash: file.hash,
            fileSize: file.size,
            localModifiedAt: file.modifiedAt.toISOString(),
            remoteModifiedAt: item.lastModifiedDateTime,
            syncedAt: new Date().toISOString(),
            status: 'synced',
          });

          bytesTransferred += file.size;
          processed++;

          this.tracker.updateJobProgress(job.id, processed, bytesTransferred);
          logger.debug(`Synced: ${file.relativePath}`);
        } catch (error: any) {
          logger.error(`Failed to sync ${file.relativePath}: ${error.message}`);

          errors.push({
            filePath: file.path,
            error: error.message,
            timestamp: new Date().toISOString(),
            retryCount: 0,
          });

          this.tracker.upsertSyncedFile({
            tenantId: tenant.id,
            mappingId: mapping.id,
            localPath: file.path,
            remotePath: '',
            driveItemId: '',
            fileHash: file.hash,
            fileSize: file.size,
            localModifiedAt: file.modifiedAt.toISOString(),
            remoteModifiedAt: '',
            syncedAt: new Date().toISOString(),
            status: 'failed',
            errorMessage: error.message,
          });

          this.tracker.updateJobProgress(job.id, processed, bytesTransferred, errors.length);
        }
      }

      // Complete job
      const finalStatus = errors.length === 0 ? 'completed' : errors.length < filesToSync.length ? 'completed' : 'failed';
      this.tracker.completeJob(job.id, finalStatus, errors);

      updateProgress('complete');
      logger.info(`Sync completed: ${processed} files, ${errors.length} errors`);

      return this.tracker.getJob(job.id)!;
    } catch (error: any) {
      logger.error(`Sync failed: ${error.message}`);
      this.tracker.completeJob(job.id, 'failed', [
        {
          filePath: mapping.source,
          error: error.message,
          timestamp: new Date().toISOString(),
          retryCount: 0,
        },
      ]);

      updateProgress('error');
      return this.tracker.getJob(job.id)!;
    }
  }

  /**
   * Sync all mappings for a tenant
   */
  async syncTenant(tenant: TenantConfig, onProgress?: ProgressCallback): Promise<SyncJob[]> {
    const jobs: SyncJob[] = [];

    for (const mapping of tenant.mappings) {
      if (!mapping.enabled) {
        logger.info(`Skipping disabled mapping: ${mapping.source}`);
        continue;
      }

      const job = await this.syncMapping(tenant, mapping, onProgress);
      jobs.push(job);
    }

    return jobs;
  }

  /**
   * Sync all tenants
   */
  async syncAll(onProgress?: ProgressCallback): Promise<Map<string, SyncJob[]>> {
    const results = new Map<string, SyncJob[]>();
    const tenants = this.tenantManager.getAllTenants();

    for (const tenant of tenants) {
      const jobs = await this.syncTenant(tenant, onProgress);
      results.set(tenant.id, jobs);
    }

    return results;
  }

  /**
   * Perform a dry run (scan only, no upload)
   */
  async dryRun(
    tenant: TenantConfig,
    mapping: SyncMapping
  ): Promise<{
    toSync: ScannedFile[];
    upToDate: number;
    totalSize: number;
  }> {
    const scanResult = await fileScanner.scan(mapping);

    const toSync: ScannedFile[] = [];
    let upToDate = 0;

    for (const file of scanResult.files) {
      if (this.tracker.needsSync(tenant.id, mapping.id, file.path, file.hash)) {
        toSync.push(file);
      } else {
        upToDate++;
      }
    }

    return {
      toSync,
      upToDate,
      totalSize: toSync.reduce((sum, f) => sum + f.size, 0),
    };
  }
}
