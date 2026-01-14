/**
 * License Key Management
 * Generate and validate license keys for client enrollment
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PATHS } from '../utils/constants';
import { logger } from '../utils/logger';

export interface License {
  key: string;
  clientName: string;
  clientEmail: string;
  createdAt: string;
  expiresAt: string | null;
  maxMappings: number;
  features: LicenseFeatures;
  activated: boolean;
  activatedAt?: string;
  tenantId?: string;
}

export interface LicenseFeatures {
  scheduling: boolean;
  bidirectionalSync: boolean;
  emailNotifications: boolean;
  prioritySupport: boolean;
  maxFileSize: number; // in GB
}

export type LicenseTier = 'starter' | 'professional' | 'enterprise';

const TIER_FEATURES: Record<LicenseTier, { maxMappings: number; features: LicenseFeatures }> = {
  starter: {
    maxMappings: 3,
    features: {
      scheduling: false,
      bidirectionalSync: false,
      emailNotifications: false,
      prioritySupport: false,
      maxFileSize: 10, // 10 GB
    },
  },
  professional: {
    maxMappings: 10,
    features: {
      scheduling: true,
      bidirectionalSync: true,
      emailNotifications: true,
      prioritySupport: false,
      maxFileSize: 100, // 100 GB
    },
  },
  enterprise: {
    maxMappings: -1, // unlimited
    features: {
      scheduling: true,
      bidirectionalSync: true,
      emailNotifications: true,
      prioritySupport: true,
      maxFileSize: 250, // 250 GB (SharePoint max)
    },
  },
};

// Secret key for signing licenses - in production, store securely!
const LICENSE_SECRET = process.env.UNOCLOUD_LICENSE_SECRET || 'unocloud-default-secret-change-me';

export class LicenseManager {
  private licensesFile: string;
  private licenses: Map<string, License> = new Map();

  constructor(configDir?: string) {
    const dir = configDir || path.join(process.cwd(), PATHS.CONFIG_DIR);
    this.licensesFile = path.join(dir, 'licenses.json');

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.loadLicenses();
  }

  private loadLicenses(): void {
    if (fs.existsSync(this.licensesFile)) {
      try {
        const data = fs.readFileSync(this.licensesFile, 'utf-8');
        const licensesArray: License[] = JSON.parse(data);
        licensesArray.forEach((license) => this.licenses.set(license.key, license));
        logger.debug(`Loaded ${this.licenses.size} license(s)`);
      } catch (error) {
        logger.error('Failed to load licenses:', error);
      }
    }
  }

  private saveLicenses(): void {
    const licensesArray = Array.from(this.licenses.values());
    fs.writeFileSync(this.licensesFile, JSON.stringify(licensesArray, null, 2));
  }

  /**
   * Generate a new license key
   */
  generateKey(): string {
    // Format: XXXX-XXXX-XXXX-XXXX (20 chars)
    const segments: string[] = [];
    for (let i = 0; i < 4; i++) {
      segments.push(
        crypto
          .randomBytes(3)
          .toString('base64')
          .replace(/[^A-Z0-9]/gi, '')
          .substring(0, 4)
          .toUpperCase()
      );
    }
    return segments.join('-');
  }

  /**
   * Create a signed license key with embedded metadata
   */
  createSignedKey(tier: LicenseTier, expiresInDays?: number): string {
    const payload = {
      t: tier.charAt(0), // s, p, or e
      c: Date.now(),
      x: expiresInDays || 0,
      r: crypto.randomBytes(4).toString('hex'),
    };

    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', LICENSE_SECRET)
      .update(data)
      .digest('base64url')
      .substring(0, 8);

    // Format: UC-TIER-DATA-SIG
    return `UC-${tier.substring(0, 3).toUpperCase()}-${data}-${signature}`;
  }

  /**
   * Validate and decode a signed license key
   */
  validateSignedKey(key: string): { valid: boolean; tier?: LicenseTier; expiresAt?: Date; error?: string } {
    try {
      const parts = key.split('-');
      if (parts.length !== 4 || parts[0] !== 'UC') {
        return { valid: false, error: 'Invalid key format' };
      }

      const tierCode = parts[1].toLowerCase();
      const data = parts[2];
      const providedSig = parts[3];

      // Verify signature
      const expectedSig = crypto
        .createHmac('sha256', LICENSE_SECRET)
        .update(data)
        .digest('base64url')
        .substring(0, 8);

      if (providedSig !== expectedSig) {
        return { valid: false, error: 'Invalid signature' };
      }

      // Decode payload
      const payload = JSON.parse(Buffer.from(data, 'base64url').toString());

      // Map tier code
      const tierMap: Record<string, LicenseTier> = {
        sta: 'starter',
        pro: 'professional',
        ent: 'enterprise',
      };
      const tier = tierMap[tierCode];
      if (!tier) {
        return { valid: false, error: 'Invalid tier' };
      }

      // Check expiration
      let expiresAt: Date | undefined;
      if (payload.x > 0) {
        expiresAt = new Date(payload.c + payload.x * 24 * 60 * 60 * 1000);
        if (expiresAt < new Date()) {
          return { valid: false, error: 'License expired' };
        }
      }

      return { valid: true, tier, expiresAt };
    } catch (error) {
      return { valid: false, error: 'Failed to parse key' };
    }
  }

  /**
   * Create a new license
   */
  createLicense(
    clientName: string,
    clientEmail: string,
    tier: LicenseTier,
    expiresInDays?: number
  ): License {
    const key = this.createSignedKey(tier, expiresInDays);
    const tierConfig = TIER_FEATURES[tier];

    const license: License = {
      key,
      clientName,
      clientEmail,
      createdAt: new Date().toISOString(),
      expiresAt: expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
        : null,
      maxMappings: tierConfig.maxMappings,
      features: tierConfig.features,
      activated: false,
    };

    this.licenses.set(key, license);
    this.saveLicenses();

    logger.info(`Created ${tier} license for ${clientName}: ${key}`);
    return license;
  }

  /**
   * Get a license by key
   */
  getLicense(key: string): License | undefined {
    return this.licenses.get(key);
  }

  /**
   * Get all licenses
   */
  getAllLicenses(): License[] {
    return Array.from(this.licenses.values());
  }

  /**
   * Activate a license (link to tenant)
   */
  activateLicense(key: string, tenantId: string): License {
    const license = this.licenses.get(key);
    if (!license) {
      throw new Error('License not found');
    }

    if (license.activated) {
      throw new Error('License already activated');
    }

    // Validate the key is still valid
    const validation = this.validateSignedKey(key);
    if (!validation.valid) {
      throw new Error(`Invalid license: ${validation.error}`);
    }

    license.activated = true;
    license.activatedAt = new Date().toISOString();
    license.tenantId = tenantId;

    this.licenses.set(key, license);
    this.saveLicenses();

    logger.info(`Activated license ${key} for tenant ${tenantId}`);
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

    logger.info(`Revoked license: ${key}`);
    return true;
  }

  /**
   * Check if a license allows a feature
   */
  checkFeature(key: string, feature: keyof LicenseFeatures): boolean {
    const license = this.licenses.get(key);
    if (!license || !license.activated) {
      return false;
    }

    // Check expiration
    if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
      return false;
    }

    return !!license.features[feature];
  }

  /**
   * Check if tenant can add more mappings
   */
  canAddMapping(key: string, currentMappings: number): boolean {
    const license = this.licenses.get(key);
    if (!license || !license.activated) {
      return false;
    }

    if (license.maxMappings === -1) {
      return true; // unlimited
    }

    return currentMappings < license.maxMappings;
  }

  /**
   * Get license for a tenant
   */
  getLicenseForTenant(tenantId: string): License | undefined {
    return Array.from(this.licenses.values()).find((l) => l.tenantId === tenantId);
  }
}
