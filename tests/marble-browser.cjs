// Synthetic splats/collider + mocked API: tests integration, never claims photo quality.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'/Users/cain/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
function glb(){
 const points=[-15,0,-15, 15,0,15,15,0,-15, -15,0,-15,-15,0,15,15,0,15, 2,0,-3,2,3,3,2,3,-3,2,0,-3,2,0,3,2,3,3];
 for(let i=0;i<points.length;i+=3){points[i+1]*=-1;points[i+2]*=-1;}
 const buffer=Buffer.from(new Float32Array(points).buffer);const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:buffer.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:buffer.length,target:34962}],accessors:[{bufferView:0,componentType:5126,count:points.length/3,type:'VEC3',min:[-15,-3,-15],max:[15,0,15]}]};
 let encoded=Buffer.from(JSON.stringify(json));encoded=Buffer.concat([encoded,Buffer.alloc((4-encoded.length%4)%4,32)]);const header=Buffer.alloc(12);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+encoded.length+buffer.length,8);const j=Buffer.alloc(8),b=Buffer.alloc(8);j.writeUInt32LE(encoded.length);j.writeUInt32LE(0x4e4f534a,4);b.writeUInt32LE(buffer.length);b.writeUInt32LE(0x004e4942,4);return Buffer.concat([header,j,encoded,b,buffer]);
}
function ply(){
 const fields=['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];let rows=[];
 for(let z=-20;z<20;z++)for(let x=-20;x<20;x++)rows.push(x*.6,0,z*.6,-.2,.2,-.3,5,-1,-1,-1,1,0,0,0);
 const header=`ply\nformat binary_little_endian 1.0\nelement vertex ${rows.length/fields.length}\n${fields.map(f=>'property float '+f).join('\n')}\nend_header\n`;
 return Buffer.concat([Buffer.from(header),Buffer.from(new Float32Array(rows).buffer)]);
}

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
 const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('pageerror',e.message);});page.on('console',m=>{if(m.type()==='error')console.log('console',m.text());});page.on('requestfailed',r=>console.log('network',r.url(),r.failure()));
 const world={id:'world-test',jobId:'job-test',splatUrl:'http://127.0.0.1:8766/test-world.ply',colliderUrl:'http://127.0.0.1:8766/test-collider.glb',semantics:{metric_scale_factor:1.5,ground_plane_offset:.4}};let submissions=0;
 await page.route('**/test-world.ply',r=>r.fulfill({body:ply(),contentType:'application/octet-stream'}));await page.route('**/test-collider.glb',r=>r.fulfill({body:glb(),contentType:'model/gltf-binary'}));
 await page.route('**/api/reconstruct',r=>{submissions++;return r.fulfill({status:202,contentType:'application/json',body:JSON.stringify({jobId:'job-test',done:false})});});
 await page.route('**/api/marble/jobs/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({done:true,world,provenance:{method:'TEST-ONLY-marble'}})}));
 await page.goto('http://127.0.0.1:8766/',{waitUntil:'networkidle'});
 await page.locator('#file-input').setInputFiles('assets/defaults/111.jpg');
 await page.waitForFunction(async()=>{const {Storage}=await import('/js/storage.js');return (await Storage.getAll()).some(r=>r.marbleJob);});
 await page.reload();
 await page.locator('.scene-card:not(.default):not(.upload-card):not(.processing)').waitFor({timeout:20000});await page.locator('.scene-card:not(.default):not(.upload-card):not(.processing)').click();
 await page.waitForFunction(()=>window.App.three?.character&&document.querySelector('#loading-overlay').classList.contains('hidden'),{},{timeout:60000}).catch(async e=>{console.log(await page.evaluate(()=>({error:window.App._lastError,status:document.querySelector('#loading-text').textContent})));throw e;});
 assert.ok(Math.abs(await page.evaluate(()=>window.App.three.meta.heightAt(0,0))-.4)<1e-5);
 assert.equal(await page.evaluate(()=>window.App.three.meta.canWalk(3,0)),false);
 assert.equal(await page.evaluate(()=>window.App.three.meta.canWalk(1,0)),true);
 assert.equal(await page.evaluate(()=>window.App.three.meta.canWalk(30,0)),false);
 await page.screenshot({path:'/tmp/marble-integration.png'});
 await page.locator('#back-btn').click();await page.reload();await page.locator('.scene-card:not(.default):not(.upload-card):not(.processing)').click();
 await page.waitForFunction(()=>window.App.three?.character&&document.querySelector('#loading-overlay').classList.contains('hidden'),{},{timeout:60000});assert.equal(submissions,1);
 await page.locator('#back-btn').click();await page.locator('.scene-card.default').click();await page.waitForFunction(()=>window.App.three?.character&&document.querySelector('#loading-overlay').classList.contains('hidden'),{},{timeout:60000});
 assert.deepEqual(errors,[]);console.log('PASS: synthetic splat rendering, collision ground/wall/edge, archive reload without regeneration, default scene regression');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
