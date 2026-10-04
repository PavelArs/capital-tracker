import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { parseUuid } from '../accounting/input';
import { type AccountingCurrency, isAccountingCurrency } from '../fx-rates/fx-conversion';

export interface OwnerSettings {
  mainCurrency: AccountingCurrency;
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

function parseSettings(input: unknown): OwnerSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad();
  const keys = Object.keys(input);
  const { mainCurrency } = input as Record<string, unknown>;
  if (keys.length !== 1 || keys[0] !== 'mainCurrency' || !isAccountingCurrency(mainCurrency))
    return bad();
  return { mainCurrency };
}

@Injectable()
export class OwnerSettingsService {
  constructor(private readonly source: DataSource) {}

  async read(ownerId: string): Promise<OwnerSettings> {
    const owner = parseUuid(ownerId);
    return { mainCurrency: await readMainCurrency(this.source.manager, owner) };
  }

  async update(ownerId: string, input: unknown): Promise<OwnerSettings> {
    const owner = parseUuid(ownerId);
    const settings = parseSettings(input);
    await this.source.query(
      `INSERT INTO owner_settings ("ownerId", "mainCurrency") VALUES ($1, $2)
       ON CONFLICT ("ownerId") DO UPDATE SET "mainCurrency" = EXCLUDED."mainCurrency",
         "updatedAt" = clock_timestamp()`,
      [owner, settings.mainCurrency],
    );
    return settings;
  }
}
