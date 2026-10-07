'use strict';
// External isolated harness: production CLI/services and real PostgreSQL, no auth mocks.
const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, lstatSync, rmSync, writeFileSync, chmodSync, symlinkSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Client } = require('pg');
const { ConfigService } = require('@nestjs/config');
const OTPAuth = require('otpauth');
const settings = {DB_HOST:'postgres',DB_PORT:'5432',DB_USERNAME:'capital_e2e',DB_PASSWORD:'capital_e2e',DB_NAME:'capital_tracker_e2e'};
const database='capital_tracker_mfa_db_e2e';
const email='mfa-db@example.invalid';
const password='Synthetic-mfa-database-password-42!';
const origin='https://127.0.0.1:8443';
let stage='isolated setup';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fingerprint=value=>hash(JSON.stringify(value));
function command(script,args=[],input,ok=true,target=database) {
  const result=spawnSync(process.execPath,[`/app/backend/dist/${script}.js`,...args],{
    cwd:'/app/backend',env:{...process.env,...settings,DB_NAME:target},input,encoding:'utf8',timeout:30000});
  assert.equal(result.signal,null,'CLI must not deadlock');
  assert.equal(result.error,undefined,'CLI must finish');
  assert.ok(!(result.stdout+result.stderr).includes(password),'No password output');
  if(ok===null) return result;
  assert.equal(result.status===0,ok,'CLI exit status');
  return result.stdout+result.stderr;
}
async function rejected(promise,status) { await assert.rejects(promise,error=>error.getStatus?.()===status); }
async function enroll(source,userId,target=database) {
  for(let attempt=0;attempt<3;attempt++) {
  let sampledCounter;
  const run=(args,input)=>command('mfa-cli',args,input,true,target);
  const directory=mkdtempSync(join(tmpdir(),'capital-mfa-db-'));
  try {
    const prepared=join(directory,'prepare.json'),confirmed=join(directory,'confirm.json');
    const out=run(['prepare','--user-id',userId,'--output',prepared,'--replace']);
    const candidate=JSON.parse(readFileSync(prepared,'utf8'));
    assert.equal(lstatSync(prepared).mode&0o777,0o600);
    assert.ok(!out.includes(candidate.uri),'URI never printed');
    const totp=OTPAuth.URI.parse(candidate.uri);
    let [{now}]=await source.query('SELECT clock_timestamp() AS now');
    if(new Date(now).getTime()%30000>20000) {
      await source.query('SELECT pg_sleep($1)',[(30000-new Date(now).getTime()%30000+100)/1000]);
      [{now}]=await source.query('SELECT clock_timestamp() AS now');
    }
    sampledCounter=Math.floor(new Date(now).getTime()/30000);
    const code=totp.generate({timestamp:new Date(now).getTime()-30000});
    const adjacent=[0,30000].map(offset=>totp.generate({timestamp:new Date(now).getTime()+offset}));
    if(new Set([code,...adjacent]).size!==3) continue;
    const confirmation=command('mfa-cli',['confirm','--user-id',userId,'--candidate-id',candidate.candidateId,'--output',confirmed,'--code-stdin'],JSON.stringify({code}),null,target);
    const confirmedOutput=confirmation.stdout+confirmation.stderr;
    for(const secret of [candidate.uri,totp.secret.base32,code]) assert.ok(!confirmedOutput.includes(secret),'Confirmation cannot print factor credentials');
    if(confirmation.status!==0) {
      const [{now:afterFailure}]=await source.query('SELECT clock_timestamp() AS now');
      if(attempt<2 && Math.floor(new Date(afterFailure).getTime()/30000)!==sampledCounter) continue;
      assert.equal(confirmation.status,0,'Confirmation failed without an eligible clock-boundary retry');
    }
    const {recoveryCodes}=JSON.parse(readFileSync(confirmed,'utf8'));
    assert.equal(lstatSync(confirmed).mode&0o777,0o600);
    assert.equal(recoveryCodes.length,10); assert.equal(new Set(recoveryCodes).size,10);
    for(const value of recoveryCodes) { assert.match(value,/^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{8}){3}$/); assert.ok(!confirmedOutput.includes(value)); }
    const stored=JSON.stringify(await source.query('SELECT * FROM owner_mfa'))+JSON.stringify(await source.query('SELECT * FROM owner_mfa_recovery'));
    assert.ok(!stored.includes(totp.secret.base32),'No plaintext TOTP secret in DB');
    for(const value of recoveryCodes) assert.ok(!stored.includes(value),'No plaintext recovery code in DB');
    return {totp,recoveryCodes,confirmationCode:code};
  } finally { rmSync(directory,{recursive:true,force:true}); }
  }
  throw new Error('Enrollment boundary retries exhausted');
}
async function verifyCliAndKeys(source,userId,config,sessions,mfa,pending) {
  stage='CLI negative cases';
  const directory=mkdtempSync(join(tmpdir(),'capital-mfa-negative-'));
  const state=async()=>fingerprint([await source.query('SELECT * FROM owner_auth'),await source.query('SELECT * FROM owner_mfa'),await source.query('SELECT * FROM owner_mfa_recovery ORDER BY "codeHash"'),await source.query('SELECT * FROM auth_sessions ORDER BY "tokenHash"')]);
  const active=async()=>fingerprint([await source.query('SELECT "activeVersion","activeEnvelope","lastCounter" FROM owner_mfa'),await source.query('SELECT * FROM owner_mfa_recovery ORDER BY "codeHash"')]);
  const {MfaService}=require('/app/backend/dist/auth/mfa.service.js');
  try {
    await enroll(source,userId);
    const existing=join(directory,'existing'),link=join(directory,'link');
    writeFileSync(existing,'preserved-output',{mode:0o600}); symlinkSync(existing,link);
    for(const output of [existing,link,join(directory,'missing','output')]) {
      const before=await state();
      command('mfa-cli',['prepare','--user-id',userId,'--replace','--output',output],undefined,false);
      assert.equal(await state(),before,'Output refusal cannot mutate enrollment');
      assert.equal(readFileSync(existing,'utf8'),'preserved-output');
    }
    for(const args of [['--user-id',userId],['--user-id',randomUUID(),'--replace']]) {
      const output=join(directory,'refused');const before=await state();
      command('mfa-cli',['prepare',...args,'--output',output],undefined,false);
      assert.equal(await state(),before);assert.equal(existsSync(output),false,'Unpublished private file removed');
    }
    const prepared=join(directory,'candidate');
    command('mfa-cli',['prepare','--user-id',userId,'--replace','--output',prepared]);
    const candidate=JSON.parse(readFileSync(prepared,'utf8')),totp=OTPAuth.URI.parse(candidate.uri);
    const beforeActive=await active();
    const [{now}]=await source.query('SELECT clock_timestamp() AS now');
    const allowed=new Set([-30000,0,30000,60000].map(offset=>totp.generate({timestamp:new Date(now).getTime()+offset})));
    let wrong='000000';while(allowed.has(wrong)) wrong=String(Number(wrong)+1).padStart(6,'0');
    for(let index=0;index<5;index++) {
      const output=join(directory,`wrong-${index}`);
      command('mfa-cli',['confirm','--user-id',userId,'--candidate-id',candidate.candidateId,'--output',output,'--code-stdin'],JSON.stringify({code:wrong}),false);
      assert.equal(existsSync(output),false);assert.equal(await active(),beforeActive);
    }
    assert.equal((await source.query('SELECT "candidateAttempts" FROM owner_mfa'))[0].candidateAttempts,5);
    let [{now:current}]=await source.query('SELECT clock_timestamp() AS now');
    command('mfa-cli',['confirm','--user-id',userId,'--candidate-id',candidate.candidateId,'--output',join(directory,'exhausted'),'--code-stdin'],JSON.stringify({code:totp.generate({timestamp:new Date(current).getTime()})}),false);
    assert.equal(await active(),beforeActive,'Exhausted candidate cannot replace factor');
    const next=join(directory,'next');command('mfa-cli',['prepare','--user-id',userId,'--replace','--output',next]);
    const fresh=JSON.parse(readFileSync(next,'utf8')),freshTotp=OTPAuth.URI.parse(fresh.uri);
    const beforeRefusal=await state();
    for(const owner of [randomUUID(),userId]) {
      command('mfa-cli',['confirm','--user-id',owner,'--candidate-id',fresh.candidateId,'--output',existing,'--code-stdin'],JSON.stringify({code:'000000'}),false);
      assert.equal(await state(),beforeRefusal);
    }
    // Explicit wrong-owner refusal with a new output reaches the real service.
    command('mfa-cli',['confirm','--user-id',randomUUID(),'--candidate-id',fresh.candidateId,'--output',join(directory,'wrong-owner'),'--code-stdin'],JSON.stringify({code:'000000'}),false);
    assert.equal(await state(),beforeRefusal);
    await source.query('UPDATE owner_mfa SET "candidateExpiresAt"=clock_timestamp()-interval \'1 second\'');
    const expired=await state();
    [{now:current}]=await source.query('SELECT clock_timestamp() AS now');
    command('mfa-cli',['confirm','--user-id',userId,'--candidate-id',fresh.candidateId,'--output',join(directory,'expired'),'--code-stdin'],JSON.stringify({code:freshTotp.generate({timestamp:new Date(current).getTime()})}),false);
    assert.equal(await state(),expired,'Expired confirmation cannot mutate active state');
    const beforePublication=await state();
    await assert.rejects(mfa.prepareEnrollment(userId,true,()=>{throw new Error('synthetic publication failure');}));
    assert.equal(await state(),beforePublication,'Real transaction rolls back publication failure');
    let publicationCandidate;
    await mfa.prepareEnrollment(userId,true,value=>{publicationCandidate=value;});
    const [{now:publicationTime}]=await source.query('SELECT clock_timestamp() AS now');
    const publicationCode=OTPAuth.URI.parse(publicationCandidate.uri).generate({timestamp:new Date(publicationTime).getTime()});
    const beforeConfirmPublication=await state();
    await assert.rejects(mfa.confirmEnrollment(userId,publicationCandidate.candidateId,publicationCode,()=>{throw new Error('synthetic confirmation publication refusal');}));
    assert.equal(await state(),beforeConfirmPublication,'Confirmation publication failure rolls back factor/revision/codes/sessions');
    console.log('PASS MFA-001 CLI output refusal, wrong owner, explicit replacement, candidate expiry/exhaustion and publication rollback');

    stage='key and envelope cases';
    let fixture=await enroll(source,userId);const challenge=await pending();
    const [row]=await source.query('SELECT * FROM owner_mfa');
    for(const field of ['nonce','tag','ciphertext','keyId']) {
      const envelope={...row.activeEnvelope};
      if(field==='keyId') envelope.keyId='different-key';
      else {const bytes=Buffer.from(envelope[field],'base64');bytes[0]^=1;envelope[field]=bytes.toString('base64');}
      await source.query('UPDATE owner_mfa SET "activeEnvelope"=$1',[envelope]);
      const before=await state();
      await rejected(mfa.complete(hash(challenge.token),{kind:'recovery',code:fixture.recoveryCodes[0]}),401);
      await assert.rejects(new MfaService(source,config,sessions).onModuleInit());
      assert.equal(await state(),before,'Envelope rejection cannot issue sessions or consume codes');
    }
    await source.query('UPDATE owner_mfa SET "activeEnvelope"=$1',[row.activeEnvelope]);
    const wrongKey=join(directory,'wrong-key');writeFileSync(wrongKey,randomBytes(32),{mode:0o600});
    const alternate=()=>new ConfigService({...process.env,FRONTEND_URL:origin,MFA_KEY_FILE:wrongKey});
    const wrongService=new MfaService(source,alternate(),sessions);
    await assert.rejects(wrongService.onModuleInit());
    await rejected(wrongService.complete(hash(challenge.token),{kind:'recovery',code:fixture.recoveryCodes[0]}),401);
    for(const mode of [0o644,0o640,0o660]) {chmodSync(wrongKey,mode);assert.throws(()=>new MfaService(source,alternate(),sessions));}
    chmodSync(wrongKey,0o600);writeFileSync(wrongKey,randomBytes(31));assert.throws(()=>new MfaService(source,alternate(),sessions));
    const keyLink=join(directory,'key-link');symlinkSync(process.env.MFA_KEY_FILE,keyLink);
    for(const file of [keyLink,join(directory,'no-key'),directory]) assert.throws(()=>new MfaService(source,new ConfigService({...process.env,FRONTEND_URL:origin,MFA_KEY_FILE:file}),sessions));
    // Positive use still goes through production completion after exact tamper restoration.
    await mfa.complete(hash(challenge.token),{kind:'recovery',code:fixture.recoveryCodes[0]});
    const copied=await pending();
    await source.query('UPDATE owner_mfa SET "activeEnvelope"=$1',[{...row.activeEnvelope,keyId:'lost-previous-key'}]);
    const replacement=await enroll(source,userId);
    assert.notEqual((await source.query('SELECT "activeVersion" FROM owner_mfa'))[0].activeVersion,row.activeVersion);
    await rejected(mfa.complete(hash(copied.token),{kind:'recovery',code:fixture.recoveryCodes[1]}),401);
    await rejected(mfa.complete(hash((await pending()).token),{kind:'recovery',code:fixture.recoveryCodes[1]}),401);
    await mfa.complete(hash((await pending()).token),{kind:'recovery',code:replacement.recoveryCodes[0]});
    console.log('PASS MFA-001-C real CLI replacement succeeds without decrypting old envelope and revokes old sessions/codes');
    console.log('PASS MFA-006 tampered nonce/tag/ciphertext/key ID, wrong encryption key and unsafe/missing key files fail closed');
  } finally {rmSync(directory,{recursive:true,force:true});}
}
async function main() {
  for(const [key,value] of Object.entries(settings)) assert.equal(process.env[key],value,'Isolated sentinel required');
  assert.ok(process.env.MFA_KEY_FILE && process.env.MFA_KEY_ID,'Synthetic key must be mounted');
  const admin=new Client({host:'postgres',port:5432,user:'capital_e2e',password:'capital_e2e',database:settings.DB_NAME,connectionTimeoutMillis:5000});
  await admin.connect();
  try { assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount,0,'Refuse preexisting MFA database'); await admin.query(`CREATE DATABASE "${database}"`); }
  finally { await admin.end(); }
  command('migrate'); command('owner-cli',['bootstrap','--email',email,'--password-stdin'],JSON.stringify({password,confirmation:password}));
  process.env.DB_NAME=database;
  const source=require('/app/backend/dist/typeorm-data-source.js').default;
  const {AuthService}=require('/app/backend/dist/auth/auth.service.js');
  const {OwnerAuth}=require('/app/backend/dist/entities/owner-auth.entity.js');
  const {SessionService}=require('/app/backend/dist/auth/session.service.js');
  const {MfaService}=require('/app/backend/dist/auth/mfa.service.js');
  await source.initialize();
  try {
    const config=new ConfigService({...process.env,FRONTEND_URL:origin});
    const auth=new AuthService(source.getRepository(OwnerAuth)); await auth.onModuleInit();
    const sessions=new SessionService(source,config),mfa=new MfaService(source,config,sessions);
    const verified=await auth.validateUser(email,password),userId=verified.user.id;
    const pending=async()=>{ const anon=await sessions.csrf(null); const owner=await auth.validateUser(email,password); return sessions.rotate(hash(anon.token),owner); };
    await verifyCliAndKeys(source,userId,config,sessions,mfa,pending);
    stage='factor replay and concurrency';
    let fixture=await enroll(source,userId);
    let one=await pending();
    await rejected(sessions.authorize(one.token,true,'GET'),401);
    await rejected(mfa.complete(hash(one.token),{kind:'totp',code:fixture.confirmationCode}),401);
    let two=await pending();
    const [{now}]=await source.query('SELECT clock_timestamp() AS now');
    const code=fixture.totp.generate({timestamp:new Date(now).getTime()});
    const raced=await Promise.allSettled([one,two].map(p=>mfa.complete(hash(p.token),{kind:'totp',code})));
    assert.equal(raced.filter(r=>r.status==='fulfilled').length,1,'MFA-003 concurrent counter consumed once');
    assert.equal((await source.query("SELECT 1 FROM auth_sessions WHERE state='authenticated'")).length,1);
    const restarted=new MfaService(source,config,sessions);
    await rejected(restarted.complete(hash((await pending()).token),{kind:'totp',code}),401);
    one=await pending(); two=await pending();
    const recovery=fixture.recoveryCodes[0];
    const recovered=await Promise.allSettled([one,two].map(p=>mfa.complete(hash(p.token),{kind:'recovery',code:recovery})));
    assert.equal(recovered.filter(r=>r.status==='fulfilled').length,1,'MFA-004 recovery consumed once');
    await rejected(mfa.complete(hash((await pending()).token),{kind:'recovery',code:recovery}),401);
    console.log('PASS MFA-002/003/004 pending denial, confirmation replay, concurrent TOTP/recovery and service reconstruction replay');

    stage='issuance rollback';
    one=await pending();
    const snapshot=async()=>fingerprint([await source.query('SELECT * FROM auth_sessions ORDER BY "tokenHash"'),await source.query('SELECT * FROM owner_mfa_recovery ORDER BY "codeHash"'),await source.query('SELECT * FROM owner_mfa')]);
    await source.query(`CREATE FUNCTION reject_mfa_issuance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='authenticated' THEN RAISE EXCEPTION 'synthetic issuance refusal'; END IF; RETURN NEW; END $$`);
    await source.query('CREATE TRIGGER reject_mfa_issuance BEFORE INSERT OR UPDATE ON auth_sessions FOR EACH ROW EXECUTE FUNCTION reject_mfa_issuance()');
    const before=await snapshot();
    try { await assert.rejects(mfa.complete(hash(one.token),{kind:'recovery',code:fixture.recoveryCodes[1]})); assert.equal(await snapshot(),before,'Issuance rollback preserves pending/code/counters'); }
    finally { await source.query('DROP TRIGGER reject_mfa_issuance ON auth_sessions'); await source.query('DROP FUNCTION reject_mfa_issuance()'); }
    await mfa.complete(hash(one.token),{kind:'recovery',code:fixture.recoveryCodes[1]});
    console.log('PASS MFA-004-A actual PostgreSQL issuance failure rolls back recovery consumption');

    stage='persisted attempt limits';
    fixture=await enroll(source,userId); one=await pending();
    const wrong='ffffffff-ffffffff-ffffffff-ffffffff';
    assert.ok(!fixture.recoveryCodes.some(c=>c.toLowerCase()===wrong));
    for(let attempt=1;attempt<=10;attempt++) {
      if(attempt===6) { assert.equal((await source.query('SELECT 1 FROM auth_sessions WHERE "tokenHash"=$1',[hash(one.token)])).length,0); one=await pending(); }
      await rejected(new MfaService(source,config,sessions).complete(hash(one.token),{kind:'recovery',code:wrong}),attempt===10?429:401);
    }
    const [blocked]=await source.query('SELECT * FROM owner_mfa');
    assert.ok(blocked.blockedUntil);
    one=await pending();
    await rejected(mfa.complete(hash(one.token),{kind:'recovery',code:fixture.recoveryCodes[0]}),429);
    assert.equal(fingerprint((await source.query('SELECT * FROM owner_mfa'))[0]),fingerprint(blocked),'Blocked attempts never extend cooldown');
    await source.query('UPDATE owner_mfa SET "blockedUntil"=clock_timestamp()-interval \'1 second\',"failureWindowStart"=clock_timestamp()-interval \'11 minutes\'');
    await mfa.complete(hash(one.token),{kind:'recovery',code:fixture.recoveryCodes[0]});
    console.log('PASS MFA-005 persisted five-attempt challenge retirement, ten-attempt account cooldown and finite expiry');

    stage='consecutive failure streak';
    assert.equal((await source.query('SELECT "consecutiveFailures" AS n FROM owner_mfa'))[0].n,0,'Success clears the streak');
    // A hundred paced failures across windows reach this state; set it directly, then spend one more.
    await source.query('UPDATE owner_mfa SET "consecutiveFailures"=99');
    one=await pending();
    await rejected(mfa.complete(hash(one.token),{kind:'recovery',code:wrong}),429);
    const [locked]=await source.query('SELECT * FROM owner_mfa');
    assert.equal(locked.consecutiveFailures,100);
    assert.equal(locked.blockedUntil,null,'The streak lock is not the timed window cooldown');
    one=await pending();
    await rejected(mfa.complete(hash(one.token),{kind:'recovery',code:fixture.recoveryCodes[1]}),429);
    assert.equal(fingerprint((await source.query('SELECT * FROM owner_mfa'))[0]),fingerprint(locked),'Locked attempts change nothing');
    fixture=await enroll(source,userId);
    assert.equal((await source.query('SELECT "consecutiveFailures" AS n FROM owner_mfa'))[0].n,0,'Trusted confirmation clears the streak');
    one=await pending();
    await mfa.complete(hash(one.token),{kind:'recovery',code:fixture.recoveryCodes[0]});
    console.log('PASS MFA-005-B hundredth consecutive failure locks completion until trusted confirmation');

    stage='pending lock expiry';
    fixture=await enroll(source,userId); one=await pending();
    const tokenHash=hash(one.token);
    await source.query('UPDATE auth_sessions SET "expiresAt"=clock_timestamp()+interval \'2 seconds\' WHERE "tokenHash"=$1',[tokenHash]);
    const blocker=source.createQueryRunner(); await blocker.connect(); let waiting;
    try {
      await blocker.startTransaction();
      const [{pid}]=await blocker.query('SELECT pg_backend_pid() AS pid');
      await blocker.query('SELECT 1 FROM auth_sessions WHERE "tokenHash"=$1 FOR UPDATE',[tokenHash]);
      waiting=mfa.complete(tokenHash,{kind:'recovery',code:fixture.recoveryCodes[0]}).then(()=>({ok:true}),error=>({ok:false,error}));
      let observed=false; const deadline=Date.now()+5000;
      while(Date.now()<deadline) {
        const [{blocked}]=await source.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND $2=ANY(pg_blocking_pids(pid))) AS blocked",[database,pid]);
        if(blocked) {observed=true;break;} await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.ok(observed,'Completion actually waits on held pending row');
      const [{valid}]=await blocker.query('SELECT "expiresAt">clock_timestamp() AS valid FROM auth_sessions WHERE "tokenHash"=$1',[tokenHash]); assert.equal(valid,true);
      await blocker.query('SELECT pg_sleep(GREATEST(EXTRACT(EPOCH FROM ("expiresAt"-clock_timestamp())),0)::double precision+0.02) FROM auth_sessions WHERE "tokenHash"=$1',[tokenHash]);
      await blocker.commitTransaction(); const outcome=await waiting; assert.equal(outcome.ok,false); assert.equal(outcome.error.getStatus?.(),401);
      assert.equal((await source.query('SELECT 1 FROM owner_mfa_recovery WHERE "usedAt" IS NOT NULL')).length,0,'Expired pending cannot consume recovery code');
    } finally { try {if(blocker.isTransactionActive) await blocker.rollbackTransaction();} finally {await blocker.release();} if(waiting) await waiting; }
    console.log('PASS MFA-003-B pending expiry after observed database lock wait');

    const preserved=fingerprint(await source.query('SELECT "activeVersion","activeEnvelope","lastCounter" FROM owner_mfa'));
    const codes=fingerprint(await source.query('SELECT * FROM owner_mfa_recovery ORDER BY "codeHash"'));
    const oldPending=await pending();
    command('owner-cli',['recover','--user-id',userId,'--password-stdin'],JSON.stringify({password,confirmation:password}));
    assert.equal(fingerprint(await source.query('SELECT "activeVersion","activeEnvelope","lastCounter" FROM owner_mfa')),preserved);
    assert.equal(fingerprint(await source.query('SELECT * FROM owner_mfa_recovery ORDER BY "codeHash"')),codes);
    await rejected(mfa.complete(hash(oldPending.token),{kind:'recovery',code:fixture.recoveryCodes[0]}),401);
    await mfa.complete(hash((await pending()).token),{kind:'recovery',code:fixture.recoveryCodes[0]});
    console.log('PASS MFA-004-B password recovery preserves factor/codes and revokes pending credentials');

  } finally { await source.destroy(); }
}
if(require.main===module) main().catch(()=>{console.error(`FAIL isolated MFA database acceptance at ${stage} (credential-bearing assertion details withheld)`);process.exitCode=1;});
module.exports={enroll};
