import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const root = process.cwd();
const nativeRequire = createRequire(import.meta.url);
const cache = new Map();
let launcherMocks = null;
function load(file) {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const source = fs.readFileSync(filename, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const localRequire = (id) => {
    if (launcherMocks && Object.hasOwn(launcherMocks,id)) return launcherMocks[id];
    if (!id.startsWith('.') && !id.startsWith('@/')) return nativeRequire(id);
    const target = id.startsWith('@/') ? path.join(root, 'src', id.slice(2)) : path.resolve(path.dirname(filename), id);
    for (const suffix of ['.ts', '.tsx', '/index.ts']) if (fs.existsSync(target + suffix)) return load(target + suffix);
    return nativeRequire(target);
  };
  vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${js}\n})`, { filename })(localRequire, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

const quality = load('src/lib/discovery/self-check.ts').runQualitySelfCheck();
console.log('discovery_self_check', JSON.stringify(quality));
assert.equal(quality.ok, true, JSON.stringify(quality.failures));
const model = load('src/lib/automation/opencode-model-preset.ts');
const nemotron = 'openrouter/nvidia/nemotron-3-super-120b-a12b:free';
const spark = 'opencode/muse-spark-1.2-contributor-free';
const vercel = 'vercel/alibaba/qwen3.8-27b';
const glm53 = 'zai-coding-plan/glm-5.3-flash';
const venice = 'venice/stealth-ox-alpha';
const glm47 = 'zai-coding-plan/glm-4.7';
const expected = { A: [spark,nemotron,vercel,glm53,venice,glm47], B: [nemotron,vercel,glm53,venice,glm47,spark], C: [glm53,glm47,spark,nemotron,vercel,venice], D: [vercel,spark,nemotron,glm53,venice,glm47] };
for (const [preset, chain] of Object.entries(expected)) {
  assert.deepEqual(model.getOpenCodeModelChain(preset), chain);
  for (const id of chain) assert.equal(model.getOpenCodeVariant(id), id === nemotron ? 'high' : undefined);
}
const priorOverride = process.env.FIXUP_OPENCODE_NEMOTRON_MODEL;
try {
  process.env.FIXUP_OPENCODE_NEMOTRON_MODEL = nemotron.replace(':free', '');
  assert.throws(() => model.getOpenCodeModelChain(), /refusing an unverified model/);
} finally {
  if (priorOverride === undefined) delete process.env.FIXUP_OPENCODE_NEMOTRON_MODEL;
  else process.env.FIXUP_OPENCODE_NEMOTRON_MODEL = priorOverride;
}
for (const file of ['opencode-launcher.ts','opencode-dm-launcher.ts','opencode-dm-sync-launcher.ts']) {
  const source = fs.readFileSync(path.join(root,'src/lib/automation',file),'utf8');
  assert.match(source, /getOpenCodeModelChain\(\)/);
  assert.match(source, /getOpenCodeVariantArgsScript\(/);
  assert.match(source, /--agent [^;\n]+ @VariantArgs/);
}
const plan = load('src/lib/discovery/query-plan.ts');
for (const provider of ['serper', 'serpapi']) for (let run = 81; run <= 86; run++) {
  const families = plan.getGoogleQueryFamilyPlan('beauty',run,provider);
  assert.deepEqual(new Set(families.slice(0,3).map(f=>f.name)),new Set(['repeat-travel','resident-workstudy','resident-lifestyle']));
  for (const family of families.slice(0,3)) for (const query of family.queries) {
    assert.match(query, /-inurl:\/p\//);
    assert.match(query, /-inurl:\/reels\//);
    assert.doesNotMatch(query,/seo_re_ri|kimtsumu|mai_mai_1114kim|ai0314na|yooooopy918|naginchu1218/);
  }
}
assert.match(fs.readFileSync(path.join(root,'src/components/discovery-console.tsx'),'utf8'), /B: "Nemotron 우선"/);
console.log('Nemotron A/B/C/D, isolated high args, paid override guard, launchers, access families: PASS');
const wrapperSource = fs.readFileSync(path.join(root,'scripts/fixup-opencode-wrapper.ps1'),'utf8');
assert.doesNotMatch(wrapperSource, /Add-Member -NotePropertyName ['"]small_model['"]/);
assert.match(wrapperSource, /TitleAgent[\s\S]{0,240}NotePropertyName ['"]disable['"][\s\S]{0,80}\$true/);
assert.match(wrapperSource, /free-models-per-day/);
const automationLauncherSource = fs.readFileSync(path.join(root,'src/lib/automation/opencode-launcher.ts'),'utf8');
assert.match(automationLauncherSource, /AttemptFailures/);
assert.match(automationLauncherSource, /fallback 전체 실패/);
assert.match(automationLauncherSource, /OpenRouter 무료 모델 일일 요청 한도 소진/);
const runtimeSource = fs.readFileSync(path.join(root,'src/lib/automation/opencode-runtime.ts'),'utf8');
assert.match(runtimeSource, /getOpenCodeFailureTrace/);
assert.match(fs.readFileSync(path.join(root,'src/app/api/automation/run/route.ts'),'utf8'), /getOpenCodeFailureTrace/);
assert.match(fs.readFileSync(path.join(root,'src/app/api/automation/history/route.ts'),'utf8'), /getOpenCodeFailureTrace/);
console.log('FixUp wrapper title-call suppression, OpenRouter daily-cap, and full failure-history trace: PASS');

const assessment = load('src/lib/discovery/discovery-quality.ts');
const brandText = '韓国薬局コスメ・再生クリーム。医者×薬剤師共同開発。8/23限定 メガ割を待つより今日がお得';
assert.equal(assessment.assessDiscoveryCandidate({handle:'product_brand_fixture',evidenceKind:'profile',title:'',text:brandText,profileText:brandText,category:'beauty',accountAvailability:'unknown'}),null);
const files = new Map();
launcherMocks = {
  'node:child_process': { spawnSync: () => ({ status:0,stdout:'12345',stderr:'' }) },
  'node:fs/promises': {
    mkdir: async()=>{}, rm: async()=>{},
    writeFile: async(p,text)=>{files.set(p,String(text));},
    readFile: async(p)=>p.endsWith('.invoked')?'invoked':'',
    open: async()=>({writeFile:async()=>{},close:async()=>{}}),
    stat: async()=>{throw new Error('fixture missing lock');},
  },
  '@/lib/dm/opencode-prompt': {
    validateDmBatchInputs: x=>x, serializeDmBatchInputPayload: x=>JSON.stringify(x), buildDmBatchInputPrompt: ()=>'fixture',
  },
  '@/lib/dm/sync-prompt': {
    validateDmSentSyncInputs: x=>x, buildDmSentSyncPrompt: ()=>'fixture',
  },
};
await load('src/lib/automation/opencode-launcher.ts').launchOpenCodeJob({prompt:'fixture',jobId:'qa-nemotron-duplicate',title:'fixture',mode:'duplicate'});
await load('src/lib/automation/opencode-launcher.ts').launchOpenCodeJob({prompt:'fixture',jobId:'qa-nemotron-verification',title:'fixture',mode:'verification'});
await load('src/lib/automation/opencode-dm-launcher.ts').launchOpenCodeDmBatch([{contactId:'11111111-1111-4111-8111-111111111111',handle:'fixture',approvedJapaneseText:'fixture'}]);
await load('src/lib/automation/opencode-dm-sync-launcher.ts').launchOpenCodeDmSentSyncBatch('beauty',[{handle:'fixture'}]);
launcherMocks = null;
const scriptFiles = [...files.entries()].filter(([p])=>p.endsWith('.ps1')&&!p.endsWith('.watch.ps1'));
assert.equal(scriptFiles.length,4);
const cp = nativeRequire('node:child_process');
const generatedScripts = scriptFiles.map(([,script])=>script);
for (const agent of ['fixup-duplicate','fixup-verification','fixup-dm','fixup-dm-sync']) assert.ok(generatedScripts.some((script)=>script.includes(agent)), agent+' generated launcher missing');
for (const script of generatedScripts) { assert.match(script, /openrouter\/nvidia\/nemotron-3-super-120b-a12b:free/); assert.doesNotMatch(script, /inclusionai\/ling/); assert.ok(!script.includes('FIXUP_OPENCODE_'+'LING_MODEL')); assert.match(script, /--variant/); assert.match(script, /high/); }
for (const [filename,script] of scriptFiles) {
  // Parse the actual generated launchers, without executing any browser/job commands.
  const fixturePath = path.join(process.env.TEMP || root, `fixup-generated-${Math.random().toString(16).slice(2)}.ps1`);
  fs.writeFileSync(fixturePath, script, 'utf8');
  const parserHelper = path.join(root,'scripts','fixup-parse-powershell-fixture.ps1');
  const parse = cp.spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',parserHelper,'-ScriptPath',fixturePath],{encoding:'utf8',windowsHide:true});
  fs.rmSync(fixturePath,{force:true});
  assert.equal(parse.status,0,filename+': '+(parse.error?.message || '')+' '+parse.stdout+' '+parse.stderr);
}
for (const id of expected.A) {
  for (const variable of ['$Model','$env:FIXUP_SCOUT_MODEL']) {
    const command = variable+'="'+id+'"; '+model.getOpenCodeVariantArgsScript(variable)+'; ConvertTo-Json -InputObject @($VariantArgs) -Compress';
    const run=cp.spawnSync('powershell.exe',['-NoProfile','-Command',command],{encoding:'utf8',windowsHide:true});
    assert.equal(run.status,0,run.stderr);
    assert.deepEqual(JSON.parse(run.stdout.trim()), id===nemotron?['--variant','high']:[]);
  }
}
console.log('Brand guard, all four generated PowerShell parsers and real variant argument arrays: PASS (no browsers/jobs launched)');
