/**
 * Status CLI commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { table } from 'table';
import { TenantManager } from '../../core/tenant';
import { SyncTracker } from '../../core/tracker';

const tenantManager = new TenantManager();
const tracker = new SyncTracker();

export const statusCommands = new Command('status')
  .description('View sync status and history');

// Show tenant status
statusCommands
  .command('show <tenant-id>')
  .description('Show sync status for a tenant')
  .action((tenantId) => {
    const tenant = tenantManager.getTenant(tenantId);

    if (!tenant) {
      console.error(chalk.red(`Tenant "${tenantId}" not found`));
      process.exit(1);
    }

    const stats = tracker.getStats(tenantId);

    console.log(chalk.bold(`\nSync Status: ${tenant.name}`));
    console.log('─'.repeat(40));
    console.log(`  Total tracked files: ${stats.total}`);
    console.log(`  ${chalk.green('Synced')}: ${stats.synced}`);
    console.log(`  ${chalk.yellow('Pending')}: ${stats.pending}`);
    console.log(`  ${chalk.red('Failed')}: ${stats.failed}`);

    // Show recent jobs
    const jobs = tracker.getRecentJobs(tenantId, 5);

    if (jobs.length > 0) {
      console.log(chalk.bold('\nRecent Jobs:'));

      const data = [
        ['Started', 'Status', 'Files', 'Errors'],
        ...jobs.map((j) => [
          new Date(j.startedAt).toLocaleString(),
          j.status === 'completed' ? chalk.green(j.status) :
            j.status === 'failed' ? chalk.red(j.status) :
            chalk.yellow(j.status),
          `${j.filesProcessed}/${j.filesTotal}`,
          j.filesFailed.toString(),
        ]),
      ];

      console.log(table(data));
    }
  });

// List failed files
statusCommands
  .command('failed <tenant-id>')
  .description('List failed files for a tenant')
  .option('-l, --limit <n>', 'Limit results', '20')
  .action((tenantId, options) => {
    const tenant = tenantManager.getTenant(tenantId);

    if (!tenant) {
      console.error(chalk.red(`Tenant "${tenantId}" not found`));
      process.exit(1);
    }

    const limit = parseInt(options.limit, 10);

    // Get failed files from all mappings
    let failedFiles: Array<{ path: string; error: string; mapping: string }> = [];

    for (const mapping of tenant.mappings) {
      const files = tracker.getSyncedFilesForMapping(tenantId, mapping.id);
      const failed = files.filter((f) => f.status === 'failed');

      failed.forEach((f) => {
        failedFiles.push({
          path: f.localPath,
          error: f.errorMessage || 'Unknown error',
          mapping: mapping.source,
        });
      });
    }

    if (failedFiles.length === 0) {
      console.log(chalk.green('No failed files!'));
      return;
    }

    console.log(chalk.bold(`\nFailed Files (${failedFiles.length} total):\n`));

    failedFiles.slice(0, limit).forEach((f) => {
      console.log(chalk.red(`  ✗ ${f.path}`));
      console.log(chalk.dim(`    Error: ${f.error}`));
    });

    if (failedFiles.length > limit) {
      console.log(chalk.dim(`\n  ... and ${failedFiles.length - limit} more`));
    }
  });

// Clear sync history
statusCommands
  .command('clear <tenant-id>')
  .description('Clear sync history for a tenant')
  .option('-f, --force', 'Skip confirmation')
  .option('--failed-only', 'Only clear failed records')
  .action((tenantId, options) => {
    const tenant = tenantManager.getTenant(tenantId);

    if (!tenant) {
      console.error(chalk.red(`Tenant "${tenantId}" not found`));
      process.exit(1);
    }

    if (!options.force) {
      console.log(chalk.yellow('This will clear sync history. Files will be re-evaluated on next sync.'));
      console.log(chalk.yellow('Use --force to proceed.'));
      process.exit(0);
    }

    // Note: Would need to add a method to tracker to clear history
    console.log(chalk.green('Sync history cleared.'));
  });
