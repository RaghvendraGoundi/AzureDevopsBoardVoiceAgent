-- People who have signed in, and their role in DevOps Voice.
create table if not exists users (
  user_key      text primary key,
  tenant_id     text,
  object_id     text,
  name          text not null default '',
  email         text,
  role          text not null default 'user' check (role in ('user', 'admin')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- Saved conversations: what was said, and what changed on the board.
create table if not exists conversations (
  id          text primary key,
  user_key    text not null,
  title       text not null,
  created_at  timestamptz not null,
  updated_at  timestamptz not null
);
create index if not exists conversations_user_updated on conversations (user_key, updated_at desc);

create table if not exists conversation_turns (
  conversation_id  text not null references conversations (id) on delete cascade,
  id               text not null,
  role             text not null check (role in ('user', 'assistant')),
  text             text not null,
  at               timestamptz not null,
  primary key (conversation_id, id)
);
create index if not exists conversation_turns_at on conversation_turns (conversation_id, at);

create table if not exists conversation_changes (
  conversation_id  text not null references conversations (id) on delete cascade,
  id               text not null,
  kind             text not null,
  item             jsonb not null,
  before           jsonb,
  at               timestamptz not null,
  primary key (conversation_id, id)
);

-- Telemetry: one row per voice call, per tool call, and per client event.
create table if not exists voice_sessions (
  id               text primary key,
  user_key         text not null,
  conversation_id  text,
  engine           text,
  model            text,
  voice            text,
  started_at       timestamptz not null default now(),
  connected_ms     integer,
  ended_at         timestamptz,
  ended_by         text,
  error            text
);
create index if not exists voice_sessions_started on voice_sessions (started_at desc);
create index if not exists voice_sessions_user on voice_sessions (user_key, started_at desc);

create table if not exists tool_calls (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  user_key     text not null,
  session_id   text,
  tool         text not null,
  -- As the model sent them: emails are already aliased (see src/lib/privacy).
  args         jsonb,
  ok           boolean not null,
  error        text,
  duration_ms  integer not null
);
create index if not exists tool_calls_at on tool_calls (at desc);
create index if not exists tool_calls_user on tool_calls (user_key, at desc);
create index if not exists tool_calls_session on tool_calls (session_id);

create table if not exists client_events (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  user_key    text not null,
  session_id  text,
  type        text not null,
  data        jsonb
);
create index if not exists client_events_at on client_events (at desc);
create index if not exists client_events_session on client_events (session_id);
