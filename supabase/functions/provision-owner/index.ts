import { createClient } from "npm:@supabase/supabase-js@2";

// Creates the new client's first login (owner role), tagged with the
// tenant_id the on_signup() trigger reads from app_metadata. Needs the
// Admin Auth API (service role), which is why this is an Edge Function
// and not a plain Postgres RPC like provision_tenant.
//
// NOTE: verify createUser()'s option names against the current
// supabase-js Admin API docs before relying on this in production —
// the shape below (app_metadata as a top-level createUser option) is
// the well-documented, stable path; avoid inviteUserByEmail's `data`
// option here since that maps to user_metadata, not app_metadata, and
// on_signup() specifically reads raw_app_meta_data.

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function randomPassword(): string {
  return crypto.randomUUID() + crypto.randomUUID();
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    return new Response("unauthorized", { status: 401 });
  }

  // who is calling this, and are they an AUZlabs platform admin?
  const { data: caller, error: callerErr } = await supabaseAdmin.auth.getUser(token);
  if (callerErr || !caller?.user) {
    return new Response("unauthorized", { status: 401 });
  }
  const { data: adminRow } = await supabaseAdmin
    .from("platform_admins")
    .select("id")
    .eq("id", caller.user.id)
    .maybeSingle();
  if (!adminRow) {
    return new Response("forbidden — not a platform admin", { status: 403 });
  }

  let body: { tenant_id?: string; email?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!body.tenant_id || !body.email) {
    return new Response("tenant_id and email are required", { status: 400 });
  }

  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: body.email,
    password: randomPassword(),
    email_confirm: true,
    app_metadata: { tenant_id: body.tenant_id, role: "owner" },
    user_metadata: { name: body.name || "" },
  });
  if (createErr || !created?.user) {
    return new Response(JSON.stringify({ error: createErr?.message || "user creation failed" }), { status: 500 });
  }

  // a recovery link lets the new owner set their own password — avoids
  // depending on transactional email deliverability being configured;
  // share this link with them directly (e.g. over WhatsApp).
  const { data: link, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email: body.email,
  });
  if (linkErr) {
    return new Response(JSON.stringify({ error: linkErr.message }), { status: 500 });
  }

  return new Response(JSON.stringify({
    user_id: created.user.id,
    action_link: link.properties?.action_link,
  }), { headers: { "Content-Type": "application/json" } });
});
