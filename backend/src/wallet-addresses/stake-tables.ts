// SOL-STAKE-*, ETH-STAKE-*: every wallet's stake moves and rewards, whichever network they are
// on, as one table each. A move's txid names the transaction whose leg in the network's own coin
// it belongs to; `account` is the Solana stake account or the Ethereum pool contract.

export const stakeMoves = `(SELECT "ownerId", "addressId", signature AS txid, account, "blockTime",
    units FROM wallet_stake_moves
  UNION ALL SELECT "ownerId", "addressId", txid, contract, "blockTime", units
    FROM wallet_ether_stake_moves)`;

export const stakeRewards = `(SELECT "ownerId", "addressId", account, "observedAt", units
    FROM wallet_stake_rewards
  UNION ALL SELECT "ownerId", "addressId", contract, "observedAt", units
    FROM wallet_ether_stake_rewards)`;
