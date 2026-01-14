/**
 * Tenant Management
 * Handles CRUD operations for tenant configurations
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  TenantConfig,
  AzureConfig,
  SyncMapping,
  SyncOptions,
  SharePointDestination,
} from '../types';
import { encrypt, decrypt, isEncrypted } from '../utils/crypto';
import { DEFAULT_SYNC_OPTIONS, PATHS } from '../utils/constants';
import { logger } from '../utils/logger';

export class TenantManager {
  private configDir: string;
  private tenantsFile: string;
  private tenants: Map<string, TenantConfig> = new Map();

  constructor(configDir?: string) {
    this.configDir = configDir || path.join(process.cwd(), PATHS.CONFIG_DIR);
    this.tenantsFile = path.join(this.configDir, PATHS.TENANTS_FILE);
    this.ensureConfigDir();
    this.loadTenants();
  }

  private ensureConfigDir(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
      logger.info(`Created config directory: ${this.configDir}`);
    }
  }

  private loadTenants(): void {
    if (fs.existsSync(this.tenantsFile)) {
      try {
        const data = fs.readFileSync(this.tenantsFile, 'utf-8');
        const tenantsArray: TenantConfig[] = JSON.parse(data);

        for (const tenant of tenantsArray) {
          // Decrypt client secret if encrypted
          if (isEncrypted(tenant.azure.clientSecret)) {
            tenant.azure.clientSecret = decrypt(tenant.azure.clientSecret);
          }
          this.tenants.set(tenant.id, tenant);
        }

        logger.info(`Loaded ${this.tenants.size} tenant(s)`);
      } catch (error) {
        logger.error('Failed to load tenants:', error);
        throw new Error('Failed to load tenant configuration');
      }
    }
  }

  private saveTenants(): void {
    const tenantsArray = Array.from(this.tenants.values()).map((tenant) => ({
      ...tenant,
      azure: {
        ...tenant.azure,
        // Encrypt client secret before saving
        clientSecret: encrypt(tenant.azure.clientSecret),
      },
    }));

    fs.writeFileSync(this.tenantsFile, JSON.stringify(tenantsArray, null, 2));
    logger.debug('Saved tenant configuration');
  }

  /**
   * Add a new tenant
   */
  addTenant(
    name: string,
    azure: AzureConfig,
    options?: Partial<SyncOptions>
  ): TenantConfig {
    // Generate ID from name (slug format)
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    if (this.tenants.has(id)) {
      throw new Error(`Tenant with ID "${id}" already exists`);
    }

    const tenant: TenantConfig = {
      id,
      name,
      azure,
      mappings: [],
      options: { ...DEFAULT_SYNC_OPTIONS, ...options },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.tenants.set(id, tenant);
    this.saveTenants();

    logger.info(`Added tenant: ${name} (${id})`);
    return tenant;
  }

  /**
   * Get a tenant by ID
   */
  getTenant(id: string): TenantConfig | undefined {
    return this.tenants.get(id);
  }

  /**
   * Get all tenants
   */
  getAllTenants(): TenantConfig[] {
    return Array.from(this.tenants.values());
  }

  /**
   * Update tenant configuration
   */
  updateTenant(id: string, updates: Partial<Omit<TenantConfig, 'id' | 'createdAt'>>): TenantConfig {
    const tenant = this.tenants.get(id);
    if (!tenant) {
      throw new Error(`Tenant "${id}" not found`);
    }

    const updated: TenantConfig = {
      ...tenant,
      ...updates,
      azure: updates.azure ? { ...tenant.azure, ...updates.azure } : tenant.azure,
      options: updates.options ? { ...tenant.options, ...updates.options } : tenant.options,
      updatedAt: new Date().toISOString(),
    };

    this.tenants.set(id, updated);
    this.saveTenants();

    logger.info(`Updated tenant: ${id}`);
    return updated;
  }

  /**
   * Remove a tenant
   */
  removeTenant(id: string): boolean {
    if (!this.tenants.has(id)) {
      return false;
    }

    this.tenants.delete(id);
    this.saveTenants();

    logger.info(`Removed tenant: ${id}`);
    return true;
  }

  /**
   * Add a sync mapping to a tenant
   */
  addMapping(
    tenantId: string,
    source: string,
    destination: SharePointDestination,
    filters?: SyncMapping['filters']
  ): SyncMapping {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new Error(`Tenant "${tenantId}" not found`);
    }

    // Check for duplicate source paths
    const existingMapping = tenant.mappings.find((m) => m.source === source);
    if (existingMapping) {
      throw new Error(`Mapping for source "${source}" already exists`);
    }

    const mapping: SyncMapping = {
      id: uuidv4(),
      source: path.resolve(source),
      destination,
      filters,
      enabled: true,
    };

    tenant.mappings.push(mapping);
    tenant.updatedAt = new Date().toISOString();

    this.tenants.set(tenantId, tenant);
    this.saveTenants();

    logger.info(`Added mapping for tenant ${tenantId}: ${source} -> ${destination.siteUrl}`);
    return mapping;
  }

  /**
   * Remove a sync mapping
   */
  removeMapping(tenantId: string, mappingId: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new Error(`Tenant "${tenantId}" not found`);
    }

    const index = tenant.mappings.findIndex((m) => m.id === mappingId);
    if (index === -1) {
      return false;
    }

    tenant.mappings.splice(index, 1);
    tenant.updatedAt = new Date().toISOString();

    this.tenants.set(tenantId, tenant);
    this.saveTenants();

    logger.info(`Removed mapping ${mappingId} from tenant ${tenantId}`);
    return true;
  }

  /**
   * Toggle mapping enabled status
   */
  toggleMapping(tenantId: string, mappingId: string, enabled: boolean): SyncMapping {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new Error(`Tenant "${tenantId}" not found`);
    }

    const mapping = tenant.mappings.find((m) => m.id === mappingId);
    if (!mapping) {
      throw new Error(`Mapping "${mappingId}" not found`);
    }

    mapping.enabled = enabled;
    tenant.updatedAt = new Date().toISOString();

    this.tenants.set(tenantId, tenant);
    this.saveTenants();

    return mapping;
  }

  /**
   * Validate tenant Azure credentials
   */
  validateAzureConfig(azure: AzureConfig): string[] {
    const errors: string[] = [];

    if (!azure.tenantId || !/^[0-9a-f-]{36}$/i.test(azure.tenantId)) {
      errors.push('Invalid tenant ID format (expected GUID)');
    }

    if (!azure.clientId || !/^[0-9a-f-]{36}$/i.test(azure.clientId)) {
      errors.push('Invalid client ID format (expected GUID)');
    }

    if (!azure.clientSecret || azure.clientSecret.length < 10) {
      errors.push('Client secret is required and must be at least 10 characters');
    }

    return errors;
  }
}

// Add uuid to package.json dependencies
