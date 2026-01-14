/**
 * Client Enrollment System
 * Self-service tenant registration with license keys
 */

import { TenantManager } from './tenant';
import { LicenseManager, License, LicenseTier } from './license';
import { authManager } from './auth';
import { logger } from '../utils/logger';

export interface EnrollmentRequest {
  licenseKey: string;
  tenantName: string;
  azure: {
    tenantId: string;
    clientId: string;
    clientSecret: string;
  };
}

export interface EnrollmentResult {
  success: boolean;
  tenantId?: string;
  license?: License;
  error?: string;
}

export class EnrollmentService {
  private tenantManager: TenantManager;
  private licenseManager: LicenseManager;

  constructor(tenantManager: TenantManager, licenseManager: LicenseManager) {
    this.tenantManager = tenantManager;
    this.licenseManager = licenseManager;
  }

  /**
   * Enroll a new client with a license key
   */
  async enroll(request: EnrollmentRequest): Promise<EnrollmentResult> {
    const { licenseKey, tenantName, azure } = request;

    // Step 1: Validate license key
    logger.info(`Processing enrollment for ${tenantName}`);

    const license = this.licenseManager.getLicense(licenseKey);
    if (!license) {
      // Try validating as a new signed key
      const validation = this.licenseManager.validateSignedKey(licenseKey);
      if (!validation.valid) {
        return { success: false, error: `Invalid license key: ${validation.error}` };
      }
    } else if (license.activated) {
      return { success: false, error: 'License key has already been activated' };
    }

    // Step 2: Validate Azure credentials
    const azureErrors = this.tenantManager.validateAzureConfig(azure);
    if (azureErrors.length > 0) {
      return { success: false, error: `Invalid Azure configuration: ${azureErrors.join(', ')}` };
    }

    // Step 3: Test Azure AD authentication
    const tempTenantId = `temp_${Date.now()}`;
    try {
      const authSuccess = await authManager.testAuth(tempTenantId, azure);
      if (!authSuccess) {
        return { success: false, error: 'Azure AD authentication failed. Check your credentials.' };
      }
    } catch (error: any) {
      return { success: false, error: `Authentication error: ${error.message}` };
    } finally {
      authManager.clearCache(tempTenantId);
    }

    // Step 4: Create tenant
    try {
      const tenant = this.tenantManager.addTenant(tenantName, azure);

      // Step 5: Activate license
      const activatedLicense = this.licenseManager.activateLicense(licenseKey, tenant.id);

      logger.info(`Enrollment successful for ${tenantName} (${tenant.id})`);

      return {
        success: true,
        tenantId: tenant.id,
        license: activatedLicense,
      };
    } catch (error: any) {
      return { success: false, error: `Enrollment failed: ${error.message}` };
    }
  }

  /**
   * Generate enrollment instructions for a client
   */
  generateEnrollmentInstructions(license: License): string {
    return `
================================================================================
                         UnoCloud Enrollment Instructions
================================================================================

Welcome, ${license.clientName}!

Your License Key: ${license.key}

This key is valid for:
- Tier: ${this.getTierFromLicense(license)}
- Max Mappings: ${license.maxMappings === -1 ? 'Unlimited' : license.maxMappings}
- Max File Size: ${license.features.maxFileSize} GB
${license.expiresAt ? `- Expires: ${new Date(license.expiresAt).toLocaleDateString()}` : '- No Expiration'}

Features Included:
${license.features.scheduling ? '✓' : '✗'} Scheduled Sync
${license.features.bidirectionalSync ? '✓' : '✗'} Bidirectional Sync
${license.features.emailNotifications ? '✓' : '✗'} Email Notifications
${license.features.prioritySupport ? '✓' : '✗'} Priority Support

--------------------------------------------------------------------------------
                              SETUP INSTRUCTIONS
--------------------------------------------------------------------------------

STEP 1: Register an Azure AD Application

1. Go to Azure Portal: https://portal.azure.com
2. Navigate to: Azure Active Directory → App registrations → New registration
3. Name: "UnoCloud Migration"
4. Account type: "Accounts in this organizational directory only"
5. Click "Register"

STEP 2: Configure API Permissions

1. Go to: API permissions → Add a permission
2. Select: Microsoft Graph → Application permissions
3. Add these permissions:
   - Sites.ReadWrite.All
   - Files.ReadWrite.All
4. Click: "Grant admin consent for [Your Organization]"

STEP 3: Create Client Secret

1. Go to: Certificates & secrets → New client secret
2. Description: "UnoCloud"
3. Expiration: Choose based on your policy
4. Click "Add" and COPY THE SECRET VALUE (you won't see it again!)

STEP 4: Run Enrollment

unocloud enroll \\
  --license "${license.key}" \\
  --name "Your Company Name" \\
  --tenant-id "YOUR_AZURE_TENANT_ID" \\
  --client-id "YOUR_APP_CLIENT_ID" \\
  --client-secret "YOUR_CLIENT_SECRET"

--------------------------------------------------------------------------------

Need help? Contact support at support@unocloud.io

================================================================================
`;
  }

  private getTierFromLicense(license: License): string {
    if (license.maxMappings === -1) return 'Enterprise';
    if (license.maxMappings === 10) return 'Professional';
    return 'Starter';
  }
}
