// POOL-DEPOSIT, POOL-PARTIAL: every leg the owner answered as a liquidity pool deposit that no
// withdrawal closes yet, with what is still in the pool in the leg's base units: what went in,
// less what the withdrawals marked as a part of it returned. The network fee is not part of it:
// it left the wallet. A hidden withdrawal returns nothing (CLS-HIDE).

export const openPoolDeposits = `(SELECT o."ownerId", o."addressId", o.txid, o.asset, o.units
  FROM (SELECT t."ownerId", t."addressId", t.txid, t.asset,
      t."sentUnits" - t."receivedUnits" - CASE WHEN t.asset IS NULL THEN t."feeUnits" ELSE 0 END
        - coalesce(r.returned, 0) AS units,
      coalesce(r.closed, false) AS closed
    FROM wallet_address_transactions t
    JOIN chain_transaction_classifications h ON h."addressId"=t."addressId" AND h.txid=t.txid
    JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId"
      AND v.txid=h.txid AND v.version=h."currentVersion"
    CROSS JOIN LATERAL (
      SELECT sum(x."receivedUnits" - x."sentUnits"
          + CASE WHEN x.asset IS NULL THEN x."feeUnits" ELSE 0 END) AS returned,
        bool_or(NOT coalesce((u.details->>'partial')::boolean, false)) AS closed
      FROM chain_transaction_classifications g
        JOIN chain_transaction_classification_versions u ON u."addressId"=g."addressId"
          AND u.txid=g.txid AND u.version=g."currentVersion"
        JOIN wallet_address_transactions x ON x."addressId"=g."addressId" AND x.txid=g.txid
      WHERE u."pairedAddressId"=t."addressId" AND u."pairedTxid"=t.txid
        AND u.status='classified' AND u.type='pool-withdrawal') r
    WHERE v.status='classified' AND v.type='pool-deposit') o
  WHERE NOT o.closed AND o.units > 0)`;
