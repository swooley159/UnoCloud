/**
 * Microsoft Graph API Client
 * Handles SharePoint operations via Graph API
 */

import { Client } from '@microsoft/microsoft-graph-client';
import 'isomorphic-fetch';
import {
  SharePointSite,
  SharePointDrive,
  SharePointItem,
  UploadSession,
  TenantConfig,
} from '../types';
import { GRAPH_API, SHAREPOINT } from '../utils/constants';
import { authManager } from './auth';
import { logger } from '../utils/logger';

export class GraphClient {
  private client: Client;
  private tenantId: string;

  constructor(accessToken: string, tenantId: string) {
    this.tenantId = tenantId;
    this.client = Client.init({
      authProvider: (done) => {
        done(null, accessToken);
      },
    });
  }

  /**
   * Create a Graph client for a tenant
   */
  static async forTenant(tenant: TenantConfig): Promise<GraphClient> {
    const token = await authManager.getAccessToken(tenant.id, tenant.azure);
    return new GraphClient(token, tenant.id);
  }

  /**
   * Get SharePoint site by URL
   */
  async getSite(siteUrl: string): Promise<SharePointSite> {
    // Parse site URL to get hostname and path
    const url = new URL(siteUrl);
    const hostname = url.hostname;
    const sitePath = url.pathname.replace(/^\/sites\//, '').replace(/\/$/, '');

    const endpoint = `/sites/${hostname}:/sites/${sitePath}`;

    try {
      const site = await this.client.api(endpoint).get();
      logger.debug(`Found site: ${site.displayName} (${site.id})`);
      return site;
    } catch (error: any) {
      logger.error(`Failed to get site ${siteUrl}: ${error.message}`);
      throw new Error(`Site not found: ${siteUrl}`);
    }
  }

  /**
   * Get document library (drive) by name
   */
  async getDrive(siteId: string, libraryName: string): Promise<SharePointDrive> {
    const drives: { value: SharePointDrive[] } = await this.client
      .api(`/sites/${siteId}/drives`)
      .get();

    const drive = drives.value.find(
      (d) => d.name.toLowerCase() === libraryName.toLowerCase()
    );

    if (!drive) {
      throw new Error(`Document library "${libraryName}" not found`);
    }

    logger.debug(`Found drive: ${drive.name} (${drive.id})`);
    return drive;
  }

  /**
   * Get or create a folder in the drive
   */
  async ensureFolder(driveId: string, folderPath: string): Promise<SharePointItem> {
    if (!folderPath || folderPath === '/') {
      // Return root
      return await this.client.api(`/drives/${driveId}/root`).get();
    }

    const parts = folderPath.split('/').filter(Boolean);
    let currentPath = '';
    let currentItem: SharePointItem | null = null;

    for (const part of parts) {
      currentPath += `/${part}`;
      const sanitizedPart = this.sanitizeName(part);

      try {
        currentItem = await this.client
          .api(`/drives/${driveId}/root:${currentPath}`)
          .get();
      } catch (error: any) {
        if (error.statusCode === 404) {
          // Create folder
          const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
          const parentEndpoint =
            parentPath === '/'
              ? `/drives/${driveId}/root/children`
              : `/drives/${driveId}/root:${parentPath}:/children`;

          currentItem = await this.client.api(parentEndpoint).post({
            name: sanitizedPart,
            folder: {},
            '@microsoft.graph.conflictBehavior': 'fail',
          });

          logger.debug(`Created folder: ${currentPath}`);
        } else {
          throw error;
        }
      }
    }

    return currentItem!;
  }

  /**
   * Upload a small file (< 4MB) directly
   */
  async uploadSmallFile(
    driveId: string,
    parentPath: string,
    fileName: string,
    content: Buffer
  ): Promise<SharePointItem> {
    const sanitizedName = this.sanitizeName(fileName);
    const endpoint =
      parentPath && parentPath !== '/'
        ? `/drives/${driveId}/root:${parentPath}/${sanitizedName}:/content`
        : `/drives/${driveId}/root:/${sanitizedName}:/content`;

    const item = await this.client
      .api(endpoint)
      .header('Content-Type', 'application/octet-stream')
      .put(content);

    logger.debug(`Uploaded file: ${fileName} (${content.length} bytes)`);
    return item;
  }

  /**
   * Create upload session for large file
   */
  async createUploadSession(
    driveId: string,
    parentPath: string,
    fileName: string
  ): Promise<UploadSession> {
    const sanitizedName = this.sanitizeName(fileName);
    const endpoint =
      parentPath && parentPath !== '/'
        ? `/drives/${driveId}/root:${parentPath}/${sanitizedName}:/createUploadSession`
        : `/drives/${driveId}/root:/${sanitizedName}:/createUploadSession`;

    const session = await this.client.api(endpoint).post({
      item: {
        '@microsoft.graph.conflictBehavior': 'replace',
        name: sanitizedName,
      },
    });

    logger.debug(`Created upload session for: ${fileName}`);
    return session;
  }

  /**
   * Upload a chunk of a large file
   */
  async uploadChunk(
    uploadUrl: string,
    chunk: Buffer,
    rangeStart: number,
    rangeEnd: number,
    totalSize: number
  ): Promise<SharePointItem | null> {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': chunk.length.toString(),
        'Content-Range': `bytes ${rangeStart}-${rangeEnd}/${totalSize}`,
      },
      body: chunk,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Chunk upload failed: ${error}`);
    }

    const result = await response.json();

    // If upload is complete, return the item
    if (result.id) {
      logger.debug(`Completed chunked upload: ${result.name}`);
      return result as SharePointItem;
    }

    return null; // More chunks needed
  }

  /**
   * Upload a large file using chunked upload
   */
  async uploadLargeFile(
    driveId: string,
    parentPath: string,
    fileName: string,
    content: Buffer,
    onProgress?: (uploaded: number, total: number) => void
  ): Promise<SharePointItem> {
    const session = await this.createUploadSession(driveId, parentPath, fileName);
    const chunkSize = SHAREPOINT.CHUNK_SIZE;
    const totalSize = content.length;
    let uploaded = 0;

    while (uploaded < totalSize) {
      const rangeEnd = Math.min(uploaded + chunkSize - 1, totalSize - 1);
      const chunk = content.slice(uploaded, rangeEnd + 1);

      const result = await this.uploadChunk(
        session.uploadUrl,
        chunk,
        uploaded,
        rangeEnd,
        totalSize
      );

      uploaded = rangeEnd + 1;
      onProgress?.(uploaded, totalSize);

      if (result) {
        return result;
      }
    }

    throw new Error('Upload completed but no item returned');
  }

  /**
   * Upload a file (auto-selects small or large file method)
   */
  async uploadFile(
    driveId: string,
    parentPath: string,
    fileName: string,
    content: Buffer,
    onProgress?: (uploaded: number, total: number) => void
  ): Promise<SharePointItem> {
    if (content.length <= SHAREPOINT.SMALL_FILE_THRESHOLD) {
      return this.uploadSmallFile(driveId, parentPath, fileName, content);
    } else {
      return this.uploadLargeFile(driveId, parentPath, fileName, content, onProgress);
    }
  }

  /**
   * Get item by path
   */
  async getItem(driveId: string, itemPath: string): Promise<SharePointItem | null> {
    try {
      const endpoint =
        itemPath && itemPath !== '/'
          ? `/drives/${driveId}/root:${itemPath}`
          : `/drives/${driveId}/root`;

      return await this.client.api(endpoint).get();
    } catch (error: any) {
      if (error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete an item
   */
  async deleteItem(driveId: string, itemId: string): Promise<void> {
    await this.client.api(`/drives/${driveId}/items/${itemId}`).delete();
  }

  /**
   * List items in a folder
   */
  async listItems(driveId: string, folderPath?: string): Promise<SharePointItem[]> {
    const endpoint =
      folderPath && folderPath !== '/'
        ? `/drives/${driveId}/root:${folderPath}:/children`
        : `/drives/${driveId}/root/children`;

    const result = await this.client.api(endpoint).top(1000).get();
    return result.value;
  }

  /**
   * Sanitize file/folder name for SharePoint
   */
  private sanitizeName(name: string): string {
    let sanitized = name;

    // Replace invalid characters
    for (const char of SHAREPOINT.INVALID_CHARS) {
      sanitized = sanitized.split(char).join('_');
    }

    // Remove leading/trailing spaces and dots
    sanitized = sanitized.trim().replace(/^\.+|\.+$/g, '');

    // Ensure name isn't reserved
    if (SHAREPOINT.RESERVED_NAMES.some((r) => sanitized.toUpperCase() === r.toUpperCase())) {
      sanitized = `_${sanitized}`;
    }

    // Truncate if too long (leaving room for path)
    if (sanitized.length > 200) {
      const ext = sanitized.lastIndexOf('.');
      if (ext > 0) {
        const extension = sanitized.slice(ext);
        sanitized = sanitized.slice(0, 200 - extension.length) + extension;
      } else {
        sanitized = sanitized.slice(0, 200);
      }
    }

    return sanitized;
  }
}
