// Authors: Christian Reitwiessner
// HTTP requests are fulfilled from disk by Playwright; no server or uploads.
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fixture} from '../tests/fixture.mjs';
import {zipFixture} from '../tests/zip-fixture.mjs';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),
  args:['--no-sandbox','--no-zygote','--disable-dev-shm-usage',...(process.env.BROWSER_ARGS?JSON.parse(process.env.BROWSER_ARGS):[])]});
const context = await browser.newContext({viewport:{width:1100,height:1000}});
const root=path.resolve('dist'), requests=[], errors=[];
const legacyAssets=[];
await context.route('**/*',async route=>{
  const url=new URL(route.request().url());requests.push({url:url.href,method:route.request().method()});
  if(url.origin!=='http://localhost:4174'||!url.pathname.startsWith('/room/')){await route.abort();return;}
  const relative=url.pathname.slice('/room/'.length)||'index.html', file=path.resolve(root,relative);
  // A stale pre-ZIP app.js must never be used by the new asset graph.
  if(relative==='app.js'){
    legacyAssets.push(relative);
    await route.fulfill({body:"document.querySelector('#status').textContent='Choose a compiled .wasm game. Native desktop and original Amiga executables cannot run in this host.';",contentType:'application/javascript'});return;
  }
  if(!file.startsWith(root+path.sep)){await route.abort();return;}
  try{await route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.md':'text/plain'})[path.extname(file)]||'application/octet-stream'});}
  catch{await route.fulfill({status:404,body:'Not found'});}
});
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
const choose=async bytes=>page.locator('#binary').setInputFiles({name:'fixture.wasm',mimeType:'application/wasm',buffer:Buffer.from(bytes)});
const start=async()=>page.locator('#start').click();
const statusMatches=async pattern=>{await page.waitForFunction(source=>new RegExp(source).test(document.querySelector('#status').textContent),pattern.source);};
const pixel=()=>page.locator('#screen').evaluate(canvas=>[...canvas.getContext('2d').getImageData(0,0,1,1).data]);
try{
  await page.goto('http://localhost:4174/room/');
  assert.equal(await page.locator('#start').isDisabled(),true);
  await choose([1,2,3]);await start();await statusMatches(/compiled .wasm/);
  const originalError=await page.locator('#error-details').textContent();
  assert.match(originalError,/compiled .wasm game or a ZIP/);
  await choose(fixture({version:2}));
  assert.equal(await page.locator('#error-panel').isVisible(),true);
  assert.equal(await page.locator('#error-details').textContent(),originalError);
  await start();await statusMatches(/Unsupported game interface/);
  await page.waitForTimeout(150);
  assert.match(await page.locator('#error-details').textContent(),/Unsupported game interface/);
  await page.locator('#reload').click();
  await page.waitForURL(url=>url.searchParams.has('reload'));
  assert.match(await page.locator('#build').textContent(),/^Build [a-f0-9]{12}$/);
  assert.equal(await page.locator('#start').isDisabled(),true);
  await choose(fixture({pointer:-1}));await start();await statusMatches(/invalid memory range/);
  await choose(fixture());await start();await statusMatches(/^Ready$/);
  assert.equal(await page.locator('#error-panel').isHidden(),true);
  await page.locator('#binary').setInputFiles({name:'game-build.zip',mimeType:'application/zip',buffer:zipFixture([{name:'game.wasm',bytes:fixture()},{name:'README.txt',bytes:[1,2,3]}])});
  await start();await statusMatches(/^Ready$/);
  await page.locator('#data').setInputFiles({name:'opaque.data',mimeType:'application/octet-stream',buffer:Buffer.from([1,2,3])});
  await page.locator('#clear-data').click();assert.equal(await page.locator('#data').evaluate(input=>input.files.length),0);
  await start();await statusMatches(/^Ready$/);
  assert.equal(await page.locator('#screen').getAttribute('width'),'2');
  await page.keyboard.press('X');await page.waitForFunction(()=>document.querySelector('#screen').getContext('2d').getImageData(0,0,1,1).data[1]===88);
  assert.deepEqual((await pixel()).slice(0,2),[1,88]);
  await page.locator('#keyboard').fill('a'.repeat(300));
  await page.locator('#keyboard').dispatchEvent('input');await statusMatches(/up to 256/);
  await page.locator('[data-key="8"]').click();await statusMatches(/^Ready$/);
  assert.equal((await pixel())[0],8);
  if(await page.evaluate(()=>document.fullscreenEnabled)){
    await page.locator('#fullscreen').click();await page.waitForFunction(()=>Boolean(document.fullscreenElement));
    const box=await page.locator('#screen').boundingBox();assert.ok(box.width>800);assert.ok(box.height>800);
    await page.evaluate(()=>document.exitFullscreen());
  }
  // Stop must work while Wasm is stuck in a synchronous loop in its worker.
  await choose(fixture({hang:true}));await start();await page.waitForTimeout(250);
  await page.locator('#stop').click();await statusMatches(/^Stopped/);
  await choose(fixture());await start();await statusMatches(/^Ready$/);
  await page.locator('#stop').click();await statusMatches(/^Stopped/);
  await choose(fixture({physical:true}));await start();await statusMatches(/^Ready$/);
  await page.keyboard.down('F2');
  await page.waitForFunction(()=>document.querySelector('#screen').getContext('2d').getImageData(0,0,1,1).data[2]===1);
  assert.deepEqual((await pixel()).slice(0,3),[12,59,1]);
  await page.keyboard.up('F2');
  await page.waitForFunction(()=>document.querySelector('#screen').getContext('2d').getImageData(0,0,1,1).data[2]===0);
  assert.deepEqual((await pixel()).slice(0,3),[12,59,0]);
  await page.locator('#stop').click();await statusMatches(/^Stopped/);

  if(process.env.GAME_WASM){
    await page.locator('#binary').setInputFiles(process.env.GAME_WASM_ZIP||process.env.GAME_WASM);
    if(process.env.GAME_DATA)await page.locator('#data').setInputFiles(process.env.GAME_DATA);
    await start();await statusMatches(/^Hauptmenü/);
    if(process.env.GAME_REPLAY){
      const rows=readFileSync(process.env.GAME_REPLAY,'utf8').trim().split('\n');
      for(let index=0;index<rows.length;index++){
        const [kindText,aText,bText,hash]=rows[index].split('\t'),kind=Number(kindText),a=Number(aText),b=Number(bText);
        if(kind===1){const char=String.fromCodePoint(a);await page.keyboard.press(char===' '?'Space':char);}
        else if([2,3,4,8,9].includes(kind))await page.keyboard.press({2:'Enter',3:'Backspace',4:'Escape',8:'ArrowLeft',9:'ArrowRight'}[kind]);
        else if(kind===5||kind===6){const box=await page.locator('#screen').boundingBox();await page.mouse.click(box.x+(a+.5)*box.width/320,box.y+(b+.5)*box.height/200,{button:kind===6?'right':'left'});}
        await page.waitForFunction(async expected=>{
          const canvas=document.querySelector('#screen'),bytes=canvas.getContext('2d').getImageData(0,0,320,200).data;
          const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
          return actual===expected;
        },hash,{timeout:5000}).catch(error=>{throw new Error(`Replay frame ${index} failed: ${error.message}`);});
      }
      console.log(`${rows.length} original game replay frames match through the generic host.`);
    }
    if(process.env.GAME_NAVIGATION_CHECK){
      // Optional private-game integration: the recruitment replay ends at the
      // crew prompt. Exercise motion/ticks through actual DOM input next.
      const hashFrame=()=>page.locator('#screen').evaluate(async canvas=>{
        const bytes=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
      });
      const move=async(x,y)=>{const box=await page.locator('#screen').boundingBox();await page.mouse.move(box.x+(x+.5)*box.width/320,box.y+(y+.5)*box.height/200);};
      const click=async(x,y,button='left')=>{const box=await page.locator('#screen').boundingBox();await page.mouse.click(box.x+(x+.5)*box.width/320,box.y+(y+.5)*box.height/200,{button});};
      await move(160,100);await click(160,100,'right');await statusMatches(/^Karte/);
      const centered=await hashFrame();await move(1,100);
      await page.waitForFunction(async initial=>{
        const canvas=document.querySelector('#screen'),bytes=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')!==initial;
      },centered,{timeout:3000});
      await move(160,100);await page.waitForTimeout(80);const stopped=await hashFrame();await page.waitForTimeout(80);assert.equal(await hashFrame(),stopped);
      await click(160,100,'right');await statusMatches(/^Kontor/);
      await page.keyboard.press('k');await statusMatches(/^Karte/);assert.equal(await hashFrame(),centered);
      await click(111,130);await statusMatches(/^Kontor/); // Current home town cancels.
      await page.keyboard.press('k');await statusMatches(/^Karte/);
      await click(253,128);await statusMatches(/^Voyage scheduled/);
      assert.match(await page.locator('#status').textContent(),/time has not advanced/);
      console.log('Recruitment, optional pointer motion, raster-paced map scrolling, cancellation and departure scheduling passed in the browser.');
    }
    await page.locator('#stop').click();await start();await statusMatches(/^Hauptmenü/);
  }
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(await page.locator('#stop').isEnabled())await page.locator('#stop').click();
  assert.equal(await page.locator('#screen').isHidden(),true);
  assert.ok(requests.every(request=>request.method==='GET'));
  assert.ok(requests.every(request=>!request.url.endsWith('.wasm')&&!request.url.endsWith('.zip')));
  assert.deepEqual(errors,[]);
  assert.deepEqual(legacyAssets,[]);
  console.log('Generic/no-data game, invalid files/ABI/pointers, paste limits, fullscreen, hang recovery, restart, mobile layout and local-only network checks passed.');
}catch(error){console.error('Host status:',await page.locator('#status').textContent());throw error;}
finally{await browser.close();}
