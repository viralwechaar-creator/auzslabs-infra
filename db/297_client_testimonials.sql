-- Client testimonials: a client submits their own feedback from account.html (owner/manager only),
-- an AUZslab admin reviews and approves it (never auto-published -- a client-written paragraph could
-- have a typo, a complaint, or something they didn't mean to make public), and only approved ones
-- show on the homepage's testimonials strip. One real table, not records -- this spans every tenant
-- and the marketing site, neither of which the records engine (per-tenant, app-facing) is for.

create table testimonials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  quote text not null,
  rating int check (rating between 1 and 5),
  author_name text,            -- defaults to the submitter's own name if left blank
  show_business boolean not null default true,   -- off = quote shown without the business name
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  display_text text,           -- admin's lightly-edited version shown publicly (typos, length); null = use quote as-is
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth_users(id)
);
create index testimonials_tenant_idx on testimonials(tenant_id, submitted_at desc);
create index testimonials_status_idx on testimonials(status) where status = 'approved';
alter table testimonials enable row level security;
-- No policies: every access goes through a function below (app role has no grant either -- see db/999).

-- An owner/manager can submit one at a time -- re-submitting while pending replaces the pending draft
-- rather than piling up duplicates; re-submitting after approval/rejection starts a fresh review.
create or replace function submit_my_testimonial(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; role_ text; existing_id uuid; nm text;
begin
  role_ := me()->>'role'; tid := (me()->>'tenant_id')::uuid;
  if tid is null or role_ not in ('owner', 'manager') then raise exception 'owner or manager only'; end if;
  if coalesce(trim(p->>'quote'), '') = '' then raise exception 'write something first'; end if;
  if length(p->>'quote') > 600 then raise exception 'keep it under 600 characters'; end if;
  select id into existing_id from testimonials where tenant_id = tid and status = 'pending' order by submitted_at desc limit 1;
  select name into nm from profiles where id = app_uid();
  if existing_id is not null then
    update testimonials set quote = p->>'quote', rating = nullif(p->>'rating','')::int, author_name = coalesce(nullif(p->>'authorName',''), nm),
      show_business = coalesce((p->>'showBusiness')::boolean, true), submitted_at = now() where id = existing_id;
  else
    insert into testimonials (tenant_id, quote, rating, author_name, show_business)
    values (tid, p->>'quote', nullif(p->>'rating','')::int, coalesce(nullif(p->>'authorName',''), nm), coalesce((p->>'showBusiness')::boolean, true));
  end if;
  return my_testimonial();
end $$;

-- account.html: shows the owner/manager their own tenant's latest submission and its status.
create or replace function my_testimonial() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_build_object('id', id, 'quote', quote, 'rating', rating, 'authorName', author_name, 'showBusiness', show_business,
    'status', status, 'submittedAt', submitted_at), 'null'::jsonb)
  from testimonials where tenant_id = (me()->>'tenant_id')::uuid order by submitted_at desc limit 1
$$;

create or replace function admin_list_testimonials(p_status text default null) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'quote', t.quote, 'rating', t.rating, 'authorName', t.author_name,
    'showBusiness', t.show_business, 'status', t.status, 'displayText', t.display_text, 'submittedAt', t.submitted_at,
    'businessName', tn.name, 'businessSlug', tn.slug) order by t.submitted_at desc)
    from testimonials t join tenants tn on tn.id = t.tenant_id
    where p_status is null or t.status = p_status), '[]'::jsonb);
end $$;

-- p_display_text: the admin's own lightly-cleaned-up wording to show publicly (optional -- null keeps the
-- client's own words as-is). Only ever called with p_decision='approved'/'rejected', never back to 'pending'.
create or replace function admin_review_testimonial(p_id uuid, p_decision text, p_display_text text default null) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid decision'; end if;
  update testimonials set status = p_decision, display_text = nullif(trim(coalesce(p_display_text, '')), ''),
    reviewed_at = now(), reviewed_by = app_uid() where id = p_id;
  if not found then raise exception 'not found'; end if;
  return (select jsonb_build_object('id', id, 'status', status) from testimonials where id = p_id);
end $$;

-- Public, anon-callable: the homepage's testimonials strip. show_business=false hides the business name
-- (the quote and star rating still show) -- a client can share feedback without advertising who they are.
create or replace function public_testimonials() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_agg(jsonb_build_object('quote', coalesce(t.display_text, t.quote), 'rating', t.rating, 'authorName', t.author_name,
    'businessName', case when t.show_business then tn.name else null end, 'niche', case when t.show_business then tn.niche else null end)
    order by t.reviewed_at desc)
    from testimonials t join tenants tn on tn.id = t.tenant_id
    where t.status = 'approved'), '[]'::jsonb)
$$;

-- Rollback: drop function public_testimonials(); drop function admin_review_testimonial(uuid,text,text);
-- drop function admin_list_testimonials(text); drop function my_testimonial(); drop function submit_my_testimonial(jsonb);
-- drop table testimonials;
