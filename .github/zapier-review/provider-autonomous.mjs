// Provider-API autonomous reviewer — 0 Zapier tasks.
// Same full-repo review/fix flow as autonomous.mjs, but every model call
// goes directly to OpenAI / Anthropic native API using the user's own key
// (stored in GitHub Secrets). No Zapier SDK, no AICLIAPI, no Zapier tasks.
//
// Model ID format: openai/<model> or anthropic/<model>
//   e.g. openai/gpt-5.6-sol, openai/gpt-5.6-luna, anthropic/claude-fable-5
//
// Required secrets: OPENAI_API_KEY and/or ANTHROPIC_API_KEY
// This script never logs or stores keys.

import {readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {snapshot, hash, applyEdits, encodeEdit, renderParts, pack} from './worker.mjs';
import {callProviderModel, estimateCost} from './provider-api.mjs';
import {issueMode, resolveContext, parseReview} from './autonomous-core.mjs';
import {validateCompactCoverage} from './native-sdk.mjs';
import {repairExclusiveEnd} from './coverage-repair.mjs';
import {planOperations, operationInstructions} from './file-operations.mjs';

process.on('uncaughtExceptionMonitor', () => { process.exitCode = 1; });

const root = '.luna-output';
const jobPath = '.github/zapier-review/cloud-job.json';
mkdirSync(root, {recursive: true});

const input = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).inputs;
const token = process.env.GITHUB_TOKEN;
const repo = 'Glace678/3';
if (!token) throw Error('GitHub job token is missing');

// ---- Provider config ----
const modelId = String(input.model_id || 'openai/gpt-5.6-luna');
const provider = modelId.split('/')[0];
if (!['openai', 'anthropic'].includes(provider)) {
  throw Error(`model_id must start with openai/ or anthropic/, got: ${modelId}`);
}
const apiKeyEnv = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
// API key check deferred until after plan_only exit (plan_only doesn't call the model)
// Token budget: stop if cumulative input+output tokens exceed this (default 100M)
const tokenBudget = Number(input.max_tasks || 100000000);

const gh = async (path, method = 'GET', body) => {
  const r = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'provider-api-autonomous'
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(60000)
  });
  if (r.status === 404 && method === 'GET') return null;
  if (!r.ok) throw Error(`GitHub ${method} ${path.split('?')[0]} returned ${r.status}`);
  return r.status === 204 ? null : r.json();
};

const git = (...args) => execFileSync('git', args, {maxBuffer: 512 * 1024 * 1024}).toString().trim();
const sourceCommit = git('rev-parse', 'HEAD');
const issue = await gh(`/issues/${Number(input.issue_number)}`);

// Validate issue
if (!issue || issue.user?.login !== 'Glace678' || issue.pull_request || issue.state !== 'open') {
  throw Error('Only owner-created, open, non-PR issues are accepted');
}
const mode = issueMode(issue);
const policy = String(input.policy || '完整审核所有文本源码，包括第三方和生成代码；按Issue正文修改；覆盖不全不得声称完成；输出中文报告和草稿PR。');
if (policy.length > 12000) throw Error('Policy too long');

const key = hash(JSON.stringify([issue.number, issue.title, issue.body, modelId, policy]));
const branch = `codex/provider-job-${issue.number}-${key.slice(0, 12)}`;
if (input.job_branch && input.job_branch !== branch) throw Error('Continuation does not match the unchanged Issue/configuration');

let state, contentSha;
const saved = await gh(`/contents/${jobPath}?ref=${encodeURIComponent(branch)}`);
if (saved) {
  contentSha = saved.sha;
  if (saved.content) state = JSON.parse(Buffer.from(saved.content, 'base64').toString());
  else {
    const head = await gh(`/git/ref/heads/${branch}`);
    const r = await fetch(`https://raw.githubusercontent.com/${repo}/${head.object.sha}/${jobPath}`, {redirect: 'error'});
    if (!r.ok) throw Error('Cannot load durable job');
    state = await r.json();
  }
  if (state.sourceCommit !== sourceCommit) throw Error('Resume must check out the original source commit');
  if (state.status === 'completed') {
    console.log(JSON.stringify({status: 'already-completed', pr: state.pr}));
    process.exit(0);
  }
  if (state.halted === 'Requested context does not exist in fixed snapshot') {
    state.migrations = [...(state.migrations || []), {at: new Date().toISOString(), reason: state.halted, oldMode: state.config.mode, newMode: mode}];
    delete state.halted;
    state.status = 'running';
    state.config.mode = mode;
  }
  if (state.halted) throw Error(state.halted);
  if (state.config.mode !== mode) throw Error('Saved job mode differs; explicit migration required');
}

async function save() {
  state.updatedAt = new Date().toISOString();
  const response = await gh(`/contents/${jobPath}`, 'PUT', {
    message: `Provider #${issue.number}: ${state.status}`,
    branch,
    sha: contentSha,
    content: Buffer.from(JSON.stringify(state)).toString('base64')
  });
  contentSha = response.content.sha;
  writeFileSync(`${root}/cloud-job.json`, JSON.stringify(state, null, 2));
}

const raw = async (commit, path) => {
  const r = await fetch(`https://raw.githubusercontent.com/${repo}/${commit}/${path}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(90000)
  });
  if (!r.ok) throw Error(`Source attachment unavailable: HTTP ${r.status}`);
  return r.text();
};

if (!state) {
  const config = {repo, model: modelId, mode, policy, issue: {number: issue.number, title: issue.title, body: issue.body}};
  writeFileSync(`${root}/job-config.json`, JSON.stringify(config));
  execFileSync(process.execPath, ['.github/zapier-review/prepare-full-audit.mjs', '950000', '18'], {
    stdio: 'inherit',
    env: {...process.env, LUNA_JOB_CONFIG: `${root}/job-config.json`},
    maxBuffer: 32 * 1024 * 1024
  });
  const schedule = JSON.parse(readFileSync(`${root}/full-audit/schedule.json`));
  const inventory = JSON.parse(readFileSync(`${root}/full-audit/inventory.json`));
  state = {
    version: 1, key, config, sourceCommit,
    status: 'preparing',
    modelRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    estimatedCostUsd: 0,
    zapierTasks: 0,
    billingBasis: 'Direct provider API (0 Zapier tasks). User pays provider token fees only.',
    queue: [],
    createdAt: new Date().toISOString(),
    textFiles: inventory.inventory.filter(x => x.kind === 'text').length,
    binaryFiles: inventory.inventory.filter(x => x.kind === 'binary').length,
    emptyFiles: inventory.emptyTextFiles
  };
  for (const p of schedule.schedule) {
    const dir = `${root}/validation/${p.id}`;
    const inputs = JSON.parse(readFileSync(`${dir}/pending-inputs.json`));
    const record = {
      id: p.id,
      inputs,
      checks: JSON.parse(readFileSync(`${dir}/expected-transport.json`)),
      fixtures: JSON.parse(readFileSync(`${dir}/expected-quality.json`)),
      sourceHash: p.attachmentSha256,
      depth: 0
    };
    record.inputs.inputFields.source_text = '';
    writeFileSync(`${dir}/cloud-input.json`, JSON.stringify(record));
    state.queue.push({
      id: p.id,
      status: 'queued',
      asset: `.github/zapier-review/cloud-inputs/${p.id}.json`,
      source: `.github/zapier-review/cloud-inputs/${p.id}.md`
    });
  }
  writeFileSync(`${root}/cloud-job.json`, JSON.stringify(state));
  if (input.plan_only === 'true') {
    console.log(JSON.stringify({status: 'plan-only', batches: state.queue.length, textFiles: state.textFiles, modelRequests: 0}));
    process.exit(0);
  }
  // Publish source attachments
  const index = `${process.cwd()}/${root}/cloud-index`;
  if (existsSync(index)) unlinkSync(index);
  const env = {
    ...process.env,
    GIT_INDEX_FILE: index,
    GIT_AUTHOR_NAME: 'Provider API Review',
    GIT_AUTHOR_EMAIL: 'provider@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'Provider API Review',
    GIT_COMMITTER_EMAIL: 'provider@users.noreply.github.com'
  };
  const run = (args, body) => execFileSync('git', args, {env, input: body, maxBuffer: 512 * 1024 * 1024}).toString().trim();
  run(['read-tree', sourceCommit]);
  const add = (path, body) => {
    const blob = run(['hash-object', '-w', '--stdin'], body);
    run(['update-index', '--add', '--cacheinfo', '100644', blob, path]);
  };
  add(jobPath, readFileSync(`${root}/cloud-job.json`));
  for (const q of state.queue) {
    add(q.asset, readFileSync(`${root}/validation/${q.id}/cloud-input.json`));
    add(q.source, readFileSync(`${root}/validation/${q.id}/source.md`));
  }
  const tree = run(['write-tree']);
  const commit = run(['commit-tree', tree, '-p', sourceCommit], `Provider #${issue.number}: complete source inventory and resumable job\n`);
  const pushEnv = {
    ...env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic ' + Buffer.from('x-access-token:' + token).toString('base64')
  };
  execFileSync('git', ['push', '--quiet', 'origin', `${commit}:refs/heads/${branch}`], {env: pushEnv, stdio: ['ignore', 'pipe', 'pipe']});
  unlinkSync(index);
  state.assetCommit = commit;
  state.status = 'running';
  contentSha = (await gh(`/contents/${jobPath}?ref=${encodeURIComponent(branch)}`)).sha;
  await save();
}

if (!state.assetCommit) {
  state.assetCommit = (await gh(`/git/ref/heads/${branch}`)).object.sha;
  state.status = 'running';
  await save();
}

// Token budget guard
function checkTokenBudget() {
  const total = state.totalInputTokens + state.totalOutputTokens;
  if (total > tokenBudget) {
    throw Error(`Token budget exceeded: ${total} > ${tokenBudget}. Stopped to prevent runaway provider costs.`);
  }
}

async function ownerStopGuard() {
  const current = await gh(`/issues/${issue.number}`);
  if (!current || current.state !== 'open') throw Error('Owner closed the Issue; no more model requests will be submitted');
}

async function continueJob() {
  state.status = 'continuing';
  state.continuations = (state.continuations || 0) + 1;
  if (state.continuations > 48) throw Error('Cloud continuation limit exceeded');
  await save();
  await gh('/actions/workflows/provider-review.yml/dispatches', 'POST', {
    ref: 'main',
    inputs: {...input, job_branch: branch, plan_only: 'false'}
  });
  console.log('Saved job continues automatically in the next cloud run.');
  process.exit(0);
}

let files, entryCache;
function treeEntries() {
  if (!entryCache) {
    entryCache = new Map(
      execFileSync('git', ['ls-tree', '-rz', sourceCommit], {maxBuffer: 64 * 1024 * 1024})
        .toString('utf8').split('\0').filter(Boolean).map(line => {
          const at = line.indexOf('\t');
          const [mode, type, oid] = line.slice(0, at).split(' ');
          return [line.slice(at + 1), {mode, type, oid}];
        })
    );
  }
  return entryCache;
}
const readTreeBlob = entry => execFileSync('git', ['cat-file', 'blob', entry.oid], {maxBuffer: 512 * 1024 * 1024});
async function getFiles() {
  if (!files) {
    const s = await snapshot();
    if (s.errors.length) throw Error(s.errors.join('\n'));
    files = s.files;
  }
  return files;
}

async function persistRecoveryInputs(children) {
  if (!children.length) return;
  const head = await gh(`/git/ref/heads/${branch}`);
  const base = await gh(`/git/commits/${head.object.sha}`);
  const tree = [];
  for (const child of children) {
    child.asset = `.github/zapier-review/cloud-inputs/${child.id}.json`;
    const blob = await gh('/git/blobs', 'POST', {
      content: Buffer.from(JSON.stringify(child.inline)).toString('base64'),
      encoding: 'base64'
    });
    tree.push({path: child.asset, mode: '100644', type: 'blob', sha: blob.sha});
  }
  const newTree = await gh('/git/trees', 'POST', {base_tree: base.tree.sha, tree});
  const commit = await gh('/git/commits', 'POST', {
    message: `Provider #${issue.number}: automatic recovery source`,
    tree: newTree.sha,
    parents: [head.object.sha]
  });
  await gh(`/git/refs/heads/${branch}`, 'PATCH', {sha: commit.sha, force: false});
  for (const child of children) {
    child.assetCommit = commit.sha;
    delete child.inline;
  }
}

async function recover(q, batch, reason) {
  if (batch.depth >= 6) throw Error(`Recovery depth exhausted: ${q.id}: ${reason}`);
  const originals = JSON.parse(batch.inputs.inputFields.manifest_json).filter(m => !m.file.startsWith('validation-fixtures/'));
  const map = new Map(await getFiles());
  const parts = [];
  for (const path of new Set([
    ...originals.map(m => m.file),
    ...(JSON.parse(q.raw?.needs_context_json || '{"files":[]}').files || [])
  ])) {
    const entry = treeEntries().get(path);
    if (!map.has(path) && entry?.type === 'blob') {
      const bytes = readTreeBlob(entry);
      map.set(path, {text: bytes.toString('base64'), encoding: 'base64', sha256: hash(bytes)});
    }
  }
  for (const m of originals) {
    const source = map.get(m.file);
    if (!source || source.sha256 !== m.sha256) throw Error('Recovery source changed');
    const text = source.text.slice(m.start_char, m.end_char);
    const span = Math.max(1, Math.floor(120000 / 2 ** batch.depth));
    for (let at = 0; at < text.length;) {
      let end = Math.min(text.length, at + span);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      const segment = text.slice(at, end);
      const {block_ids, ...base} = m;
      parts.push({
        ...base,
        text: segment,
        start_char: m.start_char + at,
        end_char: m.start_char + end,
        start_line: m.start_line + (text.slice(0, at).match(/\n/g) || []).length,
        end_line: m.start_line + (text.slice(0, end).match(/\n/g) || []).length
      });
      at = end;
    }
  }
  const requested = JSON.parse(q.raw?.needs_context_json || '{"files":[]}').files || [];
  const resolved = resolveContext(requested, map);
  q.contextResolutions = resolved.resolutions;
  const context = resolved.files
    .filter(p => !originals.some(m => m.file === p && m.start_char === 0 && m.end_char === map.get(p).text.length))
    .map(file => {
      const f = map.get(file);
      return {
        file, text: f.text, sha256: f.sha256, encoding: f.encoding,
        start_char: 0, end_char: f.text.length,
        start_line: 1, end_line: f.text.split('\n').length
      };
    });
  const contextBytes = context.reduce((n, f) => n + Buffer.byteLength(JSON.stringify(f)), 0);
  if (contextBytes > 400000) throw Error('Requested cross-file context exceeds safe recovery payload');
  const bins = pack(parts, 140000, Math.max(120000, 650000 - contextBytes));
  const children = [];
  for (let n = 0; n < bins.length; n++) {
    const id = `${q.id}-r${n}`;
    const fixtures = batch.fixtures;
    const entries = [
      ...bins[n],
      ...context,
      ...fixtures.map(f => ({
        file: f.file, text: f.text, sha256: hash(f.text), encoding: 'utf-8',
        start_char: 0, end_char: f.text.length,
        start_line: 1, end_line: f.text.split('\n').length
      }))
    ];
    const manifest = entries.map(({text, ...m}) => m);
    const checks = Object.fromEntries(['begin', 'middle', 'end'].map(k => [k, randomBytes(12).toString('hex')]));
    const mid = Math.floor(entries.length / 2);
    const mark = k => `\n[Transport validation ${k}: ${checks[k]}]\n`;
    const source = mark('begin') + renderParts(entries.slice(0, mid)) + mark('middle') + renderParts(entries.slice(mid)) + mark('end');
    // Build provider inputs directly
    const manifestJson = JSON.stringify(manifest);
    const inputs = {
      instructions: batch.inputs.instructions + ` ${policy} Respond in Chinese. Each finding needs a separate exact evidence string. Return transport_checks_json with begin,middle,end markers. The manifest has ${manifest.length} entries; its last inclusive index is ${manifest.length - 1}. Validation fixtures are isolated and must not be patched. Valid JSON only, with escaped embedded quotation marks. Context path resolution: ${JSON.stringify(resolved.resolutions)}. Use only the actual paths provided.`,
      inputFields: {
        mode,
        repo,
        commit_sha: sourceCommit,
        issue_title: issue.title,
        issue_body: issue.body || '',
        manifest_json: manifestJson,
        manifest_sha256: hash(manifestJson),
        source_text: source
      }
    };
    if (Buffer.byteLength(JSON.stringify(inputs)) > 900000) throw Error('Recovery input too large');
    children.push({id, status: 'queued', inline: {id, inputs, checks, fixtures, depth: batch.depth + 1}});
  }
  if (!children.length) throw Error('Empty recovery scope');
  await persistRecoveryInputs(children);
  q.status = 'superseded';
  q.reason = reason;
  q.children = children.map(c => c.id);
  state.queue.push(...children);
  await save();
}

// Validate answer (adapted from autonomous-core.validateAnswer, provider-API version)
function validateAnswerProvider({output, manifest, checks, fixtures, mode}) {
  if (output?.status !== 'completed') throw Error(`Review not complete: ${output?.status}`);
  const ranges = JSON.parse(output.covered_ranges_json);
  let boundaryNormalized = false;
  try { validateCompactCoverage(manifest, ranges); } catch {
    repairExclusiveEnd(manifest, ranges);
    boundaryNormalized = true;
  }
  // Transport checks (may be absent in simple calls; only validate if present)
  if (checks && Object.keys(checks).length) {
    if (!output.transport_checks_json) throw Error('Missing transport_checks_json');
    const transport = JSON.parse(output.transport_checks_json);
    if (!Object.entries(checks).every(([k, v]) => transport[k] === v)) {
      throw Error('Source attachment markers do not match');
    }
  }
  const review = parseReview(output.review_json);
  const patches = JSON.parse(output.patch_json);
  const context = JSON.parse(output.needs_context_json);
  if (!Array.isArray(review.value) || !Array.isArray(patches)) throw Error('Result arrays required');
  if (Object.keys(context).length && (!Array.isArray(context.files) || context.files.length)) {
    throw Error('Missing cross-file context');
  }
  const allowed = new Set(manifest.map(m => m.file));
  for (const f of review.value) {
    if (!f || typeof f.file !== 'string' || !allowed.has(f.file) || typeof f.description !== 'string') {
      throw Error('Finding has an invalid source path or description');
    }
  }
  for (const fixture of fixtures) {
    const found = review.value.find(f =>
      f.file === fixture.file && typeof f.evidence === 'string' &&
      f.evidence.length > 8 && fixture.text.includes(f.evidence)
    );
    if (!found) throw Error(`Control missing or lacks exact evidence: ${fixture.file}`);
    const expected = fixture.category === 'heap overflow' ? /overflow|溢出|越界/
      : fixture.category === 'null dereference' ? /null|空指针|空地址/i
      : /double.?free|twice|二次|两次|重复释放|双重释放/i;
    if (!expected.test(found.description)) throw Error(`Control explanation failed: ${fixture.category}`);
  }
  if (mode === 'review' && patches.length) throw Error('Read-only audit returned edits');
  for (const edit of patches) {
    if ((edit.op !== 'create' && !allowed.has(edit.path)) ||
        edit.path.startsWith('validation-fixtures/') ||
        edit.to?.startsWith('validation-fixtures/')) {
      throw Error('Patch outside supplied source');
    }
  }
  return {
    findings: review.value.filter(f => !f.file.startsWith('validation-fixtures/')),
    patches,
    normalization: {review: review.normalized, coverage: boundaryNormalized}
  };
}

// ---- Main loop ----
if (!process.env[apiKeyEnv]) {
  throw Error(`${apiKeyEnv} is not set. Add it to GitHub Secrets for this repository.`);
}
const started = Date.now();
try {
  checkTokenBudget();
  await save();
  await persistRecoveryInputs(state.queue.filter(q => q.inline));
  await save();

  for (let i = 0; i < state.queue.length; i++) {
    const q = state.queue[i];
    if (['completed', 'superseded'].includes(q.status)) continue;
    if (Date.now() - started > 245 * 60 * 1000) {
      await continueJob();
    }
    const batch = JSON.parse(await raw(q.assetCommit || state.assetCommit, q.asset));
    const manifest = JSON.parse(batch.inputs.inputFields.manifest_json);

    if (q.status === 'starting' && !q.providerResult) {
      throw Error(`Submission is uncertain: ${q.id}; automatic duplicate dispatch is disabled`);
    }

    if (!q.providerResult) {
      batch.inputs.inputFields.mode = mode;
      batch.inputs.instructions = batch.inputs.instructions
        .replace('No new/deleted files, .github edits, or invented contents.', 'Never invent contents.')
        + ' ' + operationInstructions;
      // Add transport checks instruction if checks exist
      if (batch.checks && Object.keys(batch.checks).length) {
        batch.inputs.instructions += ` Return transport_checks_json with begin,middle,end markers matching: ${JSON.stringify(batch.checks)}.`;
      }
      if (state.modelRequests >= 600) throw Error('Unusual model request count: stopped');

      // Load source text inline (provider API supports 1M+ context)
      if (q.source) {
        const source = await raw(state.assetCommit, q.source);
        if (hash(source) !== batch.sourceHash) throw Error('Source hash mismatch');
        batch.inputs.inputFields.source_text = source;
      }

      checkTokenBudget();
      await ownerStopGuard();
      q.status = 'starting';
      state.modelRequests++;
      await save();

      // ---- Direct provider API call (0 Zapier tasks) ----
      console.log(`[provider] Calling ${modelId} for batch ${q.id} (${(JSON.stringify(batch.inputs).length / 1024).toFixed(0)}KB)...`);
      const result = await callProviderModel({
        modelId,
        inputs: batch.inputs,
        timeoutMs: 25 * 60 * 1000
      });

      // Track token usage
      const inputTokens = result.usage?.input_tokens || result.usage?.prompt_tokens || 0;
      const outputTokens = result.usage?.output_tokens || result.usage?.completion_tokens || 0;
      state.totalInputTokens += inputTokens;
      state.totalOutputTokens += outputTokens;
      q.tokens = {input: inputTokens, output: outputTokens};
      q.providerResult = result;
      q.status = 'running';
      await save();
      console.log(`[provider] Batch ${q.id} done: ${inputTokens} in / ${outputTokens} out tokens, status=${result.status}`);
    }

    // Validate answer
    let answer;
    try {
      answer = validateAnswerProvider({
        output: q.providerResult,
        manifest,
        checks: batch.checks,
        fixtures: batch.fixtures,
        mode
      });
    } catch (error) {
      await recover(q, batch, error.message);
      continue;
    }

    q.answer = answer;
    q.manifest = manifest.filter(m => !m.file.startsWith('validation-fixtures/'));
    q.status = 'completed';
    q.reflection = {
      accepted: true,
      findings: q.answer.findings.length,
      normalization: q.answer.normalization,
      zapierTasks: 0,
      basis: 'Direct provider API call. 0 Zapier tasks. Token usage tracked.'
    };
    await save();
  }

  // ---- Aggregate results ----
  const map = await getFiles();
  const spans = new Map();
  const findings = [];
  const edits = [];
  for (const q of state.queue) {
    if (q.status === 'completed') {
      findings.push(...q.answer.findings);
      edits.push(...q.answer.patches);
      for (const m of q.manifest) {
        const values = spans.get(m.file) || [];
        values.push([m.start_char, m.end_char]);
        spans.set(m.file, values);
      }
    }
  }
  const coverage = [];
  for (const [path, file] of map) {
    let next = 0;
    for (const [a, b] of (spans.get(path) || []).sort((x, y) => x[0] - y[0])) {
      if (a > next) throw Error(`Unreviewed source: ${path}:${next}`);
      next = Math.max(next, b);
    }
    if (next !== file.text.length) throw Error(`Unreviewed end of source: ${path}`);
    coverage.push({path, sha256: file.sha256, characters: next, status: file.text.length ? 'reviewed' : 'empty'});
  }
  writeFileSync(`${root}/full-coverage.json`, JSON.stringify(coverage, null, 2));
  writeFileSync(`${root}/findings.json`, JSON.stringify(findings, null, 2));

  const uniqueEdits = [...new Map(edits.map(e => [JSON.stringify(e), e])).values()];
  const changes = planOperations(treeEntries(), map, uniqueEdits, readTreeBlob);
  const base = await gh(`/git/commits/${sourceCommit}`);
  const tree = [];
  for (const [path, change] of changes) {
    if (change === null) {
      tree.push({path, mode: treeEntries().get(path).mode, type: 'blob', sha: null});
      continue;
    }
    const blob = await gh('/git/blobs', 'POST', {content: change.bytes.toString('base64'), encoding: 'base64'});
    tree.push({path, mode: change.mode, type: 'blob', sha: blob.sha});
  }
  writeFileSync(`${root}/file-operations.json`, JSON.stringify(
    [...changes].map(([path, c]) => ({
      path, operation: c === null ? 'delete' : 'write',
      mode: c?.mode, sha256: c ? hash(c.bytes) : null, bytes: c?.bytes.length
    })), null, 2
  ));

  const report = `# 全仓审核报告（Provider API 直连，0 Zapier tasks）\n\n` +
    `基准：${sourceCommit}\n\n` +
    `模型：${modelId}（直连 provider API，非 Zapier 托管）\n\n` +
    `文本文件 ${map.size} 个全部通过覆盖检查；二进制 ${state.binaryFiles} 个仅登记。\n\n` +
    `模型请求 ${state.modelRequests} 次。` +
    `Token 用量：输入 ${state.totalInputTokens.toLocaleString()}，输出 ${state.totalOutputTokens.toLocaleString()}。\n\n` +
    `Zapier tasks：0（全部 AI 调用经 provider 原生 API，不经过 Zapier）。\n\n` +
    `问题记录 ${findings.length} 条；修改文件 ${changes.size} 个。\n\n` +
    `报告中的发现是模型意见；引用匹配和覆盖检查不证明找出了所有缺陷。未执行项目完整构建或运行测试。\n\n` +
    `完整覆盖与原始响应见 Actions artifact 和工作状态分支 ${branch}。\n`;

  const details = findings.map((f, i) =>
    `## ${i + 1}. ${f.file}:${f.line ?? '?'}\n\n${f.severity || ''} ${f.description}\n\n${f.evidence ? '证据：' + JSON.stringify(f.evidence) : '未返回独立证据字段'}\n`
  ).join('\n');

  const reportBlob = await gh('/git/blobs', 'POST', {content: report + '\n' + details, encoding: 'utf-8'});
  tree.push({path: `luna-reviews/issue-${issue.number}.md`, mode: '100644', type: 'blob', sha: reportBlob.sha});
  const newTree = await gh('/git/trees', 'POST', {base_tree: base.tree.sha, tree});
  const commit = await gh('/git/commits', 'POST', {
    message: `Provider API: review full repository and address #${issue.number}`,
    tree: newTree.sha,
    parents: [sourceCommit]
  });
  const fixBranch = `codex/provider-issue-${issue.number}-${key.slice(0, 12)}`;
  const existingRef = await gh(`/git/ref/heads/${fixBranch}`);
  if (!existingRef) await gh('/git/refs', 'POST', {ref: `refs/heads/${fixBranch}`, sha: commit.sha});
  else {
    const previous = await gh(`/git/commits/${existingRef.object.sha}`);
    if (previous.tree.sha !== newTree.sha) throw Error('Existing result branch differs; refusing to overwrite it');
  }
  const existingPR = await gh(`/pulls?head=Glace678:${fixBranch}&state=all`);
  const pr = existingPR?.[0] || await gh('/pulls', 'POST', {
    title: `Provider API 全仓审核：${issue.title}`.slice(0, 240),
    head: fixBranch,
    base: 'main',
    draft: true,
    body: `处理 #${issue.number}。\n\n${report}\n不自动合并。`
  });
  state.pr = pr.html_url;
  state.status = 'completed';
  state.coverageComplete = true;
  state.changedFiles = changes.size;
  state.findings = findings.length;
  await save();

  try {
    await gh(`/issues/${issue.number}/comments`, 'POST', {
      body: `Provider API 整仓流程完成（0 Zapier tasks）：${map.size}个文本文件覆盖已核验，已上传草稿PR：${pr.html_url}\n\n` +
        `模型：${modelId} | Token：输入 ${state.totalInputTokens.toLocaleString()} / 输出 ${state.totalOutputTokens.toLocaleString()}\n\n` +
        `[完整运行与报告](https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID})。二进制仅登记；尚未进行项目完整构建和运行测试。`
    });
  } catch (error) {
    console.warn('PR and complete report were saved; final Issue notification failed: ' + error.message);
  }
  console.log(JSON.stringify({
    status: state.status,
    pr: state.pr,
    textFiles: map.size,
    changedFiles: changes.size,
    modelRequests: state.modelRequests,
    totalInputTokens: state.totalInputTokens,
    totalOutputTokens: state.totalOutputTokens,
    zapierTasks: 0
  }));
} catch (error) {
  process.exitCode = 1;
  state.status = 'stopped';
  state.halted = error.message;
  await save();
  throw error;
}
