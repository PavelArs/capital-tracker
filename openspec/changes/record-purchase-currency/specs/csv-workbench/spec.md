## MODIFIED Requirements

### Requirement: CSVUX-001 Observable import stages and field guidance
The CSV workbench SHALL expose an ordered file, mapping and review guide with its
current step derived from existing state. A valid inspection SHALL select mapping;
a preview or accepted batch SHALL select review; otherwise file SHALL be current.
The guide SHALL NOT perform actions or imply automatic confirmation. Mapping SHALL
group columns, exact source values and numeric/time interpretation, with associated
Russian descriptions for total amounts, explicit fee zero, optional currency column,
payment currency and rate (PCUR-3), decimal/time offset and same-time order. Existing labels/options/validation SHALL remain for the default USD choice.

#### Scenario: CSVUX-001-A Follow an explicitly reviewed import
- **GIVEN** a real owner with an initialized account
- **WHEN** the owner selects/uploads, inspects/maps and previews the sale-first file
- **THEN** the guide changes from file to mapping to review and the field descriptions explain exact interpretation
- **AND** preview creates no trades and explicit confirmation retains exact250/100/0.5 results
