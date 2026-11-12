-- OAuth 2.1 (authorization code + PKCE) for the AI connector's MCP endpoint, alongside the existing
-- auz_mcp_... Bearer keys (db/318) -- never replacing them. ChatGPT's custom-connector flow requires real
-- OAuth discovery (it doesn't offer a "paste a Bearer token" field the way Claude.ai does); Claude and any
-- existing integration keep working on the connector-key path untouched.
--
-- Same shape as every other pre-session auth table in this codebase (auth_users, auth_sessions, phone_otps,
-- payments -- see their own comments): plain tables, NO RLS, touched only by trusted server code
-- (server/src/routes/oauth.js, via a plain pool query) because there is no logged-in app.uid at the point
-- these are used -- that's the whole job of this flow. Nothing here is reachable through the generic
-- /db/:table whitelist (none of these three tables are listed in data/tables.js).
--
-- Tokens and codes are never stored in the clear -- only a sha256 hash, exactly like mcp_api_keys.key_hash
-- and every email-verification/password-reset token already in this codebase.

-- A client is "registered" the moment an AI app's connector flow asks to (Dynamic Client Registration,
-- RFC 7591) -- no admin approval step, matching how ChatGPT's own connector setup expects to just work.
-- Public client only (no secret): PKCE is what actually secures the code exchange, which is the standard
-- shape for a client that cannot keep a secret (a server-side AI connector backend, in ChatGPT's case).
create table oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_name text not null default 'AI app',
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

-- Short-lived (10 min), single-use. code_challenge/method implement PKCE (S256 only -- 'plain' is not
-- accepted, matching OAuth 2.1's own tightened baseline over classic OAuth 2.0).
create table oauth_auth_codes (
  code_hash text primary key,
  client_id uuid not null references oauth_clients(id) on delete cascade,
  user_id uuid not null references auth_users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  scope text not null default 'read write',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index oauth_auth_codes_expiry_idx on oauth_auth_codes (expires_at);

-- One row per issued access token; refresh_token_hash is null until the first refresh happens to share
-- the row, or set at issue time -- either way, revoking a row kills both together (a stolen access token's
-- refresh token dies with it, same intent as auth_sessions' single-device revocation, db/071).
create table oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references oauth_clients(id) on delete cascade,
  user_id uuid not null references auth_users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  access_token_hash text not null unique,
  refresh_token_hash text unique,
  scope text not null default 'read write',
  access_expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index oauth_tokens_tenant_idx on oauth_tokens (tenant_id) where revoked_at is null;

grant select, insert, update, delete on oauth_clients, oauth_auth_codes, oauth_tokens to app;
