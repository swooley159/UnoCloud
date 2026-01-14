/**
 * Generic Azure AD Authentication
 * Reusable MSAL authentication for any Azure integration
 */

import {
  ConfidentialClientApplication,
  Configuration,
  AuthenticationResult,
} from '@azure/msal-node';
import { AzureTenantCredentials, TokenInfo, TokenStore } from './types';

// Default scopes for Microsoft Graph
const DEFAULT_SCOPES = ['https://graph.microsoft.com/.default'];

export class AzureAuthProvider {
  private clients: Map<string, ConfidentialClientApplication> = new Map();
  private tokenStore: TokenStore;
  private defaultScopes: string[];

  constructor(options?: { scopes?: string[]; tokenStore?: TokenStore }) {
    this.defaultScopes = options?.scopes || DEFAULT_SCOPES;
    this.tokenStore = options?.tokenStore || new InMemoryTokenStore();
  }

  /**
   * Get or create MSAL client for credentials
   */
  private getClient(credentials: AzureTenantCredentials): ConfidentialClientApplication {
    const cacheKey = `${credentials.tenantId}:${credentials.clientId}`;

    if (this.clients.has(cacheKey)) {
      return this.clients.get(cacheKey)!;
    }

    const config: Configuration = {
      auth: {
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        authority: `https://login.microsoftonline.com/${credentials.tenantId}`,
      },
    };

    const client = new ConfidentialClientApplication(config);
    this.clients.set(cacheKey, client);

    return client;
  }

  /**
   * Acquire access token using client credentials
   */
  async getAccessToken(
    credentials: AzureTenantCredentials,
    scopes?: string[]
  ): Promise<string> {
    const scopesToUse = scopes || this.defaultScopes;

    // Check cache
    const cached = this.tokenStore.get(credentials.tenantId);
    if (cached && cached.expiresAt > new Date() && this.scopesMatch(cached.scopes, scopesToUse)) {
      return cached.accessToken;
    }

    const client = this.getClient(credentials);

    const result: AuthenticationResult | null = await client.acquireTokenByClientCredential({
      scopes: scopesToUse,
    });

    if (!result || !result.accessToken) {
      throw new Error('Failed to acquire access token');
    }

    // Cache token
    const expiresAt = result.expiresOn || new Date(Date.now() + 3600 * 1000);
    this.tokenStore.set(credentials.tenantId, {
      accessToken: result.accessToken,
      expiresAt: new Date(expiresAt),
      scopes: scopesToUse,
    });

    return result.accessToken;
  }

  /**
   * Test if credentials are valid
   */
  async validateCredentials(credentials: AzureTenantCredentials): Promise<{
    valid: boolean;
    error?: string;
  }> {
    try {
      await this.getAccessToken(credentials);
      return { valid: true };
    } catch (error: any) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Validate credential format (without making API call)
   */
  validateCredentialFormat(credentials: AzureTenantCredentials): string[] {
    const errors: string[] = [];
    const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!credentials.tenantId || !guidRegex.test(credentials.tenantId)) {
      errors.push('Invalid tenant ID format (expected GUID)');
    }

    if (!credentials.clientId || !guidRegex.test(credentials.clientId)) {
      errors.push('Invalid client ID format (expected GUID)');
    }

    if (!credentials.clientSecret || credentials.clientSecret.length < 10) {
      errors.push('Client secret is required (minimum 10 characters)');
    }

    return errors;
  }

  /**
   * Clear token cache
   */
  clearCache(tenantId?: string): void {
    this.tokenStore.clear(tenantId);
    if (tenantId) {
      for (const key of this.clients.keys()) {
        if (key.startsWith(`${tenantId}:`)) {
          this.clients.delete(key);
        }
      }
    } else {
      this.clients.clear();
    }
  }

  private scopesMatch(cached: string[], requested: string[]): boolean {
    return requested.every((s) => cached.includes(s));
  }
}

/**
 * Simple in-memory token store
 */
class InMemoryTokenStore implements TokenStore {
  private tokens: Map<string, TokenInfo> = new Map();

  get(tenantId: string): TokenInfo | undefined {
    return this.tokens.get(tenantId);
  }

  set(tenantId: string, token: TokenInfo): void {
    this.tokens.set(tenantId, token);
  }

  clear(tenantId?: string): void {
    if (tenantId) {
      this.tokens.delete(tenantId);
    } else {
      this.tokens.clear();
    }
  }
}

// Default singleton instance
export const azureAuth = new AzureAuthProvider();
