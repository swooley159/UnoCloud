/**
 * Sync CLI commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { TenantManager } from '../../core/tenant';
import { SyncTracker } from '../../core/tracker';
import { SyncEngine, SyncProgress } from '../../core/sync';
import { logger, enableConsoleLogging } from '../../utils/logger';

const tenantManager = new TenantManager();
const tracker = new SyncTracker();
const syncEngine = new SyncEngine(tenantManager, tracker);

export const syncCommands = new Command('sync')
  .description('Synchronize files to SharePoint');

// Sync a tenant
syncCommands
  .command('run <tenant-id>')
  .description('Run sync for a tenant')
  .option('-m, --mapping <index>', 'Sync only a specific mapping (by index)')
  .option('-d, --dry-run', 'Scan files without uploading')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (tenantId, options) => {
    const tenant = tenantManager.getTenant(tenantId);

    if (!tenant) {
      console.error(chalk.red(`Tenant "${tenantId}" not found`));
      process.exit(1);
    }

    if (options.verbose) {
      enableConsoleLogging(true);
    }

    if (tenant.mappings.length === 0) {
      console.error(chalk.yellow('No mappings configured for this tenant.'));
      process.exit(1);
    }

    // Get specific mapping if requested
    let mappings = tenant.mappings.filter((m) => m.enabled);

    if (options.mapping) {
      const index = parseInt(options.mapping, 10) - 1;
      if (isNaN(index) || index < 0 || index >= tenant.mappings.length) {
        console.error(chalk.red(`Invalid mapping index: ${options.mapping}`));
        process.exit(1);
      }
      mappings = [tenant.mappings[index]];
    }

    if (mappings.length === 0) {
      console.error(chalk.yellow('No enabled mappings to sync.'));
      process.exit(1);
    }

    console.log(chalk.bold(`\nSyncing ${tenant.name}...`));
    console.log(`Mappings: ${mappings.length}`);

    // Dry run mode
    if (options.dryRun) {
      console.log(chalk.cyan('\n[DRY RUN MODE - No files will be uploaded]\n'));

      for (const mapping of mappings) {
        const spinner = ora(`Scanning: ${mapping.source}`).start();

        try {
          const result = await syncEngine.dryRun(tenant, mapping);

          spinner.succeed(`Scanned: ${mapping.source}`);
          console.log(`  Files to sync: ${result.toSync.length}`);
          console.log(`  Already synced: ${result.upToDate}`);
          console.log(`  Total size: ${formatBytes(result.totalSize)}`);

          if (result.toSync.length > 0 && options.verbose) {
            console.log(chalk.dim('  Files:'));
            result.toSync.slice(0, 10).forEach((f) => {
              console.log(chalk.dim(`    - ${f.relativePath} (${formatBytes(f.size)})`));
            });
            if (result.toSync.length > 10) {
              console.log(chalk.dim(`    ... and ${result.toSync.length - 10} more`));
            }
          }
        } catch (error: any) {
          spinner.fail(`Failed to scan: ${error.message}`);
        }
      }

      return;
    }

    // Actual sync
    let spinner: ora.Ora | null = null;

    const onProgress = (progress: SyncProgress) => {
      if (progress.phase === 'scanning') {
        if (!spinner || spinner.text.startsWith('Uploading')) {
          spinner?.succeed();
          spinner = ora(`Scanning: ${progress.currentFile || '...'}`).start();
        } else {
          spinner.text = `Scanning: ${progress.currentFile || '...'}`;
        }
      } else if (progress.phase === 'uploading') {
        if (!spinner || spinner.text.startsWith('Scanning')) {
          spinner?.succeed();
          spinner = ora(`Uploading: ${progress.currentFile || '...'}`).start();
        } else {
          const pct = progress.job.filesTotal > 0
            ? Math.round((progress.job.filesProcessed / progress.job.filesTotal) * 100)
            : 0;
          spinner.text = `Uploading [${pct}%]: ${progress.currentFile || '...'}`;
        }
      } else if (progress.phase === 'complete') {
        spinner?.succeed('Sync complete');
      } else if (progress.phase === 'error') {
        spinner?.fail('Sync failed');
      }
    };

    try {
      const jobs = await syncEngine.syncTenant(tenant, onProgress);

      console.log(chalk.bold('\nSync Summary:'));

      for (const job of jobs) {
        const status = job.status === 'completed'
          ? chalk.green('✓')
          : job.status === 'failed'
          ? chalk.red('✗')
          : chalk.yellow('~');

        console.log(`  ${status} ${job.filesProcessed}/${job.filesTotal} files`);
        console.log(`    Transferred: ${formatBytes(job.bytesTransferred)}`);

        if (job.filesFailed > 0) {
          console.log(chalk.red(`    Failed: ${job.filesFailed} files`));
        }

        if (job.errors.length > 0 && options.verbose) {
          console.log(chalk.red('    Errors:'));
          job.errors.forEach((e) => {
            console.log(chalk.red(`      - ${e.filePath}: ${e.error}`));
          });
        }
      }
    } catch (error: any) {
      spinner?.fail(`Sync error: ${error.message}`);
      logger.error('Sync failed', error);
      process.exit(1);
    }
  });

// Sync all tenants
syncCommands
  .command('all')
  .description('Run sync for all configured tenants')
  .option('-d, --dry-run', 'Scan files without uploading')
  .action(async (options) => {
    const tenants = tenantManager.getAllTenants();

    if (tenants.length === 0) {
      console.error(chalk.yellow('No tenants configured.'));
      process.exit(1);
    }

    console.log(chalk.bold(`Syncing ${tenants.length} tenant(s)...\n`));

    for (const tenant of tenants) {
      if (tenant.mappings.filter((m) => m.enabled).length === 0) {
        console.log(chalk.yellow(`Skipping ${tenant.name} - no enabled mappings`));
        continue;
      }

      console.log(chalk.bold(`\n${tenant.name}:`));

      if (options.dryRun) {
        for (const mapping of tenant.mappings.filter((m) => m.enabled)) {
          const result = await syncEngine.dryRun(tenant, mapping);
          console.log(`  ${mapping.source}: ${result.toSync.length} files to sync`);
        }
      } else {
        const jobs = await syncEngine.syncTenant(tenant);
        const total = jobs.reduce((sum, j) => sum + j.filesProcessed, 0);
        const failed = jobs.reduce((sum, j) => sum + j.filesFailed, 0);

        console.log(`  Synced: ${total} files` + (failed > 0 ? chalk.red(` (${failed} failed)`) : ''));
      }
    }
  });

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}
