-- AUZslab SalesOS: expand the default "Business visit survey" (db/366) with the fuller Business
-- Survey Form / Lead Intelligence questions the owner specified -- business profile, size and
-- operations, existing software, pain points, product interest, budget, and competitor
-- intelligence. All optional (owner's own instruction: "add them optional") so a field rep can
-- still submit a quick survey without filling every section; Lead ID/salesperson/visit
-- date-time/GPS/outcome/next-action already exist as real structured fields on sos_visits (db/353)
-- and are deliberately NOT duplicated here as free-text survey questions.
do $$
declare tid uuid; v_id uuid; n int;
begin
  select id into tid from tenants where slug = 'auzslab-internal';
  if tid is null then return; end if;
  select id into v_id from sos_survey_templates where tenant_id = tid and name = 'Business visit survey';
  if v_id is null then return; end if;
  select coalesce(max(sort_order), -1) + 1 into n from sos_survey_questions where template_id = v_id;

  -- helper: insert a question only if this template doesn't already have one with that label.
  -- ord is an explicit literal (not row order, which a temp table/CTE does not guarantee) so the
  -- sections stay in the order written below even after the not-exists filter below runs.
  create temporary table if not exists _sos_q_tmp (ord int, label text, kind text, options jsonb) on commit drop;
  delete from _sos_q_tmp;
  insert into _sos_q_tmp (ord, label, kind, options) values
    -- 1. business profile (fields not already on sos_businesses / the db/366 questions)
    (1, 'Business subcategory', 'text', null),
    (2, 'WhatsApp number (if different)', 'text', null),
    (3, 'Business email', 'text', null),
    (4, 'Full shop address', 'text', null),
    (5, 'City / PIN code', 'text', null),
    (6, 'Google Maps link', 'text', null),
    (7, 'Website (if any)', 'text', null),
    (8, 'Instagram handle', 'text', null),
    (9, 'GST registration', 'single_choice', '["Registered","Unregistered","Not applicable"]'::jsonb),
    -- 2. business size and operations
    (10, 'Years in operation', 'number', null),
    (11, 'Number of branches / outlets', 'number', null),
    (12, 'Number of employees', 'number', null),
    (13, 'Number of billing counters', 'number', null),
    (14, 'Average daily customers', 'number', null),
    (15, 'Average daily transactions', 'number', null),
    (16, 'Estimated monthly turnover (confidential, only if shared)', 'text', null),
    (17, 'Opening and closing hours', 'text', null),
    (18, 'Seasonal business or year-round?', 'single_choice', '["Seasonal","Year-round"]'::jsonb),
    (19, 'Single-owner or partnership?', 'single_choice', '["Single-owner","Partnership"]'::jsonb),
    (20, 'Expansion plans?', 'yes_no', null),
    -- 3. existing technology (beyond db/366's current-software question)
    (21, 'Inventory management', 'single_choice', '["Software","Excel","Manual","None"]'::jsonb),
    (22, 'Accounting system', 'single_choice', '["Tally","Other software","Manual","None"]'::jsonb),
    (23, 'Has a POS system?', 'yes_no', null),
    (24, 'Has a website?', 'yes_no', null),
    (25, 'Sells online via', 'single_choice', '["Website","Marketplace","WhatsApp","None"]'::jsonb),
    (26, 'Uses a barcode system?', 'yes_no', null),
    (27, 'Cloud-based system?', 'single_choice', '["Yes","No","Unknown"]'::jsonb),
    (28, 'Devices used', 'multiple_choice', '["PC","Laptop","Tablet","Mobile"]'::jsonb),
    (29, 'Current software renewal date (if known)', 'date', null),
    (30, 'Satisfaction with current software', 'single_choice', '["Very satisfied","Satisfied","Neutral","Unsatisfied","Very unsatisfied"]'::jsonb),
    (31, 'Biggest limitation of current software', 'text', null),
    (32, 'Willing to switch software?', 'yes_no', null),
    -- 4. pain points
    (33, 'Biggest daily operational problem', 'single_choice', '["Billing","Inventory","Staff","Accounting","Other"]'::jsonb),
    (34, 'Faces billing delays?', 'yes_no', null),
    (35, 'Inventory mismatches?', 'single_choice', '["Frequently","Sometimes","Never"]'::jsonb),
    (36, 'Is stock tracking difficult?', 'yes_no', null),
    (37, 'Struggles with employee management?', 'yes_no', null),
    (38, 'Difficult to generate business reports?', 'yes_no', null),
    (39, 'Difficult to track multiple outlets?', 'single_choice', '["Yes","No","Not applicable"]'::jsonb),
    (40, 'Loses sales due to unavailable stock?', 'yes_no', null),
    (41, 'Is existing software difficult to use?', 'single_choice', '["Yes","No","Not applicable"]'::jsonb),
    (42, 'What is the one problem you wish technology could solve immediately?', 'text', null),
    -- 5. product interest
    (43, 'AUZslab products of interest', 'multiple_choice', '["Retail / Fashion Billing POS","Grocery / General Store POS","Restaurant POS","Salon Management Software","Inventory Management","Website-integrated POS","Multi-branch Management","Accounting & Business Reports","Employee Management","Custom Business Software"]'::jsonb),
    (44, 'Which features matter most to them?', 'text', null),
    (45, 'Needs customization?', 'yes_no', null),
    (46, 'Needs website integration?', 'yes_no', null),
    (47, 'Needs cloud access?', 'yes_no', null),
    (48, 'Needs mobile access?', 'yes_no', null),
    (49, 'Needs data migration from existing software?', 'yes_no', null),
    -- 6. budget and purchasing capacity
    (50, 'Expected budget', 'single_choice', '["Under Rs 500/mo","Rs 500-1,000/mo","Rs 1,000-2,500/mo","Rs 2,500+/mo","Custom"]'::jsonb),
    (51, 'Preferred payment', 'single_choice', '["Monthly","Annual","One-time"]'::jsonb),
    (52, 'Purchase readiness', 'single_choice', '["Immediate","Within 30 days","Within 3 months","Just exploring"]'::jsonb),
    (53, 'Decision maker', 'single_choice', '["Owner","Manager","Accountant","Other"]'::jsonb),
    (54, 'Purchase approval required?', 'yes_no', null),
    (55, 'Competitor quotation (if shared)', 'text', null),
    -- 7. competitor intelligence
    (56, 'Competitor software name', 'text', null),
    (57, 'Competitor approximate pricing', 'text', null),
    (58, 'What features does the competitor provide?', 'text', null),
    (59, 'What does the customer dislike about the competitor?', 'text', null),
    (60, 'What does the customer like about the competitor?', 'text', null),
    (61, 'Why would they consider switching?', 'text', null),
    (62, 'Any offers the competitor is currently running?', 'text', null);

  insert into sos_survey_questions (template_id, label, kind, options, sort_order, required)
  select v_id, t.label, t.kind, t.options, n + t.ord - 1, false
  from _sos_q_tmp t
  where not exists (select 1 from sos_survey_questions q where q.template_id = v_id and q.label = t.label)
  order by t.ord;
end $$;
