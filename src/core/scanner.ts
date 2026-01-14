/**
 * File Scanner
 * Scans source directories and builds file inventory with hashes
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { promisify } from 'util';
import { ScannedFile, ScanResult, SyncMapping, FileFilters } from '../types';
import { logger } from '../utils/logger';
import { minimatch } from 'minimatch';

const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);

export class FileScanner {
  private hashAlgorithm: string = 'sha256';

  /**
   * Calculate file hash
   */
  async calculateHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(this.hashAlgorithm);
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Check if file matches filters
   */
  private matchesFilters(
    relativePath: string,
    fileSize: number,
    filters?: FileFilters
  ): boolean {
    if (!filters) return true;

    // Check size limits
    if (filters.maxFileSize && fileSize > filters.maxFileSize) {
      return false;
    }
    if (filters.minFileSize && fileSize < filters.minFileSize) {
      return false;
    }

    // Check include patterns
    if (filters.include && filters.include.length > 0) {
      const matches = filters.include.some((pattern) =>
        minimatch(relativePath, pattern, { matchBase: true })
      );
      if (!matches) return false;
    }

    // Check exclude patterns
    if (filters.exclude && filters.exclude.length > 0) {
      const excluded = filters.exclude.some((pattern) =>
        minimatch(relativePath, pattern, { matchBase: true })
      );
      if (excluded) return false;
    }

    return true;
  }

  /**
   * Scan a single file
   */
  async scanFile(filePath: string, basePath: string): Promise<ScannedFile | null> {
    try {
      const stats = await stat(filePath);
      const relativePath = path.relative(basePath, filePath);

      if (stats.isDirectory()) {
        return {
          path: filePath,
          relativePath,
          name: path.basename(filePath),
          size: 0,
          hash: '',
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime,
          isDirectory: true,
        };
      }

      const hash = await this.calculateHash(filePath);

      return {
        path: filePath,
        relativePath,
        name: path.basename(filePath),
        size: stats.size,
        hash,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
        isDirectory: false,
      };
    } catch (error: any) {
      logger.warn(`Failed to scan file ${filePath}: ${error.message}`);
      return null;
    }
  }

  /**
   * Recursively scan a directory
   */
  async scanDirectory(
    dirPath: string,
    basePath: string,
    filters?: FileFilters,
    onFile?: (file: ScannedFile) => void
  ): Promise<{ files: ScannedFile[]; directories: string[] }> {
    const files: ScannedFile[] = [];
    const directories: string[] = [];

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(basePath, fullPath);

        if (entry.isDirectory()) {
          directories.push(relativePath);

          // Recurse into subdirectory
          const subResult = await this.scanDirectory(fullPath, basePath, filters, onFile);
          files.push(...subResult.files);
          directories.push(...subResult.directories);
        } else if (entry.isFile()) {
          // Check file stats for filtering
          try {
            const stats = await stat(fullPath);

            if (!this.matchesFilters(relativePath, stats.size, filters)) {
              logger.debug(`Skipping filtered file: ${relativePath}`);
              continue;
            }

            const scannedFile = await this.scanFile(fullPath, basePath);
            if (scannedFile) {
              files.push(scannedFile);
              onFile?.(scannedFile);
            }
          } catch (error: any) {
            logger.warn(`Failed to access file ${fullPath}: ${error.message}`);
          }
        }
      }
    } catch (error: any) {
      logger.error(`Failed to scan directory ${dirPath}: ${error.message}`);
    }

    return { files, directories };
  }

  /**
   * Scan a mapping source directory
   */
  async scan(
    mapping: SyncMapping,
    onProgress?: (scanned: number, current: string) => void
  ): Promise<ScanResult> {
    const sourcePath = mapping.source;

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source path does not exist: ${sourcePath}`);
    }

    const stats = await stat(sourcePath);
    if (!stats.isDirectory()) {
      throw new Error(`Source path is not a directory: ${sourcePath}`);
    }

    logger.info(`Scanning directory: ${sourcePath}`);
    let scannedCount = 0;

    const { files, directories } = await this.scanDirectory(
      sourcePath,
      sourcePath,
      mapping.filters,
      (file) => {
        scannedCount++;
        onProgress?.(scannedCount, file.relativePath);
      }
    );

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    logger.info(`Scan complete: ${files.length} files, ${directories.length} directories, ${this.formatSize(totalSize)}`);

    return {
      mappingId: mapping.id,
      sourcePath,
      files,
      directories,
      totalSize,
      scannedAt: new Date(),
    };
  }

  /**
   * Format file size for display
   */
  private formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}

export const fileScanner = new FileScanner();
