// Real-browser check: parsing, placement, proximity, persistence and input isolation.
const assert=require('node:assert/strict');
const {chromium}=require('/Users/cain/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});try {
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8766/');await page.waitForFunction(()=>window.App?.scenes?.length);
 await page.locator('.scene-card').first().click();await page.waitForFunction(()=>App.three?.npcs&& !App._entering,{},{timeout:60000});
 assert.ok(await page.locator('#quest-replay').isHidden());
 let q=await page.evaluate(()=>App.activeScene.storyQuest);assert.deepEqual(q.npcs.map(n=>n.kind),['squirrel','woodcutter','crab']);assert.equal(q.collected.length,0);
 const points=await page.evaluate(()=>App.three.npcs.entries.map(e=>({y:e.root.position.y,ground:App.three.meta.heightAt(e.npc.x,e.npc.z)})));points.forEach(p=>assert.equal(p.y,p.ground));
 // Every NPC awards exactly one star, outside the radius awards none.
 for(let i=0;i<3;i++){
   await page.evaluate(i=>{const n=App.activeScene.storyQuest.npcs[i];App.three.character.pos.set(n.x+3.5,0,n.z);},i);await page.waitForTimeout(150);
   assert.equal((await page.evaluate(()=>App.activeScene.storyQuest.collected)).length,i);
   await page.evaluate(i=>{const n=App.activeScene.storyQuest.npcs[i];App.three.character.pos.set(n.x+1.8,0,n.z);},i);
   await page.waitForFunction(i=>App.activeScene.storyQuest.collected.length===i+1,i);await page.waitForTimeout(200);
   assert.equal((await page.evaluate(()=>App.activeScene.storyQuest.collected)).length,i+1);
   await page.screenshot({path:`/Users/cain/Desktop/照片/npc-${i}.png`});
 }
 await page.evaluate(()=>App._questSave);assert.equal(await page.locator('#quest-stars').textContent(),'★ ★ ★');assert.equal(await page.locator('#quest-panel').count(),0);const badge=await page.locator('#star-progress').boundingBox();assert.ok(badge.x>1100&&badge.y>800);
 await page.screenshot({path:'/Users/cain/Desktop/照片/npc-quest-complete.png'});
 await page.locator('#back-btn').click();await page.locator('.scene-card').first().click();await page.waitForFunction(()=>App.three?.npcs&&!App._entering,{},{timeout:60000});assert.equal((await page.evaluate(()=>App.activeScene.storyQuest.collected)).length,3);
 await page.locator('#story-btn').click();assert.equal(await page.evaluate(()=>App.three.character._enabled),false);
 await page.locator('#story-input').fill('树下有小兔。房子旁边有小猫。湖边有小狗。');await page.keyboard.press('w');assert.equal(await page.evaluate(()=>!!App.three.character.keys.KeyW),false);
 await page.locator('#story-input').fill('树下有小兔。房子旁边有小猫。湖边有小狗。');await page.locator('#story-save').click();await page.waitForFunction(()=>!document.getElementById('story-dialog').open);
 q=await page.evaluate(()=>App.activeScene.storyQuest);assert.deepEqual(q.npcs.map(n=>n.kind),['rabbit','cat','dog']);assert.equal(q.collected.length,0);assert.equal(await page.evaluate(()=>App.three.npcs.entries.length),3);
 await page.locator('#story-btn').click();await page.locator('#story-input').fill('只有松鼠。');assert.equal(await page.locator('#story-save').isDisabled(),true);await page.locator('#story-close').click();
 await page.evaluate(async()=>{const {parseStory,placeNPCs}=await import('./js/story-npcs.js');const meta={bounds:{minX:-30,maxX:30,minZ:-30,maxZ:30},heightAt:()=>2,canWalk:(x,z)=>x>0,spawn:{x:1,z:10}};const a=placeNPCs(parseStory('树下有松鼠。房旁有大叔。湖边有螃蟹。'),meta,{});if(a.some(p=>p.x<=0)||a.length!==3)throw Error('fallback placement');let rejected=false;try{parseStory('松鼠。螃蟹。')}catch{rejected=true}if(!rejected)throw Error('invalid story accepted');});
 const fixture=JSON.parse(require('node:child_process').execFileSync('python3',['-c',"import runpy,json; f=runpy.run_path('tests/test_backend.py')['fixture']; print(json.dumps(f('stone')))"]));
 await page.evaluate(async plan=>{const {Storage}=await import('./js/storage.js');const rec={...App.activeScene,id:'npc-other',name:'另一张照片',isDefault:false,plan};delete rec.storyQuest;await Storage.put(rec);App.scenes.push(rec);App.exitScene();await App.enterScene(rec.id);},fixture);
 assert.equal(await page.evaluate(()=>App.activeScene.storyQuest.collected.length),0);assert.equal(await page.evaluate(()=>App.three.npcs.entries.length),3);
 assert.ok(await page.evaluate(()=>App.activeScene.storyQuest.npcs.every(n=>App.three.meta.canWalk(n.x,n.z))));
 await page.evaluate(async()=>{const {Storage}=await import('./js/storage.js');const first=await Storage.get('default-111');if(first.storyQuest.npcs[0].kind!=='rabbit')throw Error('scene stories leaked');const {parseStory}=await import('./js/story-npcs.js');if(parseStory('在树下见到了松鼠，房子旁边有个砍树大叔和湖边有螃蟹').length!==3)throw Error('joined story');});
 await page.setViewportSize({width:390,height:844});await page.locator('#story-btn').click();await page.screenshot({path:'/Users/cain/Desktop/照片/npc-story-mobile.png'});assert.ok(await page.evaluate(()=>document.getElementById('story-dialog').getBoundingClientRect().width<390));
 await page.evaluate(async()=>{const THREE=await import('three');const {collisionMeta}=await import('./js/marble-world.js');const group=new THREE.Group();const material=new THREE.MeshBasicMaterial();const floor=new THREE.Mesh(new THREE.BoxGeometry(30,.2,30),material);floor.position.y=-.1;group.add(floor);const wall=new THREE.Mesh(new THREE.BoxGeometry(.2,3,10),material.clone());wall.position.set(2,1.5,0);group.add(wall);const platform=new THREE.Mesh(new THREE.BoxGeometry(2,.3,2),material.clone());platform.position.set(-6,.15,6);group.add(platform);const meta=collisionMeta(group);if(!meta.canWalk(-6,6))throw Error('platform fixture');const before=meta.heightAt(90,90);if(Number.isFinite(meta.npcGround(4,0)))throw Error('NPC path crossed wall');if(!Number.isFinite(meta.npcGround(-4,0)))throw Error('reachable NPC rejected');if(meta.heightAt(90,90)!==before)throw Error('NPC probe changed player collision state');group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});});
 assert.deepEqual(errors,[]);console.log('PASS: three NPCs, terrain placement, distance collection, no duplicates, saved re-entry, editable story, input isolation, fallback placement.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
