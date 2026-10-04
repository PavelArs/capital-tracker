## MODIFIED Requirements

### Requirement: ENTRY-001 Guided exact acquisition fields
Swap and reward entry SHALL group related fields and expose concise Russian descriptions
on the relevant controls. Swap guidance SHALL distinguish gross incoming quantity,
unknown versus known-zero USD valuation, held versus incoming-asset fee source, and
explicit time zone/order. Reward guidance SHALL distinguish independent basis/income,
unknown versus known-zero values, unclassified category and explicit time zone/order.
Existing labels, options, exact strings and conditional fields SHALL remain intact,
except that time controls are the calendar date and optional UTC time group defined by
DATE-1.

#### Scenario: ENTRY-001-A Read swap evidence guidance
- **GIVEN** an owner in the swap editor
- **WHEN** the owner reads quantity, valuation, fee-source and time controls
- **THEN** their accessible descriptions explain the corresponding distinctions and agree with the original review/receipt values
- **AND** changing known/unknown or fee source preserves the established explicit clearing/linking behavior

#### Scenario: ENTRY-001-B Read independent reward evidence
- **GIVEN** an owner in the reward editor
- **WHEN** the owner reads basis, income, category and time controls
- **THEN** accessible descriptions distinguish unknown from explicit zero, identify unclassified review and retain independent exact evidence
