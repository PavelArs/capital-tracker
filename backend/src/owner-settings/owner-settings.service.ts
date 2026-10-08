import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { parseDecimal, parseUuid } from '../accounting/input';
import { canonicalDecimalToAtoms, formatAtoms } from '../accounting/money';
import { type AccountingCurrency, isAccountingCurrency } from '../fx-rates/fx-conversion';

export interface OwnerSettings {
  mainCurrency: AccountingCurrency;
  /** CLS-DUST: incoming chain transactions worth less (USD) skip classification; null: off. */
  dustThresholdUsd: string | null;
}

const bad = (): never => {
  throw new BadRequestException('Invalid settings input');
};

/** The owner's main currency; no saved row means USD. */
export async function readMainCurrency(
  manager: EntityManager,
  owner: string,
): Promise<AccountingCurrency> {
  const [row]: { mainCurrency: AccountingCurrency }[] = await manager.query(
    'SELECT "mainCurrency" FROM owner_settings WHERE "ownerId" = $1',
    [owner],
  );
  return row?.mainCurrency ?? 'USD';
}

/** CLS-DUST: the owner's dust threshold in USD; no saved row or none set means off. */
export async function readDustThreshold(
  manager: EntityManager,
  owner: string,
): Promise<string | null> {
  const [row]: { dustThresholdUsd: string | null }[] = await manager.query(
    'SELECT "dustThresholdUsd"::text AS "dustThresholdUsd" FROM owner_settings WHERE "ownerId" = $1',
    [owner],
  );
  const stored = row?.dustThresholdUsd ?? null;
  return stored === null ? null : formatAtoms(canonicalDecimalToAtoms(stored));
}

const MAX_DUST_THRESHOLD = canonicalDecimalToAtoms('1000000');

/** A positive USD amount of at most 8 places, up to one million. */
function parseThreshold(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || /\.[0-9]{9,}$/.test(value)) return bad();
  const amount = parseDecimal(value, true);
  return canonicalDecimalToAtoms(amount) > MAX_DUST_THRESHOLD ? bad() : amount;
}

/** Either setting or both; one left out keeps its saved value. */
export function parseSettings(input: unknown): Partial<OwnerSettings> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad();
  const keys = Object.keys(input);
  const { mainCurrency, dustThresholdUsd } = input as Record<string, unknown>;
  if (keys.length === 0 || keys.some((key) => key !== 'mainCurrency' && key !== 'dustThresholdUsd'))
    return bad();
  const settings: Partial<OwnerSettings> = {};
  if ('mainCurrency' in input) {
    if (!isAccountingCurrency(mainCurrency)) return bad();
    settings.mainCurrency = mainCurrency;
  }
  if ('dustThresholdUsd' in input) settings.dustThresholdUsd = parseThreshold(dustThresholdUsd);
  return settings;
}

@Injectable()
export class OwnerSettingsService {
  constructor(private readonly source: DataSource) {}

  async read(ownerId: string): Promise<OwnerSettings> {
    const owner = parseUuid(ownerId);
    return this.readAll(this.source.manager, owner);
  }

  async update(ownerId: string, input: unknown): Promise<OwnerSettings> {
    const owner = parseUuid(ownerId);
    const settings = parseSettings(input);
    return this.source.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO owner_settings ("ownerId") VALUES ($1) ON CONFLICT ("ownerId") DO NOTHING`,
        [owner],
      );
      if (settings.mainCurrency !== undefined)
        await manager.query(
          `UPDATE owner_settings SET "mainCurrency" = $2, "updatedAt" = clock_timestamp()
            WHERE "ownerId" = $1`,
          [owner, settings.mainCurrency],
        );
      if (settings.dustThresholdUsd !== undefined)
        await manager.query(
          `UPDATE owner_settings SET "dustThresholdUsd" = $2, "updatedAt" = clock_timestamp()
            WHERE "ownerId" = $1`,
          [owner, settings.dustThresholdUsd],
        );
      return this.readAll(manager, owner);
    });
  }

  private async readAll(manager: EntityManager, owner: string): Promise<OwnerSettings> {
    return {
      mainCurrency: await readMainCurrency(manager, owner),
      dustThresholdUsd: await readDustThreshold(manager, owner),
    };
  }
}
