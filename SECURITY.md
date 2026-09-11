# Security policy

## Reporting a vulnerability

Please report security issues privately via GitHub's **"Report a vulnerability"**
(Security → Advisories) rather than a public issue. Include steps to reproduce.

## Scope and design

`zwift-api` is a **read-only** client. It implements no write endpoints, and a
test asserts no write-shaped method exists on the client.

**Credentials.** The library never persists your password (it is used once for
the token grant) and never logs token material. Only a refresh token is stored,
and only by a token store you supply. Treat that refresh token as a long-lived
credential — the refresh grant returns an access token valid for ~1000 days.
Store it at `0600` or tighter. Error messages are scrubbed of token values.

**No telemetry.** The library makes requests only to the Zwift hosts its methods
name, and only when you call them.
