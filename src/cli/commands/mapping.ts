/**
 * Mapping management CLI commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { table } from 'table';
import { TenantManager } from '../../core/tenant';

const tenantManager = new TenantManager();

export const mappingCommands = new Command('mapping')
  .description('Manage source-to-SharePoint mappings');

// Add mapping
mappingCommands
  .command('add <tenant-id>')
  .description('Add a new source-to-destination mapping')
  .requiredOption('-s, --source <path>', 'Source directory path (local)')
  .requiredOption('--site <url>', 'SharePoint site URL')
  .requiredOption('-l, --library <name>', 'Document library name')
  .option('-f, --folder <path>', 'Destination folder within library')
  .option('--include <patterns>', 'Include file patterns (comma-separated)')
  .option('--exclude <patterns>', 'Exclude file patterns (comma-separated)')
  .action((tenantId, options) => {
    const tenant = tenantManager.getTenant(tenantId);

    if (!tenant) {
      console.error(chalk.red(`Tenant "${tenantId}" not found`));
      process.exit(1);
    }

    try {
      const filters = {
        include: options.include ? options.include.split(',').map((s: string) => s.trim()) : undefined,
        exclude: options.exclude ? options.exclude.split(',').map((s: string) => s.trim()) : undefined,
      };

      const mapping = tenantManager.addMapping(
        tenantId,
        options.source,
        {
          siteUrl: options.site,
          library: options.library,
          folder: options.folder,
        },
        Object.keys(filters).length > 0 ? filters : undefined
      );

      console.log(chalk.green(`✓ Added mapping:`));
      console.log(`  Source: ${mapping.source}`);
      console.log(`  Destination: ${options.site}/${options.library}/${options.folder || ''}`);
      console.log(`  Mapping ID: ${mapping.id}`);
    } catch (error: any) {
      console.error(chalk.red(`Failed to add mapping: ${error.message}`));
      process.exit(1);
    }
  });

// List mappings
mappingCommands
  .command('list <tenant-id>')
  .alias('ls')
  .description('List all mappings for a tenant')
  .action((tenantId) => {
    const tenant = tenantManager.getTenant(tenantId);

    if (!tenant) {
      console.error(chalk.red(`Tenant "${tenantId}" not found`));
      process.exit(1);
    }

    if (tenant.mappings.length === 0) {
      console.log(chalk.yellow('No mappings configured. Use "unocloud mapping add" to add one.'));
      return;
    }

    const data = [
      ['#', 'Source', 'Destination', 'Enabled'],
      ...tenant.mappings.map((m, i) => [
        (i + 1).toString(),
        m.source.length > 40 ? '...' + m.source.slice(-37) : m.source,
        `${new URL(m.destination.siteUrl).pathname}/${m.destination.library}`,
        m.enabled ? chalk.green('Yes') : chalk.red('No'),
      ]),
    ];

    console.log(table(data));
  });

// Remove mapping
mappingCommands
  .command('remove <tenant-id> <mapping-index>')
  .alias('rm')
  .description('Remove a mapping by index (use "mapping list" to see indices)')
  .action((tenantId, mappingIndex) => {
    const tenant = tenantManager.getTenant(tenantId);

    if (!tenant) {
      console.error(chalk.red(`Tenant "${tenantId}" not found`));
      process.exit(1);
    }

    const index = parseInt(mappingIndex, 10) - 1;
    if (isNaN(index) || index < 0 || index >= tenant.mappings.length) {
      console.error(chalk.red(`Invalid mapping index: ${mappingIndex}`));
      process.exit(1);
    }

    const mapping = tenant.mappings[index];
    tenantManager.removeMapping(tenantId, mapping.id);

    console.log(chalk.green(`✓ Removed mapping: ${mapping.source}`));
  });

// Enable/disable mapping
mappingCommands
  .command('toggle <tenant-id> <mapping-index>')
  .description('Enable or disable a mapping')
  .option('--enable', 'Enable the mapping')
  .option('--disable', 'Disable the mapping')
  .action((tenantId, mappingIndex, options) => {
    const tenant = tenantManager.getTenant(tenantId);

    if (!tenant) {
      console.error(chalk.red(`Tenant "${tenantId}" not found`));
      process.exit(1);
    }

    const index = parseInt(mappingIndex, 10) - 1;
    if (isNaN(index) || index < 0 || index >= tenant.mappings.length) {
      console.error(chalk.red(`Invalid mapping index: ${mappingIndex}`));
      process.exit(1);
    }

    const mapping = tenant.mappings[index];
    const enabled = options.enable ? true : options.disable ? false : !mapping.enabled;

    tenantManager.toggleMapping(tenantId, mapping.id, enabled);

    console.log(chalk.green(`✓ Mapping ${enabled ? 'enabled' : 'disabled'}: ${mapping.source}`));
  });
