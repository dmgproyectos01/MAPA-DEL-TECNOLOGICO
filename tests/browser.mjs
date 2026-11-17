import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const runtimePlaywright='/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js';
let playwright;
try { playwright=await import('playwright'); } catch(error) { if(!existsSync(runtimePlaywright))throw error;playwright=await import(runtimePlaywright); }
const {chromium}=playwright.chromium?playwright:playwright.default;
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const target = process.env.CAMPUS_QA_URL || 'http://127.0.0.1:3000/';
const out = path.join(root, 'tests/screenshots');
const assetMetadata=JSON.parse(await readFile(path.join(root,'assets/mapa-campus-base.json'),'utf8'));
await mkdir(out, { recursive: true });
const report = { target, started: new Date().toISOString(), viewports: [], failures: [] };
const executablePath=process.env.CAMPUS_CHROMIUM_PATH||process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(existsSync(runtimePlaywright)&&existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
const browser = await chromium.launch({ ...(executablePath?{executablePath}:{}), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function check(page, row, name, callback) {
  try { const detail = await callback(); row.checks.push({ name, ok: true, ...(detail ? { detail } : {}) }); }
  catch (error) { const failure = { viewport: row.name, name, error: error.stack || String(error) }; row.checks.push({ name, ok: false, error: error.message }); report.failures.push(failure); }
}
async function settled(page) {
  await page.waitForTimeout(300);
  await page.evaluate(() => new Promise(requestAnimationFrame));
}
async function search(page, query) {
  await page.locator('#search').fill(query);
  await page.locator('#suggestions [role="option"]').first().waitFor({ state: 'visible' });
  await page.locator('#search').press('Enter');
  await page.locator('#detail').waitFor({ state: 'visible' });
  await settled(page);
}
async function closeDetail(page) {
  if (await page.locator('#detail').isVisible()) await page.locator('#detail .close').click();
}
async function fit(page) {
  await closeDetail(page);
  if (await page.locator('#clear-active-route').isVisible()) await page.locator('#clear-active-route').click();
  if (await page.locator('#route-panel').isVisible()) {
    if (await page.locator('#clear-route').isVisible()) await page.locator('#clear-route').click();
    else await page.locator('#route-panel .close').click();
  }
  await page.locator('#reset').click();
  await settled(page);
}


// Check hit-testing before clicking: Playwright scrolling a hidden control into
// view would otherwise mask the discoverability regression reported by users.
async function assertImmediatelyClickable(page, selector) {
  const state = await page.locator(selector).evaluate(el => {
    const box = el.getBoundingClientRect(), x = box.x + box.width/2, y = box.y + box.height/2;
    const hit = document.elementFromPoint(x, y);
    return { text: el.textContent.trim(), visible: box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, unobscured: !!hit && (el === hit || el.contains(hit)), disabled: el.disabled };
  });
  assert.match(state.text, /Quitar ruta$/);
  assert.ok(state.visible && state.unobscured && !state.disabled, `${selector}: ${JSON.stringify(state)}`);
}
async function openRoute(page) {
  await fit(page);
  await search(page, 'EH02');
  await page.locator('#get-route').click();
  await page.locator('#route-panel').waitFor({ state: 'visible' });
  await page.locator('.route-line').waitFor({ state: 'attached', timeout: 10000 });
  await settled(page);
}
async function assertRouteRemoved(page) {
  await page.locator('.route-line').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#route-layer > *').count(), 0, 'Route path and endpoint markers must all be removed');
  assert.equal(await page.locator('#route-panel').isVisible(), false);
  assert.equal(await page.locator('#clear-active-route').isVisible(), false);
  await settled(page);
  const transform = await page.locator('#world').getAttribute('transform');
  assert.ok(!transform || /scale\(1\)/.test(transform), `Campus view was not reset: ${transform}`);
}

for (const [name, width, height] of [['desktop', 1366, 768], ['mobile', 390, 844]]) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: name === 'mobile', hasTouch: name === 'mobile', colorScheme: 'light' });
  const page = await context.newPage();
  const consoleErrors = [], pageErrors = [], failedRequests = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  const row = { name, width, height, checks: [], consoleErrors, pageErrors, failedRequests };
  report.viewports.push(row);
  try {
    await page.goto(target, { waitUntil: 'networkidle', timeout: 30000 });
    await page.locator('.filters button').last().waitFor({ state: 'attached', timeout: 20000 });
    await page.locator('#campus-base').waitFor({ state: 'attached' });
    if (await page.locator('#explore').isVisible()) await page.locator('#explore').click();
    await fit(page);
    await check(page, row, 'Single raster base; no old vector illustration', async () => {
      assert.equal(await page.locator('#campus image').count(), 1);
      assert.equal(await page.locator('#campus .road,#campus .canal,#campus .tree,#campus .building,#campus .walkway,#campus .plaza').count(), 0);
      assert.ok(await page.locator('.place.hotspot').count() >= 35);
      const opaqueHotspots=await page.locator('.place.hotspot polygon').evaluateAll(els=>{
        const invisibleColor=value=>value==='none'||value==='transparent'||/rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(value);
        return els.map(el=>{const style=getComputedStyle(el);return{id:el.closest('.place')?.dataset.id,fill:style.fill,fillOpacity:style.fillOpacity,stroke:style.stroke,strokeOpacity:style.strokeOpacity,opacity:style.opacity};}).filter(s=>Number(s.opacity)!==0&&((Number(s.fillOpacity)!==0&&!invisibleColor(s.fill))||(Number(s.strokeOpacity)!==0&&!invisibleColor(s.stroke))));
      });
      assert.deepEqual(opaqueHotspots,[],'Unselected hotspots must remain transparent');
      const info = await page.locator('#campus-base').evaluate(el => ({ href: el.getAttribute('href') || el.getAttribute('xlink:href'), preserveAspectRatio: el.getAttribute('preserveAspectRatio'), filter: getComputedStyle(el).filter, opacity: getComputedStyle(el).opacity }));
      assert.ok(info.href?.startsWith('assets/'));
      const assetUrl=new URL(info.href,target).href;
      assert.equal(new URL(assetUrl).pathname.split('/').at(-1),assetMetadata.image);
      const assetResponse=await page.request.get(assetUrl);
      assert.ok(assetResponse.ok(),`Raster HTTP ${assetResponse.status()}`);
      const actualAssetHash=createHash('sha256').update(await assetResponse.body()).digest('hex');
      assert.equal(actualAssetHash,assetMetadata.assetSha256,'Published raster bytes differ from this checkout');
      info.assetUrl=assetUrl;info.assetSha256=actualAssetHash;
      assert.equal(info.filter, 'none');
      assert.equal(info.opacity, '1');
      assert.notEqual(info.preserveAspectRatio, 'none');
      await page.evaluate(async href => { const img = new Image(); img.src = href; await img.decode(); if (!img.naturalWidth) throw Error('Base image failed to load'); }, info.href);
      return info;
    });
    await check(page, row, 'No horizontal overflow; map and base fit viewport', async () => {
      const layout = await page.evaluate(() => {
        const host = document.querySelector('#map-host').getBoundingClientRect(), image = document.querySelector('#campus-base').getBoundingClientRect(), svg = document.querySelector('#campus'), view = svg.viewBox.baseVal;
        return { scrollWidth: document.documentElement.scrollWidth, innerWidth, host: {x:host.x,y:host.y,width:host.width,height:host.height}, image: {x:image.x,y:image.y,width:image.width,height:image.height}, viewBox: {width:view.width,height:view.height} };
      });
      assert.ok(layout.scrollWidth <= width + 1, JSON.stringify(layout));
      assert.ok(layout.image.x >= layout.host.x - 1 && layout.image.x + layout.image.width <= layout.host.x + layout.host.width + 1, JSON.stringify(layout));
      assert.ok(layout.image.y >= layout.host.y - 1 && layout.image.y + layout.image.height <= layout.host.y + layout.host.height + 1, JSON.stringify(layout));
      assert.ok(Math.abs(layout.image.width/layout.image.height - layout.viewBox.width/layout.viewBox.height) < .003, JSON.stringify(layout));
      row.geometry=layout;
      return layout;
    });
    await page.screenshot({ path: path.join(out, `raster-${name}.png`), fullPage: true });
    const baseOnlyStyle=await page.addStyleTag({content:'.topbar,.welcome,.filters,.map-tools,.bottom-bar,.map-note,.toast,.floating-card,.legend-box,.place,#route-layer{visibility:hidden!important}'});
    await page.locator('#campus-base').screenshot({ path: path.join(out, `raster-${name}-base.png`) });
    await baseOnlyStyle.evaluate(el=>el.remove());
    for (const code of ['EE01', 'EV01', 'EVLE', 'ED01', 'EW04', 'EJ10', 'EH02']) {
      await check(page, row, `Search and center ${code}`, async () => {
        await search(page, code);
        assert.equal(await page.locator('.place.selected').getAttribute('data-id'), code[1]);
        if (['EVLE', 'EW04', 'EJ10', 'EH02'].includes(code)) {
          assert.ok((await page.locator('#detail .room-highlight').innerText()).includes(code), `Confirmed room ${code} must remain highlighted`);
        } else {
          assert.equal(await page.locator('#detail .room-highlight').count(), 0, `Unknown room ${code} must not produce a room card`);
        }
        const selected = await page.locator('.place.selected').boundingBox(), card = await page.locator('#detail').boundingBox();
        assert.ok(selected && selected.x + selected.width > 0 && selected.x < width && selected.y + selected.height > 0 && selected.y < height);
        if (name === 'mobile') assert.ok(selected.y + selected.height/2 < card.y + 3, `Selected center ${selected.y+selected.height/2} covered by card ${card.y}`);
        await closeDetail(page);
      });
    }
    await check(page, row, 'Building cards omit unknown fields while preserving confirmed information', async () => {
      const headings = () => page.locator('#detail h3').allTextContents();
      await search(page, 'EB01');
      assert.equal(await page.locator('.place.selected').getAttribute('data-id'), 'B');
      assert.equal(await page.locator('#detail .room-highlight').count(), 0);
      assert.deepEqual(await headings(), [], 'B must not display empty Salones/Servicios or unknown Pisos/Horarios');
      assert.equal(await page.locator('#detail .details-grid').count(), 0);
      await closeDetail(page);

      await search(page, 'EJ10');
      assert.deepEqual(await headings(), ['Salones', 'Servicios', 'Pisos']);
      assert.equal(await page.locator('#detail .room-list span').count(), 10);
      const industrial = await page.locator('#detail').innerText();
      for (const text of ['EJ10', '2 pisos', 'Baños']) assert.ok(industrial.includes(text), `J lost confirmed data: ${text}`);
      await closeDetail(page);

      await search(page, 'EH02');
      assert.deepEqual(await headings(), ['Salones', 'Servicios', 'Horarios']);
      const teleconferences = await page.locator('#detail').innerText();
      for (const text of ['EH02', 'Aula Magna', 'Consultorio médico', 'Lunes a viernes', '7:00 a. m.', '1:00 p. m.']) assert.ok(teleconferences.includes(text), `H lost confirmed data: ${text}`);
      await closeDetail(page);

      await search(page, 'EV01');
      assert.deepEqual(await headings(), ['Salones', 'Servicios']);
      assert.equal(await page.locator('#detail .room-highlight').count(), 0, 'EV01 remains an unconfirmed room');
      assert.deepEqual(await page.locator('#detail .room-list span').allTextContents(), ['EVLE']);
      assert.equal(await page.locator('#detail .details-grid').count(), 0);
      const laboratories = await page.locator('#detail').innerText();
      for (const text of ['Laboratorio de Mecánica', 'Laboratorio de Eléctrica']) assert.ok(laboratories.includes(text), `V lost confirmed service: ${text}`);
      assert.match(await page.locator('#detail > p').innerText(), /EVLE.*Laboratorio de Eléctrica|Laboratorio de Eléctrica.*EVLE/i, 'Description must locate EVLE inside the electrical laboratory');
      await closeDetail(page);

      await search(page, 'EW04');
      assert.deepEqual(await headings(), ['Salones', 'Servicios']);
      assert.equal(await page.locator('#detail .details-grid').count(), 0);
      const workshop = await page.locator('#detail').innerText();
      for (const text of ['EW04', 'Club de Robótica', 'Taller de máquinas']) assert.ok(workshop.includes(text), `W lost confirmed data: ${text}`);
      await closeDetail(page);
    });
    await check(page, row, 'E suggestions and keyboard selection', async () => {
      await page.locator('#search').fill('E');
      await page.locator('#suggestions [role="option"]').last().waitFor({ state: 'attached' });
      const texts = await page.locator('#suggestions [role="option"]').allTextContents();
      for (const code of ['EA01','ED01','EE01','EV01','EW01','EJ01','EH01']) assert.ok(texts.some(text=>text.includes(code)), code);
      await page.locator('#search').press('ArrowDown');
      await page.locator('#search').press('Enter');
      await page.locator('#detail').waitFor({ state: 'visible' });
      await closeDetail(page);
    });
    await check(page, row, 'Zoom controls and reset', async () => {
      await fit(page);
      const before = await page.locator('#world').getAttribute('transform');
      await page.locator('#zoom-in').click(); await settled(page);
      assert.notEqual(await page.locator('#world').getAttribute('transform'), before);
      await page.locator('#zoom-out').click(); await settled(page);
      await page.locator('#reset').click(); await settled(page);
      const reset = await page.locator('#world').getAttribute('transform');
      assert.ok(!reset || /scale\(1\)/.test(reset), reset);
    });
    await check(page, row, 'Hotspot pointer selection and card close', async () => {
      await fit(page);
      await page.locator('.place[data-id="W"]').click({ force: true });
      await page.locator('#detail').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.place.selected').getAttribute('data-id'), 'W');
      await closeDetail(page); assert.equal(await page.locator('#detail').isVisible(), false);
    });
    await check(page, row, 'Theme changes controls while preserving raster', async () => {
      const href = await page.locator('#campus-base').getAttribute('href');
      const previous = await page.locator('html').getAttribute('data-theme');
      await page.locator('#theme').click();
      assert.notEqual(await page.locator('html').getAttribute('data-theme'), previous);
      assert.equal(await page.locator('#campus-base').getAttribute('href'), href);
      assert.equal(await page.locator('#campus-base').evaluate(el=>getComputedStyle(el).filter), 'none');
      await page.locator('#theme').click();
    });
    await check(page, row, 'Favorites and recent visits persist', async () => {
      await search(page, 'EW04');
      await page.locator('#save-place').click();
      const data = await page.evaluate(() => ({ favorites:JSON.parse(localStorage.getItem('tec-favorites')||'[]'), visits:JSON.parse(localStorage.getItem('tec-visits')||'[]') }));
      assert.ok(data.favorites.some(l=>l.id==='W')); assert.ok(data.visits.some(l=>l.id==='W'));
      await closeDetail(page);
    });
    await check(page, row, 'Laboratory filter includes V', async () => {
      await page.locator('.filters button[data-filter="laboratorios"]').click();
      assert.ok((await page.locator('#collection').innerText()).includes('Mecánica'));
      assert.equal(await page.locator('.place[data-id="V"]').evaluate(el=>el.classList.contains('dimmed')), false);
      await page.locator('.filters button[data-filter="all"]').click();
    });
    await check(page, row, 'Route is shown over base and can be erased', async () => {
      await openRoute(page);
      await assertImmediatelyClickable(page, '#clear-route');
      await assertImmediatelyClickable(page, '#clear-active-route');
      assert.ok((await page.locator('.route-line').getAttribute('d')).startsWith('M'));
      const summary = await page.locator('#route-summary').innerText();
      assert.ok(/m/.test(summary) && /min/.test(summary), summary);
      await settled(page);
      await page.screenshot({path:path.join(out,`raster-${name}-route.png`),fullPage:true});
      if(name==='mobile'){
        const endpoint=await page.locator('.route-end').boundingBox(),panel=await page.locator('#route-panel').boundingBox();
        assert.ok(endpoint&&panel&&endpoint.y+endpoint.height/2<panel.y+2,`Route destination is hidden by the bottom card: endpoint=${JSON.stringify(endpoint)}, panel=${JSON.stringify(panel)}`);
      }
      await page.locator('#clear-route').click();
      await assertRouteRemoved(page);
      await fit(page);
    });
    await check(page, row, 'Closing the route card removes the route and markers', async () => {
      await openRoute(page);
      await page.locator('#route-panel .close').click();
      await assertRouteRemoved(page);
    });
    await check(page, row, 'Quitar ruta remains reachable after selecting another building', async () => {
      await openRoute(page);
      await search(page, 'EW04');
      assert.equal(await page.locator('#route-panel').isVisible(), false);
      assert.equal(await page.locator('.route-line').count(), 1);
      await assertImmediatelyClickable(page, '#clear-active-route');
      await page.locator('#clear-active-route').click();
      await assertRouteRemoved(page);
      await closeDetail(page);
    });
    await check(page, row, 'Escape respects search editing and removes the route from the map', async () => {
      await openRoute(page);
      await page.locator('#search').focus();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.route-line').count(), 1, 'Escape while editing search must not erase the route');
      await page.locator('#reset').focus();
      await page.keyboard.press('Escape');
      await assertRouteRemoved(page);
    });
    await check(page, row, 'No console or page errors', async () => { assert.deepEqual(consoleErrors,[]);assert.deepEqual(pageErrors,[]);assert.deepEqual(failedRequests,[]); });
  } catch (error) {
    report.failures.push({viewport:name,name:'Setup or fatal',error:error.stack||String(error)});
    try {await page.screenshot({path:path.join(out,`raster-${name}-failure.png`),fullPage:true});}catch{}
  } finally { await context.close(); }
}
await browser.close();
try {
  report.imageComparison=JSON.parse(execFileSync(process.env.PYTHON||'python3',['-c',String.raw`
import json,sys,hashlib,urllib.request
from pathlib import Path
from PIL import Image,ImageDraw,ImageColor,ImageChops,ImageFont,ImageFilter
import numpy as np
root=Path(sys.argv[1]);metadata=json.loads((root/'assets/mapa-campus-base.json').read_text())
source_path=root/'work/source-research/mapa-chatbot.png'
if not source_path.exists():
    source_path.parent.mkdir(parents=True,exist_ok=True)
    with urllib.request.urlopen(metadata['source']['url'],timeout=40)as response:source_path.write_bytes(response.read())
assert hashlib.sha256(source_path.read_bytes()).hexdigest()==metadata['source']['sha256']
original=Image.open(source_path).convert('RGB')
reference=original.crop(metadata['crop']).convert('RGBA')
alpha=Image.new('L',reference.size,0)
ImageDraw.Draw(alpha).polygon([(round(x*metadata['pixelsPerSvgUnit']),round(y*metadata['pixelsPerSvgUnit']))for x,y in metadata['clip']],fill=255)
reference.putalpha(alpha)
asset=Image.open(root/'assets'/metadata['image']).convert('RGBA')
visible=np.asarray(alpha)>0
pixel_difference=np.any(np.asarray(asset)[visible]!=np.asarray(reference)[visible],axis=1)
assert not pixel_difference.any(),'Asset differs from the visible original crop'
rows=[]
for viewport in ['desktop','mobile']:
    capture=root/'tests/screenshots'/f'raster-{viewport}-base.png'
    if not capture.exists():continue
    actual=Image.open(capture).convert('RGB')
    resized=reference.resize(actual.size,Image.Resampling.LANCZOS)
    # The raster layer is rendered on the page's white map surface. Transparent
    # right-side whitespace is not part of the campus comparison.
    expected=Image.new('RGBA',actual.size,'white');expected.alpha_composite(resized);expected=expected.convert('RGB')
    mask=np.asarray(resized.getchannel('A'))>254
    # Exclude alpha edges and the screenshot border from resampling statistics.
    mask=np.asarray(resized.getchannel('A').filter(ImageFilter.MinFilter(7)))>254;mask[:3]=False;mask[-3:]=False;mask[:,:3]=False;mask[:,-3:]=False
    diff=np.abs(np.asarray(actual,dtype=np.int16)-np.asarray(expected,dtype=np.int16))
    mae=float(diff[mask].mean())if mask.any()else None
    w,h=actual.size;comparison=Image.new('RGB',(w*2,h+35),'#ffffff');comparison.paste(expected,(0,35));comparison.paste(actual,(w,35))
    draw=ImageDraw.Draw(comparison);draw.text((10,9),'Original: recorte sin redibujar',fill='black');draw.text((w+10,9),'Captura real del navegador',fill='black')
    comparison.save(root/'tests/screenshots'/f'raster-comparison-{viewport}.png')
    rows.append({'viewport':viewport,'width':w,'height':h,'renderMeanAbsoluteError':mae})
print(json.dumps({'sourceSha256':metadata['source']['sha256'],'visibleAssetPixelDifferences':int(pixel_difference.sum()),'campusPixelsRemoved':metadata['campusPixelsRemoved'],'renderComparisons':rows}))
`,root],{encoding:'utf8'}));
} catch(error) { report.failures.push({name:'Independent source-pixel comparison',error:error.stack||String(error)}); }
report.finished = new Date().toISOString();
await writeFile(path.join(root,'work/qa-raster-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(report.failures.length) process.exitCode=1;
