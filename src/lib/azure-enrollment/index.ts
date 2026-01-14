/**
 * Azure Enrollment Library
 *
 * A reusable library for Azure AD tenant enrollment and license management.
 * Use this for any project that needs to onboard clients with Azure integrations.
 *
 * @example
 * ```typescript
 * import {
 *   LicenseGenerator,
 *   EnrollmentService,
 *   AzureAuthProvider
 * } from './lib/azure-enrollment';
 *
 * // 1. Create license generator
 * const licenses = new LicenseGenerator({
 *   secretKey: 'your-secret-key',
 *   issuer: 'YourProduct',
 * });
 *
 * // 2. Define tiers
 * licenses.registerTiers([
 *   {
 *     name: 'Starter',
 *     code: 'STR',
 *     limits: { maxUsers: 5 },
 *     features: ['basic-sync'],
 *   },
 *   {
 *     name: 'Professional',
 *     code: 'PRO',
 *     limits: { maxUsers: 50 },
 *     features: ['basic-sync', 'advanced-sync', 'scheduling'],
 *   },
 * ]);
 *
 * // 3. Create enrollment service
 * const enrollment = new EnrollmentService(
 *   { productName: 'Your Product', validateAuth: true },
 *   licenses
 * );
 *
 * // 4. Generate license for client
 * const license = licenses.createLicense(
 *   'Acme Corp',
 *   'admin@acme.com',
 *   'PRO',
 *   365 // expires in 365 days
 * );
 *
 * // 5. Client enrolls themselves
 * const result = await enrollment.enroll({
 *   licenseKey: license.key,
 *   organizationName: 'Acme Corp',
 *   credentials: {
 *     tenantId: '...',
 *     clientId: '...',
 *     clientSecret: '...',
 *   },
 * });
 * ```
 */

// Types
export * from './types';

// Core classes
export { LicenseGenerator } from './license-generator';
export { AzureAuthProvider, azureAuth } from './azure-auth';
export { EnrollmentService } from './enrollment-service';
export type { RegisteredOrganization } from './enrollment-service';

// Presets for common use cases
export const GRAPH_SCOPES = {
  DEFAULT: ['https://graph.microsoft.com/.default'],
  USER_READ: ['https://graph.microsoft.com/User.Read'],
  CALENDARS: [
    'https://graph.microsoft.com/Calendars.Read',
    'https://graph.microsoft.com/Calendars.ReadWrite',
  ],
  FILES: [
    'https://graph.microsoft.com/Files.Read.All',
    'https://graph.microsoft.com/Files.ReadWrite.All',
  ],
  SITES: [
    'https://graph.microsoft.com/Sites.Read.All',
    'https://graph.microsoft.com/Sites.ReadWrite.All',
  ],
  MAIL: [
    'https://graph.microsoft.com/Mail.Read',
    'https://graph.microsoft.com/Mail.Send',
  ],
};

// Common Azure app permission sets
export const PERMISSION_PRESETS = {
  CALENDAR_SYNC: [
    { api: 'microsoft-graph' as const, permission: 'User.Read', type: 'application' as const },
    { api: 'microsoft-graph' as const, permission: 'Calendars.Read', type: 'application' as const },
    { api: 'microsoft-graph' as const, permission: 'Calendars.ReadWrite', type: 'application' as const },
  ],
  FILE_MIGRATION: [
    { api: 'microsoft-graph' as const, permission: 'Sites.ReadWrite.All', type: 'application' as const },
    { api: 'microsoft-graph' as const, permission: 'Files.ReadWrite.All', type: 'application' as const },
  ],
  MAIL_INTEGRATION: [
    { api: 'microsoft-graph' as const, permission: 'Mail.Read', type: 'application' as const },
    { api: 'microsoft-graph' as const, permission: 'Mail.Send', type: 'application' as const },
  ],
};
