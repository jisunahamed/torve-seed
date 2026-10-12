import type { Command } from 'commander';
import chalk from 'chalk';

// The payments portal this command used to launch is retired: deposits are
// now fully in-terminal (`torve deposit` + automatic gasless sweeping), so
// `torve payments` just points at the commands that replaced it.
function printPaymentCommands(): void {
  console.log('');
  console.log(chalk.bold('The payments portal has been retired. Use these commands instead:'));
  console.log('');
  console.log(`  ${chalk.bold('torve buyer deposit')}           Show your funding address + checkout link`);
  console.log(`  ${chalk.bold('torve buyer activity')}          Tokens, spending history, savings, and active channels`);
  console.log(`  ${chalk.bold('torve buyer balance')}           Hot-wallet USDC and deposits balances`);
  console.log(`  ${chalk.bold('torve buyer sweep')}             Manually sweep hot-wallet USDC into deposits (gasless)`);
  console.log(`  ${chalk.bold('torve buyer withdraw')} <usdc>   Withdraw deposits back to the hot wallet`);
  console.log(`  ${chalk.bold('torve buyer channels')}          Inspect and close payment channels`);
  console.log(`  ${chalk.bold('torve buyer status')}            Connection and balance status`);
  console.log('');
  console.log(chalk.dim('While `torve buyer start` is running, incoming hot-wallet USDC is swept'));
  console.log(chalk.dim('into your deposits balance automatically (disable with buyer.autoSweep=false).'));
  console.log('');
}

export function registerPaymentsCommand(program: Command): void {
  const payments = program
    .command('payments')
    .description('Payment commands overview (the payments portal is retired)')
    .action(() => {
      printPaymentCommands();
    });

  // Retired subcommands kept as aliases so old scripts land on the guidance
  // instead of a commander "unknown command" error.
  payments
    .command('portal', { hidden: true })
    .action(() => {
      printPaymentCommands();
    });

  payments
    .command('summary', { hidden: true })
    .action(() => {
      printPaymentCommands();
    });
}
