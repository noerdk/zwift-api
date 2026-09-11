# Contributing

This is a reverse-engineered, unofficial client. Contributions that map more of
Zwift's API are welcome — but with two firm rules.

## Read-only

This library never calls write endpoints. Zwift exposes endpoints that *award*
achievements (`/api/achievement/unlock`,
`/api/achievement/route-completion-achievement-unlocks`). We do not implement
them: writing would falsify the data the library reads. A test enforces that no
write-shaped method exists on the client.

## Verify against the real API, and don't guess field meanings

Every endpoint here was confirmed against a live account. When adding one:

- Capture a real response and commit it as a fixture under `test/fixtures/`.
- For protobuf, decode with `wire.decode()` and expose **named** fields only
  where you are confident; leave the rest keyed by field number and mark the
  method experimental. Do not invent semantics.
- Never commit tokens, credentials, or personal data. Fixtures must be scrubbed.

## Develop

```bash
npm test          # all tests run offline against a fetch stub + fixtures
```

The client takes a `fetchImpl`, so everything is testable without the network.

## Discovering endpoints

The macOS game binary contains literal `/api/...` paths and `NetworkService`
method names — the most reliable way to find real endpoints (see the project's
research notes). Proxying the running client is the definitive method for
request shapes; the game uses libcurl with a bundled `cacert.pem` and no
certificate pinning.
