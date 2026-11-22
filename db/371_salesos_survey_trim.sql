-- AUZslab SalesOS: the business survey grew to 8 sections / 70+ optional questions (db/368, db/370) --
-- owner feedback: ask only what actually matters for a sales lead, not an exhaustive intake form.
-- Trims the "Business visit survey" template down to 4 sections / 13 questions: who they are (niche),
-- their current software/workflow, competitor intelligence, and the one required closing question.
-- Everything else from db/368 is removed from this template. Idempotent (safe to re-run): only ever
-- deletes by exact label match, never touches a differently-named template or a business's own past
-- sos_survey_responses (those keep whatever answers were already recorded).
do $$
declare tid uuid; v_id uuid;
begin
  select id into tid from tenants where slug = 'auzslab-internal';
  if tid is null then return; end if;
  select id into v_id from sos_survey_templates where tenant_id = tid and name = 'Business visit survey';
  if v_id is null then return; end if;

  delete from sos_survey_questions where template_id = v_id and label not in (
    'Business name', 'Business type / niche', 'Who did you speak to?', 'Owner''s mobile number', 'Business email',
    'Do they already use any billing/POS/CRM software?', 'Which software do they use?', 'Biggest daily operational problem',
    'What is the one problem you wish technology could solve immediately?',
    'Competitor software name', 'What does the customer dislike about the competitor?', 'Why would they consider switching?',
    'Their response to our visit'
  );

  update sos_survey_questions set section = 'Business information' where template_id = v_id and label in
    ('Business name', 'Business type / niche', 'Who did you speak to?', 'Owner''s mobile number', 'Business email');
  update sos_survey_questions set section = 'Current software & workflow' where template_id = v_id and label in
    ('Do they already use any billing/POS/CRM software?', 'Which software do they use?', 'Biggest daily operational problem',
     'What is the one problem you wish technology could solve immediately?');
  update sos_survey_questions set section = 'Competitor intelligence' where template_id = v_id and label in
    ('Competitor software name', 'What does the customer dislike about the competitor?', 'Why would they consider switching?');
  update sos_survey_questions set section = 'Visit outcome' where template_id = v_id and label = 'Their response to our visit';
end $$;
