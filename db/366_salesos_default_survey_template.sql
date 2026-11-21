-- AUZslab SalesOS: seed a default "Business visit survey" template for the internal tenant so
-- field staff have something to fill the moment they tap Survey on a checked-in visit, instead
-- of hitting "No survey templates yet" (the template builder itself already existed, see
-- sos_survey_template_save in db/357 -- this just gives it real starting content).
do $$
declare tid uuid; v_id uuid;
begin
  select id into tid from tenants where slug = 'auzslab-internal';
  if tid is null then return; end if;

  insert into sos_survey_templates (tenant_id, name, category, active)
  values (tid, 'Business visit survey', 'market_research', true)
  on conflict (tenant_id, name) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from sos_survey_templates where tenant_id = tid and name = 'Business visit survey';
  end if;

  if not exists (select 1 from sos_survey_questions where template_id = v_id) then
    insert into sos_survey_questions (template_id, label, kind, options, sort_order, required) values
      (v_id, 'Business name', 'text', null, 0, true),
      (v_id, 'Business type / niche', 'dropdown', '["Cafe / restaurant","Retail / general store","Salon / spa","Mobile shop","Grocery / kirana","Clothing / apparel","Other"]'::jsonb, 1, true),
      (v_id, 'Who did you speak to?', 'text', null, 2, true),
      (v_id, 'Owner''s name', 'text', null, 3, false),
      (v_id, 'Owner''s mobile number', 'text', null, 4, false),
      (v_id, 'Do they already use any billing/POS/CRM software?', 'yes_no', null, 5, true),
      (v_id, 'Which software do they use?', 'text', null, 6, false),
      (v_id, 'How did they get that software?', 'dropdown', '["Friend / family recommendation","Local vendor / dealer","Found it online","A salesperson visited them","Came with their shop / inherited","Other"]'::jsonb, 7, false),
      (v_id, 'What does it cost them (per month, approx)?', 'text', null, 8, false),
      (v_id, 'Their response to our visit', 'single_choice', '["Very interested","Somewhat interested, wants a demo","Not interested right now","Already decided not to switch","Asked us to follow up later"]'::jsonb, 9, true);
  end if;
end $$;
