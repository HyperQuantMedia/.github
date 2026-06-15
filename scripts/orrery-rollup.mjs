// Copyright (C) 2026 HyperQuant Media L.L.P. All rights reserved. Licensed under GNU GPL v3.0.
'use strict';

// Orrery — Ecosystem Roadmap rollup.
// Reads each per-project repo (issue counts) + that project's own GitHub board
// (Status breakdown), then writes health fields onto the matching Orrery item:
//   Progress %, Open, Done, Last synced, State.
// HYBRID source: Progress/State prefer board completion when a board exists,
// and fall back to issue completion when it does not (e.g. external repos).
// State == "Blocked" is treated as a manual override and never overwritten.
// Field + option IDs are resolved by NAME at runtime, so recreating a field
// on the board does not break this script.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, 'orrery-config.json'), 'utf8'));

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) {
  console.error('FATAL: GH_TOKEN env var not set (needs repo + project scope).');
  process.exit(1);
}

const API = 'https://api.github.com/graphql';
const today = new Date().toISOString().slice(0, 10);

async function gql(query, variables = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'orrery-rollup',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// --- 1. Resolve the Orrery project: its id, field ids, and State option ids ---
async function resolveProject() {
  const data = await gql(
    `query($org:String!,$num:Int!){
      organization(login:$org){
        projectV2(number:$num){
          id
          fields(first:50){ nodes{
            __typename
            ... on ProjectV2FieldCommon { id name }
            ... on ProjectV2SingleSelectField { id name options{ id name } }
          }}
        }
      }
    }`,
    { org: cfg.org, num: cfg.projectNumber },
  );
  const p = data.organization.projectV2;
  const byName = Object.fromEntries(p.fields.nodes.map((f) => [f.name, f]));
  const need = (k) => {
    const f = byName[cfg.fieldNames[k]];
    if (!f) throw new Error(`Field not found on Orrery: ${cfg.fieldNames[k]}`);
    return f;
  };
  const stateField = need('state');
  const stateOpt = Object.fromEntries(stateField.options.map((o) => [o.name, o.id]));
  return {
    projectId: p.id,
    fields: {
      project: need('project').id,
      progress: need('progress').id,
      open: need('open').id,
      done: need('done').id,
      lastSynced: need('lastSynced').id,
      state: stateField.id,
    },
    stateOpt,
  };
}

// --- 2. All Orrery items + their Project / State single-select names ---
async function fetchItems(projectId) {
  const out = [];
  let cursor = null;
  do {
    const data = await gql(
      `query($id:ID!,$c:String){ node(id:$id){ ... on ProjectV2 {
        items(first:100, after:$c){
          pageInfo{ hasNextPage endCursor }
          nodes{
            id
            project: fieldValueByName(name:"Project"){ ... on ProjectV2ItemFieldSingleSelectValue { name } }
            state:   fieldValueByName(name:"State"){   ... on ProjectV2ItemFieldSingleSelectValue { name } }
          }
        }
      }}}`,
      { id: projectId, c: cursor },
    );
    const conn = data.node.items;
    for (const n of conn.nodes) {
      out.push({ id: n.id, project: n.project?.name ?? null, state: n.state?.name ?? null });
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

// --- 3a. Issue counts for a repo (open / closed) ---
async function issueCounts(repo) {
  const [owner, name] = repo.split('/');
  const data = await gql(
    `query($o:String!,$n:String!){ repository(owner:$o,name:$n){
      open: issues(states:OPEN){ totalCount }
      closed: issues(states:CLOSED){ totalCount }
    }}`,
    { o: owner, n: name },
  );
  const r = data.repository;
  return { open: r.open.totalCount, closed: r.closed.totalCount };
}

// --- 3b. Per-project board Status breakdown (Todo / In Progress / Done / ...) ---
async function boardStatus(boardNumber) {
  const tally = {};
  let total = 0;
  let cursor = null;
  do {
    const data = await gql(
      `query($org:String!,$num:Int!,$c:String){ organization(login:$org){ projectV2(number:$num){
        items(first:100, after:$c){
          pageInfo{ hasNextPage endCursor }
          nodes{ status: fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } } }
        }
      }}}`,
      { org: cfg.org, num: boardNumber, c: cursor },
    );
    const conn = data.organization.projectV2.items;
    for (const n of conn.nodes) {
      const s = n.status?.name ?? 'No status';
      tally[s] = (tally[s] ?? 0) + 1;
      total += 1;
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);
  return { tally, total };
}

const isDone = (s) => /done|shipped|complete|closed/i.test(s);
const isActive = (s) => /progress|review|doing|active|blocked/i.test(s);

// --- 4. Field writers ---
async function setNumber(P, itemId, fieldId, number) {
  await gql(
    `mutation($p:ID!,$i:ID!,$f:ID!,$v:Float!){ updateProjectV2ItemFieldValue(input:{
      projectId:$p,itemId:$i,fieldId:$f,value:{number:$v}}){ projectV2Item{ id } } }`,
    { p: P.projectId, i: itemId, f: fieldId, v: number },
  );
}
async function setDate(P, itemId, fieldId, date) {
  await gql(
    `mutation($p:ID!,$i:ID!,$f:ID!,$v:Date!){ updateProjectV2ItemFieldValue(input:{
      projectId:$p,itemId:$i,fieldId:$f,value:{date:$v}}){ projectV2Item{ id } } }`,
    { p: P.projectId, i: itemId, f: fieldId, v: date },
  );
}
async function setSelect(P, itemId, fieldId, optionId) {
  await gql(
    `mutation($p:ID!,$i:ID!,$f:ID!,$v:String!){ updateProjectV2ItemFieldValue(input:{
      projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$v}}){ projectV2Item{ id } } }`,
    { p: P.projectId, i: itemId, f: fieldId, v: optionId },
  );
}

async function main() {
  const P = await resolveProject();
  const items = await fetchItems(P.projectId);
  let synced = 0;

  for (const item of items) {
    const conf = item.project && cfg.projects[item.project];
    if (!conf) continue; // Cross-cutting / unmapped -> left manual

    let open = 0, done = 0, progress = 0;
    let boardActive = false, boardComplete = false, haveBoard = false;
    let note = '';

    try {
      const ic = await issueCounts(conf.repo);
      open = ic.open;
      done = ic.closed;
    } catch (e) {
      note += ` issues:ERR(${String(e).slice(0, 60)})`;
    }

    if (conf.board) {
      try {
        const { tally, total } = await boardStatus(conf.board);
        if (total > 0) {
          haveBoard = true;
          const doneN = Object.entries(tally).filter(([k]) => isDone(k)).reduce((a, [, v]) => a + v, 0);
          const activeN = Object.entries(tally).filter(([k]) => isActive(k)).reduce((a, [, v]) => a + v, 0);
          progress = Math.round((doneN / total) * 100);
          boardComplete = doneN === total;
          boardActive = activeN > 0 || doneN > 0;
          note += ` board:${doneN}/${total}`;
        }
      } catch (e) {
        note += ` board:ERR(${String(e).slice(0, 60)})`;
      }
    }

    // Fall back to issue completion when no usable board.
    if (!haveBoard) {
      const tot = open + done;
      progress = tot > 0 ? Math.round((done / tot) * 100) : 0;
    }

    // Derive State (never clobber a manual "Blocked").
    let stateName = item.state;
    if (item.state !== 'Blocked') {
      if (haveBoard) {
        stateName = boardComplete ? 'Shipped' : boardActive ? 'In Progress' : 'Planned';
      } else {
        stateName = open === 0 && done > 0 ? 'Shipped' : done > 0 ? 'In Progress' : 'Planned';
      }
    }

    await setNumber(P, item.id, P.fields.open, open);
    await setNumber(P, item.id, P.fields.done, done);
    await setNumber(P, item.id, P.fields.progress, progress);
    await setDate(P, item.id, P.fields.lastSynced, today);
    if (stateName && P.stateOpt[stateName]) {
      await setSelect(P, item.id, P.fields.state, P.stateOpt[stateName]);
    }

    synced += 1;
    console.log(`✓ ${item.project}: open=${open} done=${done} ${progress}% -> ${stateName}${note}`);
  }

  console.log(`\nOrrery rollup complete: ${synced} project(s) synced @ ${today}.`);
}

main().catch((e) => {
  console.error('Rollup failed:', e);
  process.exit(1);
});
