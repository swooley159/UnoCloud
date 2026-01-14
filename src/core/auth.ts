/**
 * Azure AD Authentication
 * Handles MSAL authentication for Microsoft Graph API
 */

import {
  ConfidentialClientApplication,
  Configuration,
  AuthenticationResult,
} from '@azure/msal-node';
import { AzureConfig, AuthToken, TokenCache } from '../types';
import { GRAPH_API } from '../utils/constants';
import { logger } from '../utils/logger';

export class AuthManager {
  private clients: Map<string, ConfidentialClientApplication> = new Map();
  private tokenCache: TokenCache = {};

  /**
   * Get or create MSAL client for a tenant
   */
  private getClient(tenantId: string, azure: AzureConfig): ConfidentialClientApplication {
    const cacheKey = `${tenantId}:${azure.clientId}`;

    if (this.clients.has(cacheKey)) {
      return this.clients.get(cacheKey)!;
    }

    const config: Configuration = {
      auth: {
        clientId: azure.clientId,
        clientSecret: azure.clientSecret,
        authority: `https://login.microsoftonline.com/${azure.tenantId}`,
      },
      system: {
        loggerOptions: {
          loggerCallback: (level, message) => {
            if (level <= 1) {
              logger.debug(`MSAL: ${message}`);
            }
          },
          piiLoggingEnabled: false,
          logLevel: 0,
        },
      },
    };

    const client = new ConfidentialClientApplication(config);
    this.clients.set(cacheKey, client);

    return client;
  }

  /**
   * Acquire access token using client credentials flow
   */
  async getAccessToken(tenantId: string, azure: AzureConfig): Promise<string> {
    // Check cache first
    const cached = this.tokenCache[tenantId];
    if (cached && cached.expiresAt > new Date()) {
      logger.debug(`Using cached token for tenant ${tenantId}`);
      return cached.accessToken;
    }

    logger.debug(`Acquiring new token for tenant ${tenantId}`);

    const client = this.getClient(tenantId, azure);

    try {
      const result: AuthenticationResult | null = await client.acquireTokenByClientCredential({
        scopes: GRAPH_API.SCOPES,
      });

      if (!result || !result.accessToken) {
        throw new Error('Failed to acquire access token');
      }

      // Cache the token
      const expiresAt = result.expiresOn || new Date(Date.now() + 3600 * 1000);
      this.tokenCache[tenantId] = {
        accessToken: result.accessToken,
        expiresAt: new Date(expiresAt),
      };

      logger.info(`Acquired access token for tenant ${tenantId} (expires: ${expiresAt})`);
      return result.accessToken;
    } catch (error: any) {
      logger.error(`Failed to acquire token for tenant ${tenantId}: ${error.message}`);
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  /**
   * Test authentication for a tenant
   */
  async testAuth(tenantId: string, azure: AzureConfig): Promise<boolean> {
    try {
      await this.getAccessToken(tenantId, azure);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear cached token for a tenant
   */
  clearCache(tenantId?: string): void {
    if (tenantId) {
      delete this.tokenCache[tenantId];
      // Also clear the MSAL client
      for (const key of this.clients.keys()) {
        if (key.startsWith(`${tenantId}:`)) {
          this.clients.delete(key);
        }
      }
    } else {
      this.tokenCache = {};
      this.clients.clear();
    }
  }
}

// Singleton instance
export const authManager = new AuthManager();
