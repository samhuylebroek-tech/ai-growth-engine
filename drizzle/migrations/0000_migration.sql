
-- ===== Enums =====
create type public.org_role as enum ('owner','admin','member','viewer');
create type public.platform_role as enum ('platform_owner','support','finance');
create type public.approval_status as enum ('pending','approved','rejected','executed','failed','expired');
create type public.fact_source as enum ('user','document','website','ai_assumption','external');

-- ===== updated_at helper =====
create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

-- ===== Profiles =====
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  locale text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "own profile read" on public.profiles for select to authenticated using (user_id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(user_id, display_name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), new.raw_user_meta_data->>'avatar_url')
  on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ===== Platform roles (separate from tenant roles) =====
create table public.platform_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.platform_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);
grant select on public.platform_roles to authenticated;
grant all on public.platform_roles to service_role;
alter table public.platform_roles enable row level security;
create policy "own platform roles" on public.platform_roles for select to authenticated using (user_id = auth.uid());

create or replace function public.has_platform_role(_role public.platform_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.platform_roles where user_id = auth.uid() and role = _role)
$$;
create or replace function public.is_platform_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.platform_roles where user_id = auth.uid())
$$;

-- ===== Commercial: plans =====
create table public.plans (
  key text primary key,
  name text not null,
  tier int not null,
  description text,
  price_monthly_eur numeric(10,2),
  price_yearly_eur numeric(10,2),
  monthly_credits int not null default 0,
  is_public boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.plans to anon, authenticated;
grant all on public.plans to service_role;
alter table public.plans enable row level security;
create policy "public plans readable" on public.plans for select to anon, authenticated using (active and is_public or public.is_platform_staff());
create policy "staff manage plans" on public.plans for all to authenticated using (public.has_platform_role('platform_owner')) with check (public.has_platform_role('platform_owner'));
grant insert, update, delete on public.plans to authenticated;
create trigger plans_touch before update on public.plans for each row execute function public.touch_updated_at();

create table public.plan_entitlements (
  plan_key text not null references public.plans(key) on delete cascade,
  feature_key text not null,
  limit_value int, -- null = unlimited, 0 = not included
  primary key (plan_key, feature_key)
);
grant select on public.plan_entitlements to anon, authenticated;
grant insert, update, delete on public.plan_entitlements to authenticated;
grant all on public.plan_entitlements to service_role;
alter table public.plan_entitlements enable row level security;
create policy "entitlements readable" on public.plan_entitlements for select to anon, authenticated using (true);
create policy "staff manage entitlements" on public.plan_entitlements for all to authenticated using (public.has_platform_role('platform_owner')) with check (public.has_platform_role('platform_owner'));

-- ===== Organizations =====
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  type text not null default 'business' check (type in ('business','agency','enterprise')),
  parent_org_id uuid references public.organizations(id) on delete set null,
  status text not null default 'active' check (status in ('active','suspended','deleted')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.organization_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index on public.organization_members(user_id);

create or replace function public.role_rank(_r public.org_role) returns int language sql immutable set search_path = public as $$
  select case _r when 'owner' then 4 when 'admin' then 3 when 'member' then 2 else 1 end
$$;
create or replace function public.has_org_role(_org uuid, _min public.org_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.organization_members m join public.organizations o on o.id = m.org_id
    where m.org_id = _org and m.user_id = auth.uid() and o.status = 'active'
      and public.role_rank(m.role) >= public.role_rank(_min))
$$;
create or replace function public.is_org_member(_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_org_role(_org, 'viewer')
$$;

grant select, update on public.organizations to authenticated;
grant all on public.organizations to service_role;
alter table public.organizations enable row level security;
create policy "members read org" on public.organizations for select to authenticated using (public.is_org_member(id) or public.is_platform_staff());
create policy "admins update org" on public.organizations for update to authenticated using (public.has_org_role(id,'admin')) with check (public.has_org_role(id,'admin'));
create trigger orgs_touch before update on public.organizations for each row execute function public.touch_updated_at();

grant select, update, delete on public.organization_members to authenticated;
grant all on public.organization_members to service_role;
alter table public.organization_members enable row level security;
create policy "members read members" on public.organization_members for select to authenticated using (public.is_org_member(org_id) or public.is_platform_staff());
create policy "admins update members" on public.organization_members for update to authenticated
  using (public.has_org_role(org_id,'admin') and role <> 'owner')
  with check (public.has_org_role(org_id,'admin') and role <> 'owner');
create policy "admins remove members or self leave" on public.organization_members for delete to authenticated
  using ((public.has_org_role(org_id,'admin') and role <> 'owner') or (user_id = auth.uid() and role <> 'owner'));

-- ===== Workspaces =====
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  kind text not null default 'brand' check (kind in ('brand','website','business_unit')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.workspaces(org_id);
grant select, insert, update, delete on public.workspaces to authenticated;
grant all on public.workspaces to service_role;
alter table public.workspaces enable row level security;
create policy "members read ws" on public.workspaces for select to authenticated using (public.is_org_member(org_id));
create policy "admins insert ws" on public.workspaces for insert to authenticated with check (public.has_org_role(org_id,'admin'));
create policy "admins update ws" on public.workspaces for update to authenticated using (public.has_org_role(org_id,'admin')) with check (public.has_org_role(org_id,'admin'));
create policy "owners delete ws" on public.workspaces for delete to authenticated using (public.has_org_role(org_id,'owner'));
create trigger ws_touch before update on public.workspaces for each row execute function public.touch_updated_at();

create or replace function public.ws_org(_ws uuid) returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.workspaces where id = _ws
$$;

-- ===== Invitations =====
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.org_role not null default 'member' check (role <> 'owner'),
  token uuid not null default gen_random_uuid() unique,
  invited_by uuid not null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, insert, delete on public.invitations to authenticated;
grant all on public.invitations to service_role;
alter table public.invitations enable row level security;
create policy "admins read invites" on public.invitations for select to authenticated using (public.has_org_role(org_id,'admin'));
create policy "admins create invites" on public.invitations for insert to authenticated with check (public.has_org_role(org_id,'admin') and invited_by = auth.uid());
create policy "admins delete invites" on public.invitations for delete to authenticated using (public.has_org_role(org_id,'admin'));

-- ===== Audit log (append-only, writes via function only) =====
create table public.audit_logs (
  id bigint generated always as identity primary key,
  org_id uuid,
  actor_id uuid,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_logs(org_id, created_at desc);
grant select on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
alter table public.audit_logs enable row level security;
create policy "admins read audit" on public.audit_logs for select to authenticated using ((org_id is not null and public.has_org_role(org_id,'admin')) or public.is_platform_staff());

create or replace function public.log_audit(_org uuid, _action text, _target_type text, _target_id text, _metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if _org is not null and not public.is_org_member(_org) and not public.is_platform_staff() then raise exception 'forbidden'; end if;
  insert into public.audit_logs(org_id, actor_id, action, target_type, target_id, metadata)
  values (_org, auth.uid(), left(_action,100), left(_target_type,50), left(_target_id,100), coalesce(_metadata,'{}'::jsonb));
end $$;

-- ===== Subscriptions & credits =====
create table public.subscriptions (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  plan_key text not null references public.plans(key),
  status text not null default 'trialing' check (status in ('trialing','active','past_due','canceled')),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly','yearly')),
  trial_ends_at timestamptz,
  current_period_start timestamptz not null default date_trunc('month', now()),
  provider text not null default 'none',
  provider_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, update on public.subscriptions to authenticated;
grant all on public.subscriptions to service_role;
alter table public.subscriptions enable row level security;
create policy "members read sub" on public.subscriptions for select to authenticated using (public.is_org_member(org_id) or public.is_platform_staff());
create policy "platform owner updates sub" on public.subscriptions for update to authenticated using (public.has_platform_role('platform_owner')) with check (public.has_platform_role('platform_owner'));
create trigger subs_touch before update on public.subscriptions for each row execute function public.touch_updated_at();

create table public.credit_ledger (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  delta int not null,
  reason text not null check (reason in ('plan_grant','usage','purchase','adjustment','refund')),
  ref text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index on public.credit_ledger(org_id, created_at desc);
grant select on public.credit_ledger to authenticated;
grant all on public.credit_ledger to service_role;
alter table public.credit_ledger enable row level security;
create policy "members read ledger" on public.credit_ledger for select to authenticated using (public.is_org_member(org_id) or public.is_platform_staff());

create or replace function public.credit_balance(_org uuid) returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta),0)::int from public.credit_ledger where org_id = _org
$$;

create or replace function public.org_entitlement(_org uuid, _feature text) returns int
language sql stable security definer set search_path = public as $$
  select e.limit_value from public.subscriptions s join public.plan_entitlements e on e.plan_key = s.plan_key
  where s.org_id = _org and e.feature_key = _feature
$$;
create or replace function public.org_has_entitlement_row(_org uuid, _feature text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.subscriptions s join public.plan_entitlements e on e.plan_key = s.plan_key where s.org_id = _org and e.feature_key = _feature)
$$;

-- Atomic credit consumption. Locks the org row to serialize concurrent spends.
create or replace function public.consume_credits(_org uuid, _amount int, _ref text)
returns int language plpgsql security definer set search_path = public as $$
declare bal int; st text;
begin
  if not public.has_org_role(_org,'member') then raise exception 'forbidden'; end if;
  if _amount <= 0 or _amount > 1000 then raise exception 'invalid amount'; end if;
  perform 1 from public.organizations where id = _org for update;
  select status into st from public.subscriptions where org_id = _org;
  if st is null or st = 'canceled' then raise exception 'no active subscription'; end if;
  bal := public.credit_balance(_org);
  if bal < _amount then raise exception 'insufficient credits'; end if;
  insert into public.credit_ledger(org_id, delta, reason, ref, created_by) values (_org, -_amount, 'usage', left(_ref,100), auth.uid());
  return bal - _amount;
end $$;

create or replace function public.admin_grant_credits(_org uuid, _amount int, _note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_platform_role('platform_owner') then raise exception 'forbidden'; end if;
  insert into public.credit_ledger(org_id, delta, reason, ref, created_by) values (_org, _amount, 'adjustment', left(_note,100), auth.uid());
  insert into public.audit_logs(org_id, actor_id, action, target_type, target_id, metadata) values (_org, auth.uid(), 'credits.adjusted', 'organization', _org::text, jsonb_build_object('amount',_amount,'note',_note));
end $$;

create table public.billing_profiles (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  legal_name text, country text, vat_id text, vat_validated boolean not null default false,
  address text, reverse_charge boolean not null default false,
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.billing_profiles to authenticated;
grant all on public.billing_profiles to service_role;
alter table public.billing_profiles enable row level security;
create policy "admins read billing" on public.billing_profiles for select to authenticated using (public.has_org_role(org_id,'admin') or public.is_platform_staff());
create policy "owners write billing" on public.billing_profiles for insert to authenticated with check (public.has_org_role(org_id,'owner') and vat_validated = false);
create policy "owners update billing" on public.billing_profiles for update to authenticated using (public.has_org_role(org_id,'owner')) with check (public.has_org_role(org_id,'owner') and vat_validated = false);

-- ===== Business intelligence =====
create table public.business_profiles (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  website text, description text, industry text, business_model text,
  offerings jsonb not null default '[]', audiences jsonb not null default '[]',
  markets jsonb not null default '[]', competitors jsonb not null default '[]',
  objectives jsonb not null default '[]', monthly_budget_eur numeric(12,2),
  onboarding_completed_at timestamptz,
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.business_profiles to authenticated;
grant all on public.business_profiles to service_role;
alter table public.business_profiles enable row level security;
create policy "members read bp" on public.business_profiles for select to authenticated using (public.is_org_member(org_id));
create policy "members insert bp" on public.business_profiles for insert to authenticated with check (public.has_org_role(org_id,'member') and org_id = public.ws_org(workspace_id));
create policy "members update bp" on public.business_profiles for update to authenticated using (public.has_org_role(org_id,'member')) with check (public.has_org_role(org_id,'member') and org_id = public.ws_org(workspace_id));
create trigger bp_touch before update on public.business_profiles for each row execute function public.touch_updated_at();

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null, storage_path text not null unique, mime text not null, size_bytes int not null,
  status text not null default 'uploaded' check (status in ('uploaded','processing','ready','failed')),
  extracted_text text,
  uploaded_by uuid not null,
  created_at timestamptz not null default now()
);
create index on public.documents(workspace_id);
grant select, insert, update, delete on public.documents to authenticated;
grant all on public.documents to service_role;
alter table public.documents enable row level security;
create policy "members read docs" on public.documents for select to authenticated using (public.is_org_member(org_id));
create policy "members insert docs" on public.documents for insert to authenticated with check (public.has_org_role(org_id,'member') and org_id = public.ws_org(workspace_id) and uploaded_by = auth.uid());
create policy "members update docs" on public.documents for update to authenticated using (public.has_org_role(org_id,'member')) with check (public.has_org_role(org_id,'member'));
create policy "admins delete docs" on public.documents for delete to authenticated using (public.has_org_role(org_id,'admin') or uploaded_by = auth.uid());

create table public.business_facts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key text not null, value text not null,
  source_type public.fact_source not null,
  source_ref text, confidence numeric(3,2), verified boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.business_facts(workspace_id);
grant select, insert, update, delete on public.business_facts to authenticated;
grant all on public.business_facts to service_role;
alter table public.business_facts enable row level security;
create policy "members read facts" on public.business_facts for select to authenticated using (public.is_org_member(org_id));
create policy "members write facts" on public.business_facts for insert to authenticated with check (public.has_org_role(org_id,'member') and org_id = public.ws_org(workspace_id));
create policy "members update facts" on public.business_facts for update to authenticated using (public.has_org_role(org_id,'member')) with check (public.has_org_role(org_id,'member'));
create policy "members delete facts" on public.business_facts for delete to authenticated using (public.has_org_role(org_id,'member'));

-- ===== AI =====
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null, title text not null default 'New conversation',
  created_at timestamptz not null default now()
);
grant select, insert, delete on public.conversations to authenticated;
grant all on public.conversations to service_role;
alter table public.conversations enable row level security;
create policy "own conversations" on public.conversations for select to authenticated using (user_id = auth.uid() and public.is_org_member(org_id));
create policy "create conversations" on public.conversations for insert to authenticated with check (user_id = auth.uid() and public.has_org_role(org_id,'member') and org_id = public.ws_org(workspace_id));
create policy "delete own conversations" on public.conversations for delete to authenticated using (user_id = auth.uid());

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index on public.messages(conversation_id, created_at);
grant select, insert on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;
create policy "read own conv messages" on public.messages for select to authenticated using (exists(select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()) and public.is_org_member(org_id));
create policy "insert own conv messages" on public.messages for insert to authenticated with check (exists(select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid() and c.org_id = messages.org_id) and public.has_org_role(org_id,'member'));

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  agent_key text not null, user_id uuid not null,
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  summary text, error text, depth int not null default 0,
  created_at timestamptz not null default now(), finished_at timestamptz
);
grant select, insert, update on public.agent_runs to authenticated;
grant all on public.agent_runs to service_role;
alter table public.agent_runs enable row level security;
create policy "members read runs" on public.agent_runs for select to authenticated using (public.is_org_member(org_id));
create policy "members insert runs" on public.agent_runs for insert to authenticated with check (public.has_org_role(org_id,'member') and user_id = auth.uid() and depth <= 3);
create policy "own runs update" on public.agent_runs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.ai_usage_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid references public.agent_runs(id) on delete set null,
  user_id uuid not null,
  provider text not null, model text not null,
  input_tokens int not null default 0, output_tokens int not null default 0,
  cost_estimate_eur numeric(12,6) not null default 0,
  credits_charged int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.ai_usage_events(org_id, created_at desc);
grant select, insert on public.ai_usage_events to authenticated;
grant all on public.ai_usage_events to service_role;
alter table public.ai_usage_events enable row level security;
create policy "members read usage" on public.ai_usage_events for select to authenticated using (public.is_org_member(org_id) or public.is_platform_staff());
create policy "members record usage" on public.ai_usage_events for insert to authenticated with check (public.has_org_role(org_id,'member') and user_id = auth.uid());

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  run_id uuid references public.agent_runs(id) on delete set null,
  capability_key text not null,
  title text not null, reasoning text, expected_impact text,
  risk text not null default 'low' check (risk in ('low','medium','high')),
  payload jsonb not null default '{}',
  status public.approval_status not null default 'pending',
  requested_by uuid not null, decided_by uuid, decided_at timestamptz, decision_note text,
  created_at timestamptz not null default now()
);
create index on public.approvals(org_id, status);
grant select, insert on public.approvals to authenticated;
grant all on public.approvals to service_role;
alter table public.approvals enable row level security;
create policy "members read approvals" on public.approvals for select to authenticated using (public.is_org_member(org_id));
create policy "members propose" on public.approvals for insert to authenticated with check (public.has_org_role(org_id,'member') and requested_by = auth.uid() and status = 'pending');

create or replace function public.decide_approval(_id uuid, _approve boolean, _note text)
returns public.approval_status language plpgsql security definer set search_path = public as $$
declare a public.approvals; ns public.approval_status;
begin
  select * into a from public.approvals where id = _id for update;
  if a.id is null then raise exception 'not found'; end if;
  if not public.has_org_role(a.org_id,'admin') then raise exception 'forbidden'; end if;
  if a.status <> 'pending' then raise exception 'approval is not pending'; end if;
  ns := case when _approve then 'approved'::public.approval_status else 'rejected'::public.approval_status end;
  update public.approvals set status = ns, decided_by = auth.uid(), decided_at = now(), decision_note = left(_note,1000) where id = _id;
  insert into public.audit_logs(org_id, actor_id, action, target_type, target_id, metadata)
  values (a.org_id, auth.uid(), 'approval.' || ns::text, 'approval', _id::text, jsonb_build_object('capability', a.capability_key));
  return ns;
end $$;

create table public.policies (
  org_id uuid not null references public.organizations(id) on delete cascade,
  capability_key text not null,
  mode text not null check (mode in ('auto','approval','blocked')),
  updated_at timestamptz not null default now(),
  primary key (org_id, capability_key)
);
grant select, insert, update, delete on public.policies to authenticated;
grant all on public.policies to service_role;
alter table public.policies enable row level security;
create policy "members read policies" on public.policies for select to authenticated using (public.is_org_member(org_id));
create policy "admins write policies" on public.policies for all to authenticated using (public.has_org_role(org_id,'admin')) with check (public.has_org_role(org_id,'admin'));

-- ===== Connections & extensions (registries themselves are code manifests) =====
create table public.connector_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  connector_key text not null,
  status text not null default 'not_configured' check (status in ('not_configured','connected','error','disabled')),
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (org_id, workspace_id, connector_key)
);
grant select, insert, update, delete on public.connector_connections to authenticated;
grant all on public.connector_connections to service_role;
alter table public.connector_connections enable row level security;
create policy "members read connections" on public.connector_connections for select to authenticated using (public.is_org_member(org_id));
create policy "admins write connections" on public.connector_connections for all to authenticated using (public.has_org_role(org_id,'admin')) with check (public.has_org_role(org_id,'admin'));

create table public.workspace_extensions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  extension_key text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (workspace_id, extension_key)
);
grant select, insert, update, delete on public.workspace_extensions to authenticated;
grant all on public.workspace_extensions to service_role;
alter table public.workspace_extensions enable row level security;
create policy "members read ext" on public.workspace_extensions for select to authenticated using (public.is_org_member(org_id));
create policy "admins write ext" on public.workspace_extensions for all to authenticated using (public.has_org_role(org_id,'admin') and org_id = public.ws_org(workspace_id)) with check (public.has_org_role(org_id,'admin') and org_id = public.ws_org(workspace_id));

-- ===== RPCs: create org, accept invite =====
create or replace function public.create_organization(_name text, _workspace_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare oid uuid; wid uuid; uid uuid := auth.uid(); trial_credits int; cnt int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select count(*) into cnt from public.organizations where created_by = uid and status <> 'deleted';
  if cnt >= 10 then raise exception 'organization limit reached'; end if;
  insert into public.organizations(name, created_by) values (trim(_name), uid) returning id into oid;
  insert into public.organization_members(org_id, user_id, role) values (oid, uid, 'owner');
  insert into public.workspaces(org_id, name) values (oid, coalesce(nullif(trim(_workspace_name),''), trim(_name))) returning id into wid;
  insert into public.business_profiles(workspace_id, org_id) values (wid, oid);
  insert into public.subscriptions(org_id, plan_key, status, trial_ends_at) values (oid, 'trial', 'trialing', now() + interval '14 days');
  select monthly_credits into trial_credits from public.plans where key = 'trial';
  insert into public.credit_ledger(org_id, delta, reason, ref, created_by) values (oid, coalesce(trial_credits,0), 'plan_grant', 'trial', uid);
  insert into public.audit_logs(org_id, actor_id, action, target_type, target_id) values (oid, uid, 'organization.created', 'organization', oid::text);
  return oid;
end $$;

create or replace function public.accept_invitation(_token uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv public.invitations; em text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select email into em from auth.users where id = auth.uid();
  select * into inv from public.invitations where token = _token for update;
  if inv.id is null or inv.accepted_at is not null or inv.expires_at < now() then raise exception 'invitation invalid or expired'; end if;
  if lower(inv.email) <> lower(em) then raise exception 'invitation is for a different email'; end if;
  insert into public.organization_members(org_id, user_id, role) values (inv.org_id, auth.uid(), inv.role) on conflict (org_id,user_id) do nothing;
  update public.invitations set accepted_at = now() where id = inv.id;
  insert into public.audit_logs(org_id, actor_id, action, target_type, target_id) values (inv.org_id, auth.uid(), 'member.joined', 'invitation', inv.id::text);
  return inv.org_id;
end $$;

-- Prevent members from assigning owner role via update
create or replace function public.guard_member_role() returns trigger language plpgsql set search_path = public as $$
begin
  if new.role = 'owner' and old.role <> 'owner' then raise exception 'cannot promote to owner'; end if;
  if new.org_id <> old.org_id or new.user_id <> old.user_id then raise exception 'immutable'; end if;
  return new;
end $$;
create trigger members_guard before update on public.organization_members for each row execute function public.guard_member_role();

-- ===== Seed plans (prices are placeholders, D3 open) =====
insert into public.plans(key,name,tier,description,price_monthly_eur,price_yearly_eur,monthly_credits,is_public) values
 ('trial','Free trial',0,'14 days to explore the platform',0,0,200,true),
 ('starter','Starter',1,'For solo founders and small teams',49,490,1000,true),
 ('professional','Professional',2,'For growing businesses',149,1490,5000,true),
 ('business','Business',3,'For established teams',399,3990,15000,true),
 ('agency','Agency',4,'Manage multiple client organizations',799,7990,40000,true),
 ('enterprise','Enterprise',5,'Custom security, scale and support',null,null,0,true);

insert into public.plan_entitlements(plan_key, feature_key, limit_value) values
 ('trial','workspaces',1),('trial','seats',2),('trial','documents',5),('trial','ai_assistant',null),('trial','approvals',null),('trial','integrations',1),
 ('starter','workspaces',1),('starter','seats',3),('starter','documents',25),('starter','ai_assistant',null),('starter','approvals',null),('starter','integrations',3),
 ('professional','workspaces',3),('professional','seats',10),('professional','documents',200),('professional','ai_assistant',null),('professional','approvals',null),('professional','integrations',10),
 ('business','workspaces',10),('business','seats',25),('business','documents',1000),('business','ai_assistant',null),('business','approvals',null),('business','integrations',null),
 ('agency','workspaces',50),('agency','seats',50),('agency','documents',5000),('agency','ai_assistant',null),('agency','approvals',null),('agency','integrations',null),('agency','client_orgs',25),
 ('enterprise','workspaces',null),('enterprise','seats',null),('enterprise','documents',null),('enterprise','ai_assistant',null),('enterprise','approvals',null),('enterprise','integrations',null),('enterprise','client_orgs',null);

-- Function execution grants
revoke execute on function public.create_organization(text,text), public.accept_invitation(uuid), public.consume_credits(uuid,int,text), public.admin_grant_credits(uuid,int,text), public.decide_approval(uuid,boolean,text), public.log_audit(uuid,text,text,text,jsonb) from public, anon;
grant execute on function public.create_organization(text,text), public.accept_invitation(uuid), public.consume_credits(uuid,int,text), public.admin_grant_credits(uuid,int,text), public.decide_approval(uuid,boolean,text), public.log_audit(uuid,text,text,text,jsonb), public.credit_balance(uuid), public.org_entitlement(uuid,text), public.has_org_role(uuid,public.org_role), public.is_org_member(uuid) to authenticated;
