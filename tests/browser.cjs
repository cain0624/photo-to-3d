const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_PATH || '/Users/cain/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
 const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/Shader Error|VALIDATE_STATUS|THREE.WebGLProgram/.test(m.text()))errors.push(m.text());});
 await page.goto('http://127.0.0.1:8766/',{waitUntil:'networkidle'});
 // A missing model must fail explicitly, not produce a hidden fallback relief.
 let message='';page.once('dialog',async d=>{message=d.message();await d.accept();});
 await page.locator('#file-input').setInputFiles('assets/defaults/111.jpg');
 await page.waitForFunction(()=>!document.querySelector('.processing'));
 assert.match(message,/配置.*(视觉模型|MARBLE_API_KEY)/);
 const fixtures=JSON.parse(require('node:child_process').execFileSync('python3',['-c',"import runpy,json; f=runpy.run_path('tests/test_backend.py')['fixture']; print(json.dumps([f('grass'),f('stone')]))"],{encoding:'utf8'}));let requests=0;
 await page.route('**/api/reconstruct',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({plan:fixtures[requests++],provenance:{method:'TEST-ONLY-mock-vision',approximate:true}})}));
 await page.locator('#file-input').setInputFiles('assets/defaults/111.jpg');
 await page.locator('.scene-card:not(.default):not(.upload-card):not(.processing)').waitFor();
 await page.locator('.scene-card:not(.default):not(.upload-card):not(.processing)').click();
 await page.waitForFunction(()=>window.App.three&&document.querySelector('#loading-overlay').classList.contains('hidden'));
 assert.equal(await page.evaluate(()=>window.App.activeScene.plan.terrain.surface),'grass');
 assert.ok(await page.evaluate(()=>window.App.three.meta.heightAt(0,150)>window.App.three.meta.heightAt(0,-150)));
 assert.equal(await page.evaluate(()=>window.App.three.meta.canWalk(0,-140)),false);
 await page.screenshot({path:'/tmp/photo-world-grass.png'});
 await page.locator('#back-btn').click();
 const cityImage=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=900;c.height=600;const x=c.getContext('2d');x.fillStyle='#7399b1';x.fillRect(0,0,900,600);x.fillStyle='#777777';x.fillRect(0,400,900,200);for(let i=0;i<5;i++){x.fillStyle='#ab7862';x.fillRect(50+i*175,160+i*15,120,300-i*15);}return c.toDataURL('image/png').split(',')[1];});
 await page.locator('#file-input').setInputFiles({name:'city-test.png',mimeType:'image/png',buffer:Buffer.from(cityImage,'base64')});
 await page.waitForFunction(()=>window.App.scenes.length===3&&!document.querySelector('.processing'));
 await page.locator('.scene-card:not(.default):not(.upload-card):not(.processing)').last().click();
 await page.waitForFunction(()=>window.App.three&&document.querySelector('#loading-overlay').classList.contains('hidden'));
 assert.equal(await page.evaluate(()=>window.App.activeScene.plan.objects[0].kind),'building');
 assert.equal(await page.evaluate(()=>window.App.three.meta.canWalk(10,0)),false);
 await page.screenshot({path:'/tmp/photo-world-city.png'});
 await page.reload();await page.locator('.scene-card:not(.default):not(.upload-card):not(.processing)').last().click();
 await page.waitForFunction(()=>window.App.three&&document.querySelector('#loading-overlay').classList.contains('hidden'));
 assert.equal(requests,2,'Saved worlds must not call the model again');assert.deepEqual(errors,[]);
 await page.locator('#back-btn').click();await page.locator('.scene-card.default').click();
 await page.waitForFunction(()=>window.App.three&&document.querySelector('#loading-overlay').classList.contains('hidden'));
 assert.equal(await page.evaluate(()=>window.App.activeScene.id),'default-111');assert.deepEqual(errors,[]);
 console.log('PASS: missing-model error, two upload plans, volume/collision/slope, archive reload, default scene, no runtime errors. Mock model responses only.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
