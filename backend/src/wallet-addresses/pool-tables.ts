// POOL-DEPOSIT: every leg the owner answered as a liquidity pool deposit that no withdrawal
// returns yet, with what went into the pool in the leg's base units. The network fee is not
// part of it: it left the wallet. A hidden withdrawal returns nothing (CLS-HIDE).

export const openPoolDeposits = `(SELECT t."ownerId", t."addressId", t.txid, t.asset,
    t."sentUnits" - t."receivedUnits" - CASE WHEN t.asset IS NULL THEN t."feeUnits" ELSE 0 END
      AS units
  FROM wallet_address_transactions t
  JOIN chain_transaction_classifications h ON h."addressId"=t."addressId" AND h.txid=t.txid
  JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId"
    AND v.txid=h.txid AND v.version=h."currentVersion"
  WHERE v.status='classified' AND v.type='pool-deposit' AND NOT EXISTS (
    SELECT 1 FROM chain_transaction_classifications g
      JOIN chain_transaction_classification_versions u ON u."addressId"=g."addressId"
        AND u.txid=g.txid AND u.version=g."currentVersion"
      WHERE u."pairedAddressId"=t."addressId" AND u."pairedTxid"=t.txid
        AND u.status='classified' AND u.type='pool-withdrawal'))`;
