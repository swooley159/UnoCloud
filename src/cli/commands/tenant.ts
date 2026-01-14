/**
 * Tenant management CLI commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { table } from 'table';
import ora from 'ora';
import { TenantManager } from '../../core/tenant';
import { authManager } from '../../core/auth';

const tenantManager = new TenantManager();

export const tenantCommands = new Command('tenant')
  .description('Manage Azure tenant configurations');

// Add tenant
tenantCommands
  .command('add')
  .description('Add a new tenant configuration')
  .requiredOption('-n, --name <name>', 'Tenant display name')
  .requiredOption('-t, --tenant-id <id>', 'Azure AD Tenant ID (GUID)')
  .requiredOption('-c, --client-id <id>', 'Azure AD App Client ID (GUID)')
  .requiredOption('-s, --client-secret <secret>', 'Azure AD App Client Secret')
  .option('--test', 'Test authentication after adding')
  .action(async (options) => {
    try {
      const azure = {
        tenantId: options.tenantId,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
      };

      const errors = tenantManager.validateAzureConfig(azure);
      if (errors.length > 0) {
        console.error(chalk.red('Validation errors:'));
        errors.forEach((e) => console.error(chalk.red(`  - ${e}`)));
        process.exit(1);
      }

      const tenant = tenantManager.addTenant(options.name, azure);
      console.log(chalk.green(`✓ Added tenant: ${tenant.name} (${tenant.id})`));

      if (options.test) {
        const spinner = ora('Testing authentication...').start();
        const success = await authManager.testAuth(tenant.id, azure);
        if (success) {
          spinner.succeed('Authentication successful');
        } else {
          spinner.fail('Authentication failed - check credentials');
        }
      }
    } catch (error: any) {
      console.error(chalk.red(`Failed to add tenant: ${error.message}`));
      process.exit(1);
    }
  });

// List tenants
tenantCommands
  .command('list')
  .alias('ls')
  .description('List all configured tenants')
  .action(() => {
    const tenants = tenantManager.getAllTenants();

    if (tenants.length === 0) {
      console.log(chalk.yellow('No tenants configured. Use "unocloud tenant add" to add one.'));
      return;
    }

    const data = [
      ['ID', 'Name', 'Tenant ID', 'Mappings', 'Created'],
      ...tenants.map((t) => [
        t.id,
        t.name,
        t.azure.tenantId.substring(0, 8) + '...',
        t.mappings.length.toString(),
        new Date(t.createdAt).toLocaleDateString(),
      ]),
    ];

    console.log(table(data));
  });

// Show tenant details
tenantCommands
  .command('show <tenant-id>')
  .description('Show tenant details')
  .action((tenantId) => {
    const tenant = tenantManager.getTenant(tenantId);

    if (!tenant) {
      console.error(chalk.red(`Tenant "${tenantId}" not found`));
      process.exit(1);
    }

    console.log(chalk.bold('\nTenant Details:'));
    console.log(`  ID:         ${tenant.id}`);
    console.log(`  Name:       ${tenant.name}`);
    console.log(`  Tenant ID:  ${tenant.azure.tenantId}`);
    console.log(`  Client ID:  ${tenant.azure.clientId}`);
    console.log(`  Created:    ${tenant.createdAt}`);
    console.log(`  Updated:    ${tenant.updatedAt}`);

    console.log(chalk.bold('\nSync Options:'));
    console.log(`  Mode:             ${tenant.options.mode}`);
    console.log(`  Delete after:     ${tenant.options.deleteAfterSync}`);
    console.log(`  Preserve folders: ${tenant.options.preserveFolderStructure}`);
    console.log(`  Conflict:         ${tenant.options.conflictResolution}`);

    if (tenant.mappings.length > 0) {
      console.log(chalk.bold('\nMappings:'));
      tenant.mappings.forEach((m, i) => {
        console.log(`  ${i + 1}. ${m.source}`);
        console.log(`     → ${m.destination.siteUrl}/${m.destination.library}/${m.destination.folder || ''}`);
        console.log(`     Enabled: ${m.enabled}`);
      });
    } else {
      console.log(chalk.yellow('\nNo mappings configured.'));
    }
  });

// Remove tenant
tenantCommands
  .command('remove <tenant-id>')
  .alias('rm')
  .description('Remove a tenant configuration')
  .option('-f, --force', 'Skip confirmation')
  .action((tenantId, options) => {
    const tenant = tenantManager.getTenant(tenantId);

    if (!tenant) {
      console.error(chalk.red(`Tenant "${tenantId}" not found`));
      process.exit(1);
    }

    if (!options.force) {
      console.log(chalk.yellow(`Warning: This will remove tenant "${tenant.name}" and all its mappings.`));
      console.log(chalk.yellow('Use --force to skip this confirmation.'));
      process.exit(0);
    }

    tenantManager.removeTenant(tenantId);
    console.log(chalk.green(`✓ Removed tenant: ${tenant.name}`));
  });

// Test tenant auth
tenantCommands
  .command('test <tenant-id>')
  .description('Test authentication for a tenant')
  .action(async (tenantId) => {
    const tenant = tenantManager.getTenant(tenantId);

    if (!tenant) {
      console.error(chalk.red(`Tenant "${tenantId}" not found`));
      process.exit(1);
    }

    const spinner = ora(`Testing authentication for ${tenant.name}...`).start();

    try {
      const success = await authManager.testAuth(tenant.id, tenant.azure);
      if (success) {
        spinner.succeed('Authentication successful');
      } else {
        spinner.fail('Authentication failed');
        process.exit(1);
      }
    } catch (error: any) {
      spinner.fail(`Authentication error: ${error.message}`);
      process.exit(1);
    }
  });
