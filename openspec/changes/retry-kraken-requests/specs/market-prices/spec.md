## ADDED Requirements

### Requirement: PRC-7 Kraken pacing and one retry
The system SHALL send Kraken requests at least 2 seconds apart. A Kraken request that
fails as `rate_limited` or `unavailable` SHALL be sent once more after 5 seconds, and
only the second answer SHALL decide the outcome; an `invalid_response` SHALL NOT be
repeated.

#### Scenario: PRC-RETRY A transient Kraken failure does not lose the price
- **GIVEN** Kraken answers the first request for a pair with a failure and the repeated request with candles
- **WHEN** the hourly read or the daily backfill asks for that pair
- **THEN** the pair's price or history is returned from the repeated request, and a pair that fails twice is reported as before.
