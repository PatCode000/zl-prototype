# Decision 001: Move Compose environment values into .env

Date: 2026-06-28

## Context

The Docker Compose configuration previously hardcoded local environment values directly in `docker-compose.yml`. This included service URLs, database configuration, node identity, frontend `VITE_` URLs, and published development ports.

Those values are useful defaults for local development, but they are also the values most likely to change between machines, environments, or demos.

## Decision

Move environment-specific Compose values into a local `.env` file and document the expected variables in `.env.example`.

`docker-compose.yml` now references these values with Docker Compose variable substitution, while keeping the same services, build contexts, internal container communication, and default exposed ports.

## Why

This change was introduced to:

- keep local machine configuration out of the Compose file;
- make the runtime configuration easier to adjust without editing service definitions;
- document all required Compose variables in one place;
- avoid committing personal or environment-specific `.env` values;
- make frontend-exposed `VITE_` variables explicit, so no private values are accidentally placed there.

## Consequences

Developers need a `.env` file before running the project locally. The repository includes `.env.example` as the source of safe defaults.

The local startup command stays the same:

```bash
docker compose up --build
```

`.env` is intentionally ignored by Git.
