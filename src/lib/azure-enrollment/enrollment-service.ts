/**
 * Generic Enrollment Service
 * Handles client self-registration with license keys
 */

import { v4 as uuidv4 } from 'uuid';
import {
  EnrollmentConfig,
  EnrollmentRequest,
  EnrollmentResult,
  AzureTenantCredentials,
  GenericLicense,
  AzureAppConfig,
} from './types';
import { LicenseGenerator } from './license-generator';
import { AzureAuthProvider } from './azure-auth';

export interface RegisteredOrganization {
  id: string;
  name: string;
  credentials: AzureTenantCredentials;
  licenseKey: string;
  metadata: Record<string, any>;
  registeredAt: string;
}

export class EnrollmentService {
  private config: EnrollmentConfig;
  private licenseGenerator: LicenseGenerator;
  private authProvider: AzureAuthProvider;
  private organizations: Map<string, RegisteredOrganization> = new Map();

  constructor(
    config: EnrollmentConfig,
    licenseGenerator: LicenseGenerator,
    authProvider?: AzureAuthProvider
  ) {
    this.config = config;
    this.licenseGenerator = licenseGenerator;
    this.authProvider = authProvider || new AzureAuthProvider();
  }

  /**
   * Enroll a new organization
   */
  async enroll(request: EnrollmentRequest): Promise<EnrollmentResult> {
    const { licenseKey, organizationName, credentials, metadata } = request;

    // Step 1: Validate license
    const license = this.licenseGenerator.getLicense(licenseKey);
    if (!license) {
      const validation = this.licenseGenerator.validateKey(licenseKey);
      if (!validation.valid) {
        return { success: false, error: `Invalid license: ${validation.error}` };
      }
    } else if (license.activated) {
      return { success: false, error: 'License already activated' };
    }

    // Step 2: Validate credential format
    const formatErrors = this.authProvider.validateCredentialFormat(credentials);
    if (formatErrors.length > 0) {
      return { success: false, validationErrors: formatErrors };
    }

    // Step 3: Custom validation (if provided)
    if (this.config.customValidation) {
      const customErrors = await this.config.customValidation(credentials);
      if (customErrors.length > 0) {
        return { success: false, validationErrors: customErrors };
      }
    }

    // Step 4: Test Azure authentication (if enabled)
    if (this.config.validateAuth !== false) {
      const authResult = await this.authProvider.validateCredentials(credentials);
      if (!authResult.valid) {
        return { success: false, error: `Authentication failed: ${authResult.error}` };
      }
    }

    // Step 5: Create organization record
    const orgId = this.generateOrgId(organizationName);
    const org: RegisteredOrganization = {
      id: orgId,
      name: organizationName,
      credentials,
      licenseKey,
      metadata: metadata || {},
      registeredAt: new Date().toISOString(),
    };

    // Step 6: Activate license
    const activatedLicense = this.licenseGenerator.activateLicense(licenseKey, orgId);

    // Step 7: Store organization
    this.organizations.set(orgId, org);

    // Step 8: Callback
    const result: EnrollmentResult = {
      success: true,
      organizationId: orgId,
      license: activatedLicense,
    };

    if (this.config.onEnrollment) {
      await this.config.onEnrollment(result);
    }

    return result;
  }

  /**
   * Get organization by ID
   */
  getOrganization(orgId: string): RegisteredOrganization | undefined {
    return this.organizations.get(orgId);
  }

  /**
   * Get all organizations
   */
  getAllOrganizations(): RegisteredOrganization[] {
    return Array.from(this.organizations.values());
  }

  /**
   * Generate setup instructions for Azure AD app
   */
  generateSetupInstructions(
    license: GenericLicense,
    appConfig: AzureAppConfig
  ): string {
    const permissions = appConfig.requiredPermissions
      .map((p) => `   - ${p.permission} (${p.type})`)
      .join('\n');

    return `
================================================================================
                    ${this.config.productName} - Setup Instructions
================================================================================

Welcome, ${license.clientName}!

Your License Key: ${license.key}
Tier: ${license.tierCode}
${license.expiresAt ? `Expires: ${new Date(license.expiresAt).toLocaleDateString()}` : 'No Expiration'}

Features: ${license.features.join(', ') || 'Standard'}

--------------------------------------------------------------------------------
                         AZURE AD APP REGISTRATION
--------------------------------------------------------------------------------

1. Go to Azure Portal: https://portal.azure.com
2. Navigate to: Azure Active Directory → App registrations
3. Click: "New registration"
4. Configure:
   - Name: "${appConfig.displayName}"
   - Account type: "Accounts in this organizational directory only"
5. Click "Register"

REQUIRED PERMISSIONS:
${permissions}

After adding permissions, click "Grant admin consent for [Your Organization]"

CREATE CLIENT SECRET:
1. Go to: Certificates & secrets → New client secret
2. Description: "${this.config.productName}"
3. Copy the secret value immediately!

--------------------------------------------------------------------------------
                              ENROLLMENT COMMAND
--------------------------------------------------------------------------------

Run this command with your Azure details:

${this.config.productName.toLowerCase().replace(/\s+/g, '-')} enroll \\
  --license "${license.key}" \\
  --name "Your Organization Name" \\
  --tenant-id "YOUR_AZURE_TENANT_ID" \\
  --client-id "YOUR_APP_CLIENT_ID" \\
  --client-secret "YOUR_CLIENT_SECRET"

================================================================================
`;
  }

  private generateOrgId(name: string): string {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return `${slug}-${uuidv4().substring(0, 8)}`;
  }
}
