'use strict';

// Native schema21 fixtures: current services cannot run until schema22 exists.
// Freeze original command bytes/receipts independently of current serializers.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DataSource } = require('typeorm');

async function seedRewardPredecessor(client, connection) {
  const rows = [];
  const coverageFrom = '2025-01-01T00:00:00.000Z';
  await client.query('BEGIN');
  try {
    await client.query(`INSERT INTO display_fx_observations
      (provider,base,"observedAt","fetchedAt","nextUpdateAt","eurRate","rubRate")
      VALUES('exchangerate-api-open','USD','2025-01-02','2025-01-02','2025-01-03',
        0.912345678901234567890123456789,91.2345678901234567890123456789)`);
    await client.query(`INSERT INTO display_fx_collection
      (provider,"reservedAttempts","lastAttemptAt","lastSuccessAt","nextAttemptAt","lastOutcome")
      VALUES('exchangerate-api-open',ARRAY['2025-01-02'::timestamptz],
        '2025-01-02','2025-01-02','2025-01-03','ok')`);
    for (const { id: owner } of (await client.query('SELECT id FROM users ORDER BY email')).rows) {
      const from = randomUUID();
      const to = randomUUID();
      const instrumentId = randomUUID();
      for (const [id, name, revision] of [
        [from, 'Retained reward source', 2],
        [to, 'Retained reward recipient', 1],
      ]) {
        await client.query(
          `INSERT INTO manual_accounts(id,"ownerId",name,"requestId","canonicalPayload")
          VALUES($1,$2,$3,$4,$5)`,
          [id, owner, name, randomUUID(), JSON.stringify({ name })],
        );
        await client.query(
          `INSERT INTO account_trade_journals
          ("ownerId","accountId","requestId","canonicalPayload","originKind","coverageFrom","currentRevision")
          VALUES($1,$2,$3,$4,'declared-empty',$5,$6)`,
          [
            owner,
            id,
            randomUUID(),
            JSON.stringify({ coverageFrom, assertEmpty: true }),
            coverageFrom,
            revision,
          ],
        );
      }
      await client.query(
        `INSERT INTO accounting_instruments(id,"ownerId",name,symbol,"requestId","canonicalPayload")
        VALUES($1,$2,'Retained reward asset','SAME',$3,$4)`,
        [
          instrumentId,
          owner,
          randomUUID(),
          JSON.stringify({ name: 'Retained reward asset', symbol: 'SAME' }),
        ],
      );

      const rewardId = randomUUID();
      const rewardFields = {
        instrumentId,
        category: 'staking',
        occurredAt: '2025-01-02T00:00:00.000Z',
        orderWithinTimestamp: 0,
        quantity: '2',
        acquisitionBasisUsd: '100',
        incomeValueUsd: null,
      };
      const rewardInput = {
        requestId: randomUUID(),
        expectedJournalRevision: 0,
        assertReward: true,
        ...rewardFields,
      };
      const rewardPayload = JSON.stringify({
        kind: 'create',
        expectedJournalRevision: 0,
        assertReward: true,
        ...rewardFields,
      });
      await client.query(
        `INSERT INTO account_rewards(id,"ownerId","accountId","currentVersion") VALUES($1,$2,$3,1)`,
        [rewardId, owner, from],
      );
      const {
        rows: [reward],
      } = await client.query(
        `INSERT INTO account_reward_versions
        ("ownerId","accountId","rewardId",version,"journalRevision","requestId","canonicalPayload",kind,
         "instrumentId",category,"occurredAt","orderWithinTimestamp",quantity,"acquisitionBasisUsd","incomeValueUsd")
        VALUES($1,$2,$3,1,1,$4,$5,'create',$6,'staking',$7,0,2,100,NULL) RETURNING "createdAt"`,
        [
          owner,
          from,
          rewardId,
          rewardInput.requestId,
          rewardPayload,
          instrumentId,
          rewardFields.occurredAt,
        ],
      );
      const rewardReceipt = {
        accountId: from,
        journalRevision: 1,
        reward: {
          accountId: from,
          rewardId,
          version: 1,
          journalRevision: 1,
          requestId: rewardInput.requestId,
          kind: 'create',
          createdAt: reward.createdAt.toISOString(),
          ...rewardFields,
          instrumentName: 'Retained reward asset',
          instrumentSymbol: 'SAME',
        },
      };

      const transferId = randomUUID();
      const transferFields = {
        instrumentId,
        occurredAt: '2025-01-03T00:00:00.000Z',
        orderWithinTimestamp: 0,
        quantity: '1',
        feeInstrumentId: null,
        feeQuantity: '0',
      };
      const transferPins = {
        fromAccountId: from,
        toAccountId: to,
        expectedFromJournalRevision: 1,
        expectedToJournalRevision: 0,
      };
      const transferInput = {
        requestId: randomUUID(),
        ...transferPins,
        assertInternal: true,
        ...transferFields,
      };
      const transferPayload = JSON.stringify({
        kind: 'create',
        ...transferPins,
        assertInternal: true,
        ...transferFields,
      });
      await client.query(
        `INSERT INTO owner_transfer_journals("ownerId","currentRevision") VALUES($1,1)`,
        [owner],
      );
      await client.query(
        `INSERT INTO owned_transfers(id,"ownerId","fromAccountId","toAccountId","currentVersion")
        VALUES($1,$2,$3,$4,1)`,
        [transferId, owner, from, to],
      );
      const {
        rows: [transfer],
      } = await client.query(
        `INSERT INTO owned_transfer_versions
        ("ownerId","transferId",version,"journalRevision","fromJournalRevision","toJournalRevision",
         "requestId","canonicalPayload",kind,"instrumentId","occurredAt","orderWithinTimestamp",quantity,"feeInstrumentId","feeQuantity")
        VALUES($1,$2,1,1,2,1,$3,$4,'create',$5,$6,0,1,NULL,0) RETURNING "createdAt"`,
        [
          owner,
          transferId,
          transferInput.requestId,
          transferPayload,
          instrumentId,
          transferFields.occurredAt,
        ],
      );
      const transferReceipt = {
        journalRevision: 1,
        transfer: {
          transferId,
          version: 1,
          journalRevision: 1,
          requestId: transferInput.requestId,
          kind: 'create',
          createdAt: transfer.createdAt.toISOString(),
          fromAccountId: from,
          toAccountId: to,
          fromJournalRevision: 2,
          toJournalRevision: 1,
          ...transferFields,
          instrumentName: 'Retained reward asset',
          instrumentSymbol: 'SAME',
          feeInstrumentName: null,
          feeInstrumentSymbol: null,
        },
      };
      rows.push({
        owner,
        from,
        to,
        rewardId,
        rewardInput,
        rewardReceipt,
        transferInput,
        transferReceipt,
      });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return async () => {
    const source = new DataSource({
      type: 'postgres',
      host: connection.host,
      port: connection.port,
      username: connection.user,
      password: connection.password,
      database: connection.database,
      synchronize: false,
      migrationsRun: false,
    });
    await source.initialize();
    try {
      const {
        AssetRewardService,
      } = require('/app/backend/dist/accounting/asset-reward.service.js');
      const {
        OwnedTransferService,
      } = require('/app/backend/dist/accounting/owned-transfer.service.js');
      const { TradeService } = require('/app/backend/dist/accounting/trade.service.js');
      const reward = new AssetRewardService(source);
      const transfer = new OwnedTransferService(source);
      const trade = new TradeService(source);
      for (const row of rows) {
        assert.deepEqual(await reward.create(row.owner, row.from, row.rewardInput), {
          created: false,
          value: row.rewardReceipt,
        });
        assert.deepEqual(await transfer.create(row.owner, row.transferInput), {
          created: false,
          value: row.transferReceipt,
        });
        for (const account of [row.from, row.to]) {
          const { journal } = await trade.getJournal(row.owner, account);
          assert.equal(journal.summary.remainingCostUsd, '50');
          assert.equal(journal.versionCount, 0, 'Rewards and transfers never become USD trades');
          assert.equal(journal.swapSummary, undefined, 'Migration creates no swap history');
        }
        const lots = (await trade.listLots(row.owner, row.to, {})).items;
        assert.equal(lots.length, 1);
        assert.equal(lots[0].origin.kind, 'reward');
        assert.equal(lots[0].origin.rewardId, row.rewardId);
        assert.equal(lots[0].remainingQuantity, '1');
        assert.equal(lots[0].remainingCostUsd, '50');
      }
    } finally {
      await source.destroy();
    }
  };
}

module.exports = { seedRewardPredecessor };
