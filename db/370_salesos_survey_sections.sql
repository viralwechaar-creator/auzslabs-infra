-- AUZslab SalesOS: group survey questions into sections (tabs) so a field rep fills a
-- business-survey template step by step instead of scrolling one 70+ question list -- the
-- owner's own recommended "Survey sections 1 of 7" interface. Every db/366/368 question gets a
-- section label backfilled here; everything stays optional exactly as it already was.
alter table sos_survey_questions add column if not exists section text;

create or replace function sos_survey_template_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
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
    insert into sos_survey_questions (template_id, label, kind, options, sort_order, required, section)
    select v_id, x.q->>'label', x.q->>'kind', x.q->'options', (x.ord - 1)::int, coalesce((x.q->>'required')::boolean, false), nullif(x.q->>'section', '')
    from jsonb_array_elements(p->'questions') with ordinality x(q, ord);
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function sos_survey_templates_list(p_active_only boolean default true) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'category', t.category, 'active', t.active,
      'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'label', q.label, 'kind', q.kind,
          'options', q.options, 'required', q.required, 'section', q.section) order by q.sort_order)
        from sos_survey_questions q where q.template_id = t.id), '[]'::jsonb)
    ) order by t.name)
    from sos_survey_templates t where t.tenant_id = tid and (not p_active_only or t.active)), '[]'::jsonb);
end $$;

do $$
declare tid uuid; v_id uuid;
begin
  select id into tid from tenants where slug = 'auzslab-internal';
  if tid is null then return; end if;
  select id into v_id from sos_survey_templates where tenant_id = tid and name = 'Business visit survey';
  if v_id is null then return; end if;

  update sos_survey_questions set section = 'Business information' where template_id = v_id and label in
    ('Business name', 'Business type / niche', 'Business subcategory', 'Who did you speak to?', 'Owner''s name', 'Owner''s mobile number',
     'WhatsApp number (if different)', 'Business email', 'Full shop address', 'City / PIN code', 'Google Maps link', 'Website (if any)', 'Instagram handle', 'GST registration');
  update sos_survey_questions set section = 'Business size & operations' where template_id = v_id and label in
    ('Years in operation', 'Number of branches / outlets', 'Number of employees', 'Number of billing counters', 'Average daily customers', 'Average daily transactions',
     'Estimated monthly turnover (confidential, only if shared)', 'Opening and closing hours', 'Seasonal business or year-round?', 'Single-owner or partnership?', 'Expansion plans?');
  update sos_survey_questions set section = 'Existing technology & software' where template_id = v_id and label in
    ('Do they already use any billing/POS/CRM software?', 'Which software do they use?', 'How did they get that software?', 'What does it cost them (per month, approx)?',
     'Inventory management', 'Accounting system', 'Has a POS system?', 'Has a website?', 'Sells online via', 'Uses a barcode system?', 'Cloud-based system?', 'Devices used',
     'Current software renewal date (if known)', 'Satisfaction with current software', 'Biggest limitation of current software', 'Willing to switch software?');
  update sos_survey_questions set section = 'Problems & pain points' where template_id = v_id and label in
    ('Biggest daily operational problem', 'Faces billing delays?', 'Inventory mismatches?', 'Is stock tracking difficult?', 'Struggles with employee management?',
     'Difficult to generate business reports?', 'Difficult to track multiple outlets?', 'Loses sales due to unavailable stock?', 'Is existing software difficult to use?',
     'What is the one problem you wish technology could solve immediately?');
  update sos_survey_questions set section = 'Product interest' where template_id = v_id and label in
    ('AUZslab products of interest', 'Which features matter most to them?', 'Needs customization?', 'Needs website integration?', 'Needs cloud access?', 'Needs mobile access?', 'Needs data migration from existing software?');
  update sos_survey_questions set section = 'Budget & purchasing' where template_id = v_id and label in
    ('Expected budget', 'Preferred payment', 'Purchase readiness', 'Decision maker', 'Purchase approval required?', 'Competitor quotation (if shared)');
  update sos_survey_questions set section = 'Competitor intelligence' where template_id = v_id and label in
    ('Competitor software name', 'Competitor approximate pricing', 'What features does the competitor provide?', 'What does the customer dislike about the competitor?',
     'What does the customer like about the competitor?', 'Why would they consider switching?', 'Any offers the competitor is currently running?');
  -- their response to our visit: its own closing section
  update sos_survey_questions set section = 'Visit outcome' where template_id = v_id and label = 'Their response to our visit';
end $$;

grant execute on function sos_survey_template_save(jsonb) to app;
grant execute on function sos_survey_templates_list(boolean) to app;
