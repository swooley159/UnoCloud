/**
 * License management CLI commands (Admin)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { table } from 'table';
import { LicenseManager, LicenseTier } from '../../core/license';

const licenseManager = new LicenseManager();

export const licenseCommands = new Command('license')
  .description('Manage client license keys (admin)');

// Generate a new license
licenseCommands
  .command('create')
  .description('Create a new license key for a client')
  .requiredOption('-n, --name <name>', 'Client name')
  .requiredOption('-e, --email <email>', 'Client email')
  .requiredOption('-t, --tier <tier>', 'License tier: starter, professional, enterprise')
  .option('-x, --expires <days>', 'Expiration in days (default: no expiration)')
  .action((options) => {
    const validTiers = ['starter', 'professional', 'enterprise'];
    if (!validTiers.includes(options.tier)) {
      console.error(chalk.red(`Invalid tier. Must be one of: ${validTiers.join(', ')}`));
      process.exit(1);
    }

    const expiresInDays = options.expires ? parseInt(options.expires, 10) : undefined;

    const license = licenseManager.createLicense(
      options.name,
      options.email,
      options.tier as LicenseTier,
      expiresInDays
    );

    console.log(chalk.green('\n✓ License created successfully!\n'));
    console.log(chalk.bold('License Key:'));
    console.log(chalk.cyan(`  ${license.key}\n`));
    console.log('Details:');
    console.log(`  Client:      ${license.clientName}`);
    console.log(`  Email:       ${license.clientEmail}`);
    console.log(`  Tier:        ${options.tier}`);
    console.log(`  Mappings:    ${license.maxMappings === -1 ? 'Unlimited' : license.maxMappings}`);
    console.log(`  Max File:    ${license.features.maxFileSize} GB`);
    console.log(`  Expires:     ${license.expiresAt ? new Date(license.expiresAt).toLocaleDateString() : 'Never'}`);

    console.log(chalk.dim('\nSend this key to the client for enrollment.'));
  });

// List all licenses
licenseCommands
  .command('list')
  .alias('ls')
  .description('List all license keys')
  .option('-a, --all', 'Show all details')
  .action((options) => {
    const licenses = licenseManager.getAllLicenses();

    if (licenses.length === 0) {
      console.log(chalk.yellow('No licenses created yet.'));
      return;
    }

    const data = [
      ['Key', 'Client', 'Tier', 'Status', 'Expires'],
      ...licenses.map((l) => {
        const tier = l.maxMappings === -1 ? 'Enterprise' : l.maxMappings === 10 ? 'Professional' : 'Starter';
        const status = l.activated
          ? chalk.green('Activated')
          : chalk.yellow('Pending');
        const expires = l.expiresAt
          ? new Date(l.expiresAt).toLocaleDateString()
          : chalk.dim('Never');

        return [
          options.all ? l.key : l.key.substring(0, 20) + '...',
          l.clientName,
          tier,
          status,
          expires,
        ];
      }),
    ];

    console.log(table(data));
  });

// Show license details
licenseCommands
  .command('show <key>')
  .description('Show license details')
  .action((key) => {
    const license = licenseManager.getLicense(key);

    if (!license) {
      console.error(chalk.red('License not found'));
      process.exit(1);
    }

    const tier = license.maxMappings === -1 ? 'Enterprise' : license.maxMappings === 10 ? 'Professional' : 'Starter';

    console.log(chalk.bold('\nLicense Details:'));
    console.log(`  Key:         ${license.key}`);
    console.log(`  Client:      ${license.clientName}`);
    console.log(`  Email:       ${license.clientEmail}`);
    console.log(`  Tier:        ${tier}`);
    console.log(`  Created:     ${new Date(license.createdAt).toLocaleString()}`);
    console.log(`  Expires:     ${license.expiresAt ? new Date(license.expiresAt).toLocaleString() : 'Never'}`);

    console.log(chalk.bold('\nActivation:'));
    if (license.activated) {
      console.log(chalk.green(`  Status:      Activated`));
      console.log(`  Activated:   ${new Date(license.activatedAt!).toLocaleString()}`);
      console.log(`  Tenant ID:   ${license.tenantId}`);
    } else {
      console.log(chalk.yellow(`  Status:      Pending activation`));
    }

    console.log(chalk.bold('\nLimits:'));
    console.log(`  Max Mappings: ${license.maxMappings === -1 ? 'Unlimited' : license.maxMappings}`);
    console.log(`  Max File Size: ${license.features.maxFileSize} GB`);

    console.log(chalk.bold('\nFeatures:'));
    console.log(`  ${license.features.scheduling ? chalk.green('✓') : chalk.red('✗')} Scheduled Sync`);
    console.log(`  ${license.features.bidirectionalSync ? chalk.green('✓') : chalk.red('✗')} Bidirectional Sync`);
    console.log(`  ${license.features.emailNotifications ? chalk.green('✓') : chalk.red('✗')} Email Notifications`);
    console.log(`  ${license.features.prioritySupport ? chalk.green('✓') : chalk.red('✗')} Priority Support`);
  });

// Revoke a license
licenseCommands
  .command('revoke <key>')
  .description('Revoke a license key')
  .option('-f, --force', 'Skip confirmation')
  .action((key, options) => {
    const license = licenseManager.getLicense(key);

    if (!license) {
      console.error(chalk.red('License not found'));
      process.exit(1);
    }

    if (!options.force) {
      console.log(chalk.yellow(`Warning: This will revoke the license for ${license.clientName}.`));
      if (license.activated) {
        console.log(chalk.yellow(`The tenant (${license.tenantId}) will lose access.`));
      }
      console.log(chalk.yellow('Use --force to proceed.'));
      process.exit(0);
    }

    licenseManager.revokeLicense(key);
    console.log(chalk.green(`✓ License revoked: ${license.clientName}`));
  });

// Validate a license key
licenseCommands
  .command('validate <key>')
  .description('Validate a license key')
  .action((key) => {
    const result = licenseManager.validateSignedKey(key);

    if (result.valid) {
      console.log(chalk.green('✓ License key is valid'));
      console.log(`  Tier: ${result.tier}`);
      if (result.expiresAt) {
        console.log(`  Expires: ${result.expiresAt.toLocaleDateString()}`);
      }
    } else {
      console.log(chalk.red(`✗ Invalid license: ${result.error}`));
      process.exit(1);
    }
  });

// Generate enrollment instructions
licenseCommands
  .command('instructions <key>')
  .description('Generate enrollment instructions for a client')
  .action((key) => {
    const license = licenseManager.getLicense(key);

    if (!license) {
      console.error(chalk.red('License not found'));
      process.exit(1);
    }

    // Import and use EnrollmentService
    const { TenantManager } = require('../../core/tenant');
    const { EnrollmentService } = require('../../core/enrollment');

    const tenantManager = new TenantManager();
    const enrollmentService = new EnrollmentService(tenantManager, licenseManager);

    console.log(enrollmentService.generateEnrollmentInstructions(license));
  });
