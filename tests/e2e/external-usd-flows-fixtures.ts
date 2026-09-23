import { expect } from '@playwright/test';
import { test as authenticatedTest, query } from './mfa-fixtures';

// Unlike per-account journals, there is only one external-flow origin per owner.
// Each independent synthetic case needs its own empty ledger. Never clear it
// within a journey or touch the preceding financial/authentication tables.
export const test = authenticatedTest.extend<{ isolatedFlowJournal: undefined }>({
  isolatedFlowJournal: [
    async ({ mfa }, use) => {
      expect(mfa).toBeDefined();
      query(`DO $$ BEGIN
        IF current_database() <> 'capital_tracker_e2e' OR current_user <> 'capital_e2e' THEN
          RAISE EXCEPTION 'Refuse external-flow fixture outside synthetic acceptance';
        END IF;
        IF to_regclass('public.portfolio_flow_journals') IS NOT NULL THEN
          TRUNCATE portfolio_flow_versions, portfolio_flow_journals;
        END IF;
      END $$`);
      await use(undefined);
    },
    { auto: true },
  ],
});
