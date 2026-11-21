-- AUZslab SalesOS: dynamic market-survey engine. Admin creates/edits templates and questions
-- with no code change (brief's own requirement); a field rep fills one against a visit.
create table sos_survey_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  category text, -- e.g. 'clothing', 'grocery', 'cafe', 'salon', 'competitor_research', 'other'
  active boolean not null default true,
  created_by uuid references auth_users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
alter table sos_survey_templates enable row level security;

create table sos_survey_questions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references sos_survey_templates(id) on delete cascade,
  label text not null,
  kind text not null check (kind in ('text', 'number', 'single_choice', 'multiple_choice', 'dropdown', 'date', 'yes_no')),
  options jsonb, -- ["Option A","Option B"] for choice/dropdown kinds
  sort_order int not null default 0,
  required boolean not null default false
);
create index idx_sos_survey_questions_template on sos_survey_questions (template_id, sort_order);
alter table sos_survey_questions enable row level security;

create table sos_survey_responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  template_id uuid not null references sos_survey_templates(id),
  visit_id uuid references sos_visits(id) on delete set null,
  business_id uuid not null references sos_businesses(id) on delete cascade,
  staff_id uuid not null references auth_users(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb, -- {"<question_id>": "<answer>"}
  created_at timestamptz not null default now()
);
create index idx_sos_survey_responses_business on sos_survey_responses (business_id, created_at desc);
alter table sos_survey_responses enable row level security;

-- ---------- admin: manage templates (no code change needed to add one) ----------
create function sos_survey_template_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage'); v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if nullif(btrim(p->>'name'), '') is null then raise exception 'Enter a template name'; end if;
  if v_id is null then
    insert into sos_survey_templates (tenant_id, name, category, created_by) values (tid, btrim(p->>'name'), nullif(p->>'category', ''), app_uid())
    returning id into v_id;
  else
    update sos_survey_templates set name = btrim(p->>'name'), category = nullif(p->>'category', ''), active = coalesce((p->>'active')::boolean, true)
    where id = v_id and tenant_id = tid;
    if not found then raise exception 'template not found'; end if;
    delete from sos_survey_questions where template_id = v_id;
  end if;
  if p ? 'questions' then
    insert into sos_survey_questions (template_id, label, kind, options, sort_order, required)
    select v_id, x.q->>'label', x.q->>'kind', x.q->'options', (x.ord - 1)::int, coalesce((x.q->>'required')::boolean, false)
    from jsonb_array_elements(p->'questions') with ordinality x(q, ord);
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create function sos_survey_templates_list(p_active_only boolean default true) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'category', t.category, 'active', t.active,
      'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'label', q.label, 'kind', q.kind,
          'options', q.options, 'required', q.required) order by q.sort_order)
        from sos_survey_questions q where q.template_id = t.id), '[]'::jsonb)
    ) order by t.name)
    from sos_survey_templates t where t.tenant_id = tid and (not p_active_only or t.active)), '[]'::jsonb);
end $$;

create function sos_survey_submit(p_template uuid, p_business uuid, p_visit uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); row sos_survey_responses%rowtype; missing text;
begin
  if not exists (select 1 from sos_survey_templates where id = p_template and tenant_id = tid) then raise exception 'template not found'; end if;
  if not exists (select 1 from sos_businesses where id = p_business and tenant_id = tid) then raise exception 'business not found'; end if;
  select label into missing from sos_survey_questions where template_id = p_template and required
    and coalesce(nullif(btrim(p_answers->>(id::text)), ''), '') = '' limit 1;
  if missing is not null then raise exception 'Please answer: %', missing; end if;
  insert into sos_survey_responses (tenant_id, template_id, visit_id, business_id, staff_id, answers)
  values (tid, p_template, p_visit, p_business, app_uid(), coalesce(p_answers, '{}'::jsonb))
  returning * into row;
  return to_jsonb(row);
end $$;

create function sos_survey_responses_for_business(p_business uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'templateName', t.name, 'answers', r.answers,
      'createdAt', r.created_at, 'staffId', r.staff_id) order by r.created_at desc)
    from sos_survey_responses r join sos_survey_templates t on t.id = r.template_id
    where r.tenant_id = tid and r.business_id = p_business), '[]'::jsonb);
end $$;

-- admin/manager: aggregate market intelligence (category breakdown as reported, clearly unverified employee data)
create function sos_market_intel() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage');
begin
  return jsonb_build_object(
    'totalResponses', (select count(*) from sos_survey_responses where tenant_id = tid),
    'byCategory', coalesce((select jsonb_agg(jsonb_build_object('category', coalesce(category, 'unspecified'), 'count', n) order by n desc)
      from (select b.category, count(*) n from sos_survey_responses r join sos_businesses b on b.id = r.business_id
            where r.tenant_id = tid group by b.category) x), '[]'::jsonb));
end $$;

grant select, insert, update on sos_survey_templates to app;
grant select, insert, update, delete on sos_survey_questions to app;
grant select, insert on sos_survey_responses to app;
grant execute on function sos_survey_template_save(jsonb) to app;
grant execute on function sos_survey_templates_list(boolean) to app;
grant execute on function sos_survey_submit(uuid, uuid, uuid, jsonb) to app;
grant execute on function sos_survey_responses_for_business(uuid) to app;
grant execute on function sos_market_intel() to app;
