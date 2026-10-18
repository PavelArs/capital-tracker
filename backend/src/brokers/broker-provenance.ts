/** SQL origin of a journal version aliased as v, scoped to its owner and account. */
export const importedByBroker = (column: 'tradeId' | 'rewardId' | 'capitalReturnId') =>
  `EXISTS (SELECT 1 FROM broker_imported_operations b WHERE b."ownerId"=v."ownerId"
    AND b."accountId"=v."accountId" AND b."${column}"=v."${column}")`;
