// EXP-JSON: which tables the backup holds. Every table of the schema is listed exactly once,
// here, in `legacyTables` or in `notBackedUp` with the reason; the owner-export probe refuses
// a table that is in none, so a new table has to be placed on purpose.

/** The owner's own records, each keyed by "ownerId", in restore order. */
export const backupTables = [
  'owner_settings',
  'accounting_instruments',
  'manual_usd_price_versions',
  'manual_accounts',
  'account_opening_snapshots',
  'account_opening_positions',
  'account_trade_journals',
  'account_carry_in_lots',
  'account_csv_imports',
  'account_csv_import_commands',
  'account_trades',
  'account_trade_versions',
  'account_trade_version_payments',
  'account_trade_version_comments',
  'account_trade_version_settlements',
  'account_trade_version_purposes',
  'account_csv_import_rows',
  'owner_transfer_journals',
  'owned_transfers',
  'owned_transfer_versions',
  'account_swaps',
  'account_swap_versions',
  'account_rewards',
  'account_reward_versions',
  'portfolio_flow_journals',
  'portfolio_flow_versions',
  'wallet_addresses',
  'wallet_address_transactions',
  'wallet_xpub_addresses',
  'wallet_stake_accounts',
  'wallet_stake_moves',
  'wallet_stake_rewards',
  'wallet_ether_stake_positions',
  'wallet_ether_stake_moves',
  'wallet_ether_stake_rewards',
  'chain_transaction_classifications',
  'chain_transaction_classification_versions',
] as const;

/**
 * Rows of the screens retired in M20, keyed by "userId", in restore order. Their tables stay in
 * the database untouched; the backup carries them so they leave with the owner's data. The
 * legacy currency list is shared, so only the currencies those rows name are included.
 */
export const legacyTables = [
  'currencies',
  'capitals',
  'assets',
  'liabilities',
  'crypto_wallets',
  'reports',
  'subscriptions',
  'user_currency_preferences',
] as const;

export const notBackedUp: Record<string, string> = {
  // Secrets and sign-in state never leave the server.
  users: 'password hash',
  owner_auth: 'password hash',
  owner_mfa: 'TOTP secret',
  owner_mfa_recovery: 'recovery codes',
  bybit_accounts: 'Bybit API key (encrypted) and sync progress',
  auth_sessions: 'sessions',
  auth_request_limits: 'sign-in rate limits',
  password_reset_tokens: 'password reset links',
  invitation_codes: 'legacy sign-up codes',
  // Market data shared by every owner, collected again from its providers.
  price_observations: 'market prices',
  fx_rates: 'Bank of Russia rates',
  display_fx_collection: 'legacy display rates',
  display_fx_observations: 'legacy display rates',
  // Rebuilt from the records above.
  portfolio_snapshots: 'rebuilt from operations',
  portfolio_snapshot_state: 'rebuilt from operations',
  sync_sources: 'sync status',
  wallet_stake_scans: 'sync progress',
  migrations: 'schema history',
};
