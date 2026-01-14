/**
 * Azure Enrollment Library - Generic Types
 * Reusable across any project requiring Azure AD tenant onboarding
 */

// ============================================================================
// Azure Configuration
// ============================================================================

export interface AzureTenantCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface AzureAppPermission {
  api: 'microsoft-graph' | 'sharepoint' | 'outlook' | 'custom';
  permission: string;
  type: 'delegated' | 'application';
}

export interface AzureAppConfig {
  displayName: string;
  requiredPermissions: AzureAppPermission[];
  redirectUris?: string[];
  description?: string;
}

// ============================================================================
// License System
// ============================================================================

export interface LicenseConfig {
  secretKey: string;           // For signing licenses
  issuer: string;              // Your company/product name
  storageDir?: string;         // Where to store license data
}

export interface LicenseTierDefinition {
  name: string;
  code: string;                // Short code for key generation (3 chars)
  limits: Record<string, number | boolean>;
  features: string[];
}

export interface GenericLicense {
  key: string;
  tierCode: string;
  clientName: string;
  clientEmail: string;
  metadata: Record<string, any>;
  limits: Record<string, number | boolean>;
  features: string[];
  createdAt: string;
  expiresAt: string | null;
  activated: boolean;
  activatedAt?: string;
  activatedTenantId?: string;
}

// ============================================================================
// Enrollment
// ============================================================================

export interface EnrollmentConfig {
  productName: string;
  validateAuth?: boolean;      // Test Azure auth during enrollment
  onEnrollment?: (enrollment: EnrollmentResult) => Promise<void>;
  customValidation?: (credentials: AzureTenantCredentials) => Promise<string[]>;
}

export interface EnrollmentRequest {
  licenseKey: string;
  organizationName: string;
  credentials: AzureTenantCredentials;
  metadata?: Record<string, any>;
}

export interface EnrollmentResult {
  success: boolean;
  organizationId?: string;
  license?: GenericLicense;
  error?: string;
  validationErrors?: string[];
}

// ============================================================================
// Token Management
// ============================================================================

export interface TokenInfo {
  accessToken: string;
  expiresAt: Date;
  scopes: string[];
}

export interface TokenStore {
  get(tenantId: string): TokenInfo | undefined;
  set(tenantId: string, token: TokenInfo): void;
  clear(tenantId?: string): void;
}
