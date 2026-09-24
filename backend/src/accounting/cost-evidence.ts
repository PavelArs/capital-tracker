import { formatAtoms } from './money';

/** A missing acquisition basis is evidence, never a numeric zero. */
export class CostTally {
  known = 0n;
  unknownCount = 0;

  add(value: bigint | null): void {
    if (value === null) this.unknownCount++;
    else this.known += value;
  }

  get incomplete(): boolean {
    return this.unknownCount > 0;
  }

  get value(): string | null {
    return this.incomplete ? null : formatAtoms(this.known);
  }

  get coverage(): { knownSubtotalUsd: string; unknownCount: number } {
    return { knownSubtotalUsd: formatAtoms(this.known), unknownCount: this.unknownCount };
  }
}
