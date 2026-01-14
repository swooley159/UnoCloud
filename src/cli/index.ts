#!/usr/bin/env node
/**
 * UnoCloud CLI
 * On-premise to SharePoint file migration tool
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { tenantCommands } from './commands/tenant';
import { mappingCommands } from './commands/mapping';
import { syncCommands } from './commands/sync';
import { statusCommands } from './commands/status';

const program = new Command();

program
  .name('unocloud')
  .description('On-premise to SharePoint file migration tool for Azure tenants')
  .version('1.0.0');

// Register command groups
program.addCommand(tenantCommands);
program.addCommand(mappingCommands);
program.addCommand(syncCommands);
program.addCommand(statusCommands);

// Global error handling
program.exitOverride((err) => {
  if (err.code === 'commander.help') {
    process.exit(0);
  }
  console.error(chalk.red(`Error: ${err.message}`));
  process.exit(1);
});

// Parse arguments
program.parse(process.argv);

// Show help if no command specified
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
