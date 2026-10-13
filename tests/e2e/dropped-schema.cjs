'use strict';

// DropLegacySchema1797000000000 removes these on purpose. Probes that upgrade an older schema and
// compare the whole database before and after leave them out; everything else must be unchanged.
const droppedTables = [
  'reports',
  'capitals',
  'assets',
  'liabilities',
  'user_currency_preferences',
  'crypto_wallets',
  'subscriptions',
  'currencies',
  'invitation_codes',
  'display_fx_observations',
  'display_fx_collection',
];
const droppedColumns = {
  users: [
    'emailVerified',
    'emailVerificationToken',
    'resetPasswordToken',
    'resetPasswordExpires',
    'firstName',
    'lastName',
  ],
  wallet_stake_scans: ['scannedAt'],
};

/** A jsonb expression for one row of the table without the columns the migration drops. */
function survivingRow(table, expression = 'to_jsonb(t)') {
  return (droppedColumns[table] ?? []).reduce((row, column) => `${row} - '${column}'`, expression);
}

module.exports = { droppedTables, droppedColumns, survivingRow };
