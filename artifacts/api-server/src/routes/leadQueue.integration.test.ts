import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import type { LeadQueueResult } from "@workspace/api-zod";

test("Lead queue enforces roles, isolation, atomic claims, lifecycle and safe backfill", {
  skip: process.env.RUN_INBOUND_INTEGRATION !== "1",
}, async () => {
  assert.equal(process.env.NODE_ENV, "test");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "helium");
  assert.equal(url.pathname, "/heliumdb");
  const {pool} = await import("@workspace/db");
  const {ensureInboundLeadSchema} = await import("../lib/inboundLeadSchema");
  const {ensureWindowSessionSchema} = await import("../lib/windowSessionSchema");
  const {createWindowSession} = await import("../services/windowSessions");
  await ensureInboundLeadSchema();
  await ensureWindowSessionSchema();
  const org = randomUUID(), otherOrg = randomUUID();
  const roles = ["owner", "admin", "manager", "user", "viewer"] as const;
  const ids = roles.map(() => randomUUID());
  const outsider = randomUUID();
  const allUsers = [...ids, outsider];
  const tokens: string[] = [];
  const {default: app} = await import("../app");
  const server = createServer(app);
  const radar = {
    external_id: randomUUID(), lead_type: "cyber", company_name: "Queue Synthetic",
    website: "https://www.queue-synthetic.invalid", city: "Austin",
    contact_name: "Queue Contact", contact_email: "queue@synthetic.invalid",
    source: "synthetic", signal_summary: "Synthetic security signal", score: 9,
    talking_points: ["Test question"], detected_at: "2026-11-18T12:00:00Z",
    suggested_offer: "Assessment", source_url: "https://synthetic.invalid/source",
  };
  let base = "";
  const request = async (actor: number, suffix = "", body?: object, tenant = org, root = "lead-queue") => {
    const response = await fetch(`${base}/api/orgs/${tenant}/${root}${suffix}`, {
      method: body ? "POST" : "GET",
      headers: {"x-aegis-window-session": tokens[actor], "content-type": "application/json"},
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
    const data = await response.json() as LeadQueueResult & {error: string};
    return {status: response.status, data};
  };
  const newLead = async (patch: Record<string,unknown> = {}, leadStatus = "queued", assigned: string | null = null) => {
    const id = randomUUID();
    await pool.query(`INSERT INTO leads (id,org_id,first_name,last_name,company,status,assigned_to_user_id,source,score,metadata)
      VALUES ($1,$2,'Queue','Contact',$3,$4,$5,'Lead Radar',9,$6)`,
    [id, org, patch.company_name ?? radar.company_name, leadStatus, assigned,
      JSON.stringify({leadRadar: {...radar, external_id: id, ...patch, note: "Synthetic note"},
        ...(leadStatus === "queued" ? {leadQueue: {queuedAt: new Date().toISOString()}} : {})})]);
    return id;
  };
  try {
    for (const id of [org, otherOrg]) await pool.query(
      "INSERT INTO organizations (id,name,slug,plan,enabled_features) VALUES ($1,'Queue test',$2,'professional',ARRAY['crm','sales'])",
      [id, `queue-${id}`]);
    for (let i=0; i<allUsers.length; i++) {
      await pool.query("INSERT INTO users (id,clerk_id,email,full_name) VALUES ($1,$2,$3,$4)",
        [allUsers[i], `queue:${allUsers[i]}`, `${allUsers[i]}@synthetic.invalid`, `Queue ${roles[i] ?? "outsider"}`]);
      await pool.query("INSERT INTO org_users (org_id,user_id,role,display_name) VALUES ($1,$2,$3,$4)",
        [i === 5 ? otherOrg : org, allUsers[i], roles[i] ?? "user", `Named ${roles[i] ?? "outsider"}`]);
      tokens.push((await createWindowSession(allUsers[i])).token);
    }
    await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}`;
    const race = await newLead();
    for (let actor=0; actor<5; actor++) {
      const list = await request(actor);
      assert.equal(list.status,200);
      assert.ok(list.data.items.some((l: {id:string}) => l.id === race));
      assert.equal(list.data.canManage,actor < 3);
      assert.equal((await request(actor,"?status=dismissed")).status,200);
    }
    assert.equal((await request(5)).status,403);
    assert.equal((await request(3,"",undefined,otherOrg)).status,403);
    assert.equal((await request(3,`/${race}/actions`,{action:"assign",assigneeId:ids[0]})).status,403);
    assert.equal((await request(4,`/${race}/actions`,{action:"assign",assigneeId:ids[0]})).status,403);
    assert.equal((await request(0,`/${race}/actions`,{action:"assign",assigneeId:outsider})).status,400);
    const results = await Promise.all([3,4].map(actor => request(actor,`/${race}/actions`,{action:"claim"})));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    assert.match(results.find(r=>r.status===409)!.data.error,/Already claimed by Named (user|viewer)/);
    assert.ok(!(await request(3)).data.items.some((l: {id:string})=>l.id===race));
    let row = (await pool.query("SELECT * FROM leads WHERE id=$1",[race])).rows[0];
    assert.equal(row.status,"working");
    assert.ok([ids[3],ids[4]].includes(row.assigned_to_user_id));
    assert.ok(row.metadata.leadRadar.account_id);
    assert.ok(row.metadata.leadRadar.contact_id);
    assert.equal(row.metadata.leadRadar.suggested_offer,radar.suggested_offer);
    assert.equal((await pool.query("SELECT owner_user_id FROM accounts WHERE id=$1",[row.metadata.leadRadar.account_id])).rows[0].owner_user_id,row.assigned_to_user_id);
    assert.equal((await request(3,"?status=assigned")).status,403);
    assert.ok((await request(0,"?status=assigned")).data.items.find((l:{id:string})=>l.id===race)!.canReturn);
    assert.equal((await request(3,`/${race}/actions`,{action:"return"})).status,403);
    assert.equal((await request(0,`/${race}/actions`,{action:"return"})).status,200);
    assert.equal((await request(0,`/${race}/actions`,{action:"assign",assigneeId:ids[3]})).status,200);
    assert.equal(Number((await pool.query("SELECT count(*) FROM accounts WHERE org_id=$1",[org])).rows[0].count),1);
    assert.equal(Number((await pool.query("SELECT count(*) FROM contacts WHERE org_id=$1",[org])).rows[0].count),1);
    // Work cannot be erased by putting the stage back.
    await pool.query("UPDATE leads SET status='qualified' WHERE id=$1",[race]);
    await pool.query("UPDATE leads SET status='working' WHERE id=$1",[race]);
    assert.equal((await request(0,`/${race}/actions`,{action:"return"})).status,409);
    const dismiss = await newLead();
    assert.equal((await request(4,`/${dismiss}/actions`,{action:"dismiss",reason:"other"})).status,400);
    assert.equal((await request(4,`/${dismiss}/actions`,{action:"dismiss",reason:"existing client"})).status,200);
    const dismissed = (await request(3,"?status=dismissed")).data.items.find((l:{id:string})=>l.id===dismiss)!;
    assert.equal(dismissed.dismissReason,"existing client");
    assert.equal(dismissed.activities[0].action,"dismiss");
    assert.equal((await request(3,`/${dismiss}/actions`,{action:"claim"})).status,409);
    // Domain flag and matching never cross the organization boundary.
    const domainLead = await newLead({company_name:"Different spelling"});
    const flagged = (await request(4)).data.items.find((l:{id:string})=>l.id===domainLead)!;
    assert.equal(flagged.existingAccountName,radar.company_name);
    assert.equal((await request(4,`/${domainLead}/actions`,{action:"claim"})).status,200);
    assert.equal(Number((await pool.query("SELECT count(*) FROM accounts WHERE org_id=$1",[org])).rows[0].count),1);
    // Account activity or tasks prevents returning an otherwise untouched lead.
    row = (await pool.query("SELECT * FROM leads WHERE id=$1",[domainLead])).rows[0];
    await pool.query("INSERT INTO activities (org_id,account_id,type,subject) VALUES ($1,$2,'call','Synthetic work')",
      [org,row.metadata.leadRadar.account_id]);
    assert.equal((await request(0,`/${domainLead}/actions`,{action:"return"})).status,409);
    // Generic writes cannot claim, qualify, delete or edit queue records.
    const protectedLead = await newLead();
    for (const [method,suffix,body] of [
      ["PATCH","",{assignedToUserId:ids[3],status:"working"}],
      ["DELETE","",undefined],["POST","/qualify",{}],
    ] as const) {
      const r = await fetch(`${base}/api/orgs/${org}/leads/${protectedLead}${suffix}`,{
        method,headers:{"x-aegis-window-session":tokens[0],"content-type":"application/json"},
        ...(body ? {body:JSON.stringify(body)}:{}),
      });
      assert.ok([404,409].includes(r.status),`${method} bypass returned ${r.status}`);
    }
    // Viewer exception applies only to exact queue actions, not ordinary writes.
    const viewerEdit = await fetch(`${base}/api/orgs/${org}/leads/${domainLead}`, {
      method:"PATCH",headers:{"x-aegis-window-session":tokens[4],"content-type":"application/json"},
      body:JSON.stringify({company:"Not allowed"}),
    });
    assert.equal(viewerEdit.status,403);
    // Startup backfill is repeatable, preserves linked entities, skips worked/assigned.
    const legacy = await newLead({account_id:row.metadata.leadRadar.account_id,contact_id:row.metadata.leadRadar.contact_id},"new");
    const assigned = await newLead({},"new",ids[3]);
    const worked = await newLead({},"new");
    await pool.query("INSERT INTO audit_events (org_id,entity_type,entity_id,action) VALUES ($1,'lead',$2,'lead.updated')",[org,worked]);
    await ensureInboundLeadSchema(); await ensureInboundLeadSchema();
    assert.equal((await pool.query("SELECT status FROM leads WHERE id=$1",[legacy])).rows[0].status,"queued");
    assert.equal((await pool.query("SELECT status FROM leads WHERE id=$1",[assigned])).rows[0].status,"new");
    assert.equal((await pool.query("SELECT status FROM leads WHERE id=$1",[worked])).rows[0].status,"new");
    assert.equal((await request(3,`/${legacy}/actions`,{action:"claim"})).status,200);
    assert.equal(Number((await pool.query("SELECT count(*) FROM accounts WHERE org_id=$1",[org])).rows[0].count),1);
    const exactName = await newLead({website:undefined});
    assert.equal((await request(2,`/${exactName}/actions`,{action:"claim"})).status,200);
    assert.equal(Number((await pool.query("SELECT count(*) FROM accounts WHERE org_id=$1",[org])).rows[0].count),1);
    // Qualification keeps the domain-resolved link even under another company spelling.
    assert.equal((await request(0,`/${domainLead}/qualify`,{},org,"leads")).status,201);
    assert.equal(Number((await pool.query("SELECT count(*) FROM accounts WHERE org_id=$1",[org])).rows[0].count),1);
    // Each role can claim; new domains cannot reuse another tenant's account.
    for (let actor=0; actor<5; actor++) {
      const id = await newLead({company_name:`Role company ${actor}`,website:`https://role-${actor}.synthetic.invalid`});
      assert.equal((await request(actor,`/${id}/actions`,{action:"claim"})).status,200);
    }
    const audit = (await pool.query("SELECT action FROM audit_events WHERE org_id=$1 AND action LIKE 'lead.queue.%'",[org])).rows;
    for (const action of ["claim","assign","return","dismiss"]) assert.ok(audit.some(a=>a.action===`lead.queue.${action}`));
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>(resolve=>server.close(()=>resolve()));
    await pool.query("DELETE FROM organizations WHERE id=ANY($1::uuid[])",[[org,otherOrg]]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[allUsers]);
  }
});
