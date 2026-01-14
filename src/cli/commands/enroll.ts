/**
 * Client enrollment CLI commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { TenantManager } from '../../core/tenant';
import { LicenseManager } from '../../core/license';
import { EnrollmentService } from '../../core/enrollment';

const tenantManager = new TenantManager();
const licenseManager = new LicenseManager();
const enrollmentService = new EnrollmentService(tenantManager, licenseManager);

export const enrollCommands = new Command('enroll')
  .description('Enroll as a new client with a license key')
  .requiredOption('-l, --license <key>', 'License key provided by your administrator')
  .requiredOption('-n, --name <name>', 'Your organization name')
  .requiredOption('-t, --tenant-id <id>', 'Azure AD Tenant ID (GUID)')
  .requiredOption('-c, --client-id <id>', 'Azure AD App Client ID (GUID)')
  .requiredOption('-s, --client-secret <secret>', 'Azure AD App Client Secret')
  .action(async (options) => {
    console.log(chalk.bold('\nUnoCloud Client Enrollment\n'));

    const spinner = ora('Validating license key...').start();

    try {
      const result = await enrollmentService.enroll({
        licenseKey: options.license,
        tenantName: options.name,
        azure: {
          tenantId: options.tenantId,
          clientId: options.clientId,
          clientSecret: options.clientSecret,
        },
      });

      if (!result.success) {
        spinner.fail(`Enrollment failed: ${result.error}`);
        process.exit(1);
      }

      spinner.succeed('Enrollment successful!');

      console.log(chalk.green('\n✓ Your organization is now registered!\n'));
      console.log('Details:');
      console.log(`  Tenant ID:    ${result.tenantId}`);
      console.log(`  License Tier: ${getTierName(result.license!)}`);
      console.log(`  Max Mappings: ${result.license!.maxMappings === -1 ? 'Unlimited' : result.license!.maxMappings}`);

      console.log(chalk.bold('\nNext Steps:'));
      console.log('  1. Add a source mapping:');
      console.log(chalk.cyan(`     unocloud mapping add ${result.tenantId} --source /path/to/files --site https://yoursite.sharepoint.com/sites/... --library "Documents"`));
      console.log('\n  2. Run a dry-run sync:');
      console.log(chalk.cyan(`     unocloud sync run ${result.tenantId} --dry-run`));
      console.log('\n  3. Start the actual sync:');
      console.log(chalk.cyan(`     unocloud sync run ${result.tenantId}`));

    } catch (error: any) {
      spinner.fail(`Enrollment error: ${error.message}`);
      process.exit(1);
    }
  });

// Quick enroll command with interactive prompts (future)
export const quickEnrollCommand = new Command('quick-enroll')
  .description('Interactive enrollment wizard')
  .action(async () => {
    console.log(chalk.yellow('Interactive enrollment coming soon!'));
    console.log('For now, use: unocloud enroll --help');
  });

function getTierName(license: any): string {
  if (license.maxMappings === -1) return 'Enterprise';
  if (license.maxMappings === 10) return 'Professional';
  return 'Starter';
}
