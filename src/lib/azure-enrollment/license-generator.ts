/**
 * Generic License Generator
 * Reusable license key generation and validation
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  LicenseConfig,
  LicenseTierDefinition,
  GenericLicense,
} from './types';

export class LicenseGenerator {
  private config: LicenseConfig;
  private tiers: Map<string, LicenseTierDefinition> = new Map();
  private licenses: Map<string, GenericLicense> = new Map();
  private licensesFile: string;

  constructor(config: LicenseConfig) {
    this.config = config;
    this.licensesFile = path.join(
      config.storageDir || process.cwd(),
      `${config.issuer.toLowerCase().replace(/\s+/g, '-')}-licenses.json`
    );
    this.loadLicenses();
  }

  /**
   * Register a license tier
   */
  registerTier(tier: LicenseTierDefinition): void {
    if (tier.code.length !== 3) {
      throw new Error('Tier code must be exactly 3 characters');
    }
    this.tiers.set(tier.code.toUpperCase(), tier);
  }

  /**
   * Register multiple tiers at once
   */
  registerTiers(tiers: LicenseTierDefinition[]): void {
    tiers.forEach((t) => this.registerTier(t));
  }

  /**
   * Generate a cryptographically signed license key
   */
  generateKey(tierCode: string, expiresInDays?: number): string {
    const tier = this.tiers.get(tierCode.toUpperCase());
    if (!tier) {
      throw new Error(`Unknown tier: ${tierCode}`);
    }

    const payload = {
      t: tierCode.toUpperCase(),
      c: Date.now(),
      x: expiresInDays || 0,
      i: this.config.issuer.substring(0, 3).toUpperCase(),
      r: crypto.randomBytes(4).toString('hex'),
    };

    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = this.sign(data);

    // Format: PREFIX-TIER-DATA-SIGNATURE
    const prefix = this.config.issuer.substring(0, 2).toUpperCase();
    return `${prefix}-${tierCode.toUpperCase()}-${data}-${signature}`;
  }

  /**
   * Validate a license key
   */
  validateKey(key: string): {
    valid: boolean;
    tierCode?: string;
    tier?: LicenseTierDefinition;
    expiresAt?: Date;
    error?: string;
  } {
    try {
      const parts = key.split('-');
      if (parts.length !== 4) {
        return { valid: false, error: 'Invalid key format' };
      }

      const [prefix, tierCode, data, providedSig] = parts;

      // Verify prefix matches issuer
      const expectedPrefix = this.config.issuer.substring(0, 2).toUpperCase();
      if (prefix !== expectedPrefix) {
        return { valid: false, error: 'Invalid key prefix' };
      }

      // Verify signature
      const expectedSig = this.sign(data);
      if (providedSig !== expectedSig) {
        return { valid: false, error: 'Invalid signature' };
      }

      // Decode payload
      const payload = JSON.parse(Buffer.from(data, 'base64url').toString());

      // Verify tier exists
      const tier = this.tiers.get(tierCode.toUpperCase());
      if (!tier) {
        return { valid: false, error: `Unknown tier: ${tierCode}` };
      }

      // Check expiration
      let expiresAt: Date | undefined;
      if (payload.x > 0) {
        expiresAt = new Date(payload.c + payload.x * 24 * 60 * 60 * 1000);
        if (expiresAt < new Date()) {
          return { valid: false, error: 'License expired' };
        }
      }

      return { valid: true, tierCode: tierCode.toUpperCase(), tier, expiresAt };
    } catch (error) {
      return { valid: false, error: 'Failed to parse key' };
    }
  }

  /**
   * Create a full license record
   */
  createLicense(
    clientName: string,
    clientEmail: string,
    tierCode: string,
    expiresInDays?: number,
    metadata?: Record<string, any>
  ): GenericLicense {
    const tier = this.tiers.get(tierCode.toUpperCase());
    if (!tier) {
      throw new Error(`Unknown tier: ${tierCode}`);
    }

    const key = this.generateKey(tierCode, expiresInDays);

    const license: GenericLicense = {
      key,
      tierCode: tierCode.toUpperCase(),
      clientName,
      clientEmail,
      metadata: metadata || {},
      limits: { ...tier.limits },
      features: [...tier.features],
      createdAt: new Date().toISOString(),
      expiresAt: expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
        : null,
      activated: false,
    };

    this.licenses.set(key, license);
    this.saveLicenses();

    return license;
  }

  /**
   * Get a license by key
   */
  getLicense(key: string): GenericLicense | undefined {
    return this.licenses.get(key);
  }

  /**
   * Get all licenses
   */
  getAllLicenses(): GenericLicense[] {
    return Array.from(this.licenses.values());
  }

  /**
   * Activate a license
   */
  activateLicense(key: string, tenantId: string): GenericLicense {
    const license = this.licenses.get(key);
    if (!license) {
      throw new Error('License not found');
    }

    if (license.activated) {
      throw new Error('License already activated');
    }

    const validation = this.validateKey(key);
    if (!validation.valid) {
      throw new Error(`Invalid license: ${validation.error}`);
    }

    license.activated = true;
    license.activatedAt = new Date().toISOString();
    license.activatedTenantId = tenantId;

    this.licenses.set(key, license);
    this.saveLicenses();

    return license;
  }

  /**
   * Revoke a license
   */
  revokeLicense(key: string): boolean {
    if (!this.licenses.has(key)) {
      return false;
    }
    this.licenses.delete(key);
    this.saveLicenses();
    return true;
  }

  /**
   * Check if license has a feature
   */
  hasFeature(key: string, feature: string): boolean {
    const license = this.licenses.get(key);
    if (!license || !license.activated) return false;
    if (license.expiresAt && new Date(license.expiresAt) < new Date()) return false;
    return license.features.includes(feature);
  }

  /**
   * Get limit value for a license
   */
  getLimit(key: string, limitName: string): number | boolean | undefined {
    const license = this.licenses.get(key);
    if (!license || !license.activated) return undefined;
    if (license.expiresAt && new Date(license.expiresAt) < new Date()) return undefined;
    return license.limits[limitName];
  }

  /**
   * Find license by tenant ID
   */
  findByTenant(tenantId: string): GenericLicense | undefined {
    return Array.from(this.licenses.values()).find(
      (l) => l.activatedTenantId === tenantId
    );
  }

  // Private methods

  private sign(data: string): string {
    return crypto
      .createHmac('sha256', this.config.secretKey)
      .update(data)
      .digest('base64url')
      .substring(0, 8);
  }

  private loadLicenses(): void {
    if (fs.existsSync(this.licensesFile)) {
      try {
        const data = fs.readFileSync(this.licensesFile, 'utf-8');
        const arr: GenericLicense[] = JSON.parse(data);
        arr.forEach((l) => this.licenses.set(l.key, l));
      } catch (error) {
        console.error('Failed to load licenses:', error);
      }
    }
  }

  private saveLicenses(): void {
    const dir = path.dirname(this.licensesFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      this.licensesFile,
      JSON.stringify(Array.from(this.licenses.values()), null, 2)
    );
  }
}
