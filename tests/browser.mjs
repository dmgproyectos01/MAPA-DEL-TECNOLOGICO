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


const floorContents = {
  'planta-baja': ['6 salones', '1 salón con computadoras', 'Laboratorio de Mecatrónica', 'Baños'],
  'planta-alta': ['3 salones', '1 salón con computadoras', 'Oficinas administrativas', 'Baños'],
  'primer-piso': [
    'Laboratorio de Instrumentación y Procesamiento de Señales',
    'Laboratorio de Microbiología de Alimentos y Biología Molecular',
    'Laboratorio de Bioprocesos y Análisis Ambientales',
    'Aula UP-15',
    'Laboratorio de Microbiología Molecular y Bioactivos',
    'Laboratorio de Posgrado e Investigación en Ciencias Ambientales',
    'Laboratorio de Cromatografía y Espectrometría',
    'Baños'
  ],
  'segundo-piso': ['8 salones', 'Incubadora de Software', 'Área de Calidad', 'Baños'],
  'tercer-piso': [
    'Cubículo de la Dra. Flor de la Cruz Saida Lizárraga',
    'Cubículo de la Dra. Carmen Guadalupe López Varela',
    'Cubículo del Dr. José Fernando Hernández Silva',
    'Cubículo del Dr. Leonel Ernesto Amabilis Sosa',
    'Cubículo del Dr. Modesto Guadalupe Medina Meléndrez',
    'Cubículo de la Dra. Yaneth Alejandra Bustos Terrones',
    'Cubículo del Dr. David Enrique Castro Palazuelos',
    'Cubículo de la Dra. Blenda Ramírez Pereda',
    'Cubículo del Dr. Guillermo Javier Rubio Astorga',
    '4 salones', 'Sala de Usos Múltiples', 'Oficinas DEPI'
  ]
};
async function assertFloor(page, level) {
  const active = page.locator('#detail .floor-tabs[role="tablist"] [role="tab"][aria-selected="true"]');
  assert.equal(await active.count(), 1);
  assert.equal(await active.getAttribute('data-level'), level);
  assert.equal(await page.locator('#detail .floor-panel[role="tabpanel"]').count(), 1);
  const items = await page.locator('#detail .floor-panel .floor-items li').allTextContents();
  assert.equal(items.length, floorContents[level].length, `Incorrect ${level} item count`);
  floorContents[level].forEach((name, i) => assert.ok(items[i].includes(name), `${level} item ${i}: missing full name ${name}`));
  if (level === 'primer-piso') assert.match(items[3], /computadoras/i, 'UP-15 must retain its computer-room description');
  const roomCodes = (await page.locator('#detail').innerText()).match(/\b(?:UA|UP)-?\d+\b/g) || [];
  assert.ok(roomCodes.every(code => code === 'UP-15'), `Invented classroom codes: ${roomCodes}`);
  const layout = await page.locator('#detail').evaluate(card => ({
    overflow: card.scrollWidth > card.clientWidth + 1,
    itemOverflow: [...card.querySelectorAll('.floor-panel,.floor-items li')].some(el => el.scrollWidth > el.clientWidth + 1),
    pageOverflow: document.documentElement.scrollWidth > innerWidth + 1
  }));
  assert.deepEqual(layout, { overflow: false, itemOverflow: false, pageOverflow: false }, 'Full floor names must wrap inside the card');
}
async function assertSearchFloor(page, query, id, level, match) {
  await search(page, query);
  assert.equal(await page.locator('.place.selected').getAttribute('data-id'), id);
  await assertFloor(page, level);
  const item = page.locator('#detail .floor-item.is-match');
  assert.equal(await item.count(), 1, `${query} should highlight one matching floor item`);
  assert.ok((await item.innerText()).includes(match), `Wrong floor item for ${query}`);
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
    await check(page, row, 'UA pointer selection shows both confirmed floor inventories and keyboard tabs', async () => {
      await fit(page);
      await page.locator('.place[data-id="6"]').click();
      await page.locator('#detail').waitFor({ state: 'visible' });
      await settled(page);
      assert.equal(await page.locator('.place.selected').getAttribute('data-id'), '6');
      assert.deepEqual(await page.locator('#detail .floor-tabs [role="tab"]').evaluateAll(tabs => tabs.map(tab => tab.dataset.level)), ['planta-baja', 'planta-alta']);
      await assertFloor(page, 'planta-baja');
      await page.screenshot({path:path.join(out,`raster-${name}-ua.png`),fullPage:true});
      const lower = page.locator('#detail [role="tab"][data-level="planta-baja"]');
      await lower.focus(); await page.keyboard.press('ArrowRight');
      await assertFloor(page, 'planta-alta');
      assert.equal(await page.locator('#detail [role="tab"]:focus').getAttribute('data-level'), 'planta-alta');
      await page.keyboard.press('Home'); await assertFloor(page, 'planta-baja');
      await page.keyboard.press('End'); await assertFloor(page, 'planta-alta');
      await page.keyboard.press('ArrowLeft'); await assertFloor(page, 'planta-baja');
      await closeDetail(page);
      for (const filter of ['salones', 'laboratorios', 'administracion']) {
        await page.locator(`.filters button[data-filter="${filter}"]`).click();
        for (const id of ['6', '7']) assert.equal(await page.locator(`.place[data-id="${id}"]`).evaluate(el => el.classList.contains('dimmed')), false, `${filter} must include the confirmed spaces in ${id}`);
      }
      await page.locator('.filters button[data-filter="all"]').click();
    });
    await check(page, row, 'UP pointer selection preserves all three floors and scrollable complete names', async () => {
      await fit(page);
      await page.locator('.place[data-id="7"]').click();
      await page.locator('#detail').waitFor({ state: 'visible' });
      await settled(page);
      assert.equal(await page.locator('.place.selected').getAttribute('data-id'), '7');
      assert.deepEqual(await page.locator('#detail .floor-tabs [role="tab"]').evaluateAll(tabs => tabs.map(tab => tab.dataset.level)), ['primer-piso', 'segundo-piso', 'tercer-piso']);
      await assertFloor(page, 'primer-piso');
      await page.locator('#detail [role="tab"][data-level="segundo-piso"]').click();
      await assertFloor(page, 'segundo-piso');
      await page.locator('#detail [role="tab"][data-level="tercer-piso"]').click();
      await assertFloor(page, 'tercer-piso');
      await page.screenshot({path:path.join(out,`raster-${name}-up.png`),fullPage:true});
      const panel = page.locator('#detail .floor-panel');
      await panel.locator('.floor-items li').last().scrollIntoViewIfNeeded();
      const scroll = await panel.evaluate(el => ({top:el.scrollTop,height:el.clientHeight,total:el.scrollHeight}));
      assert.ok(scroll.top > 0 && scroll.total > scroll.height, `Third-floor list must scroll: ${JSON.stringify(scroll)}`);
      assert.ok((await panel.locator('.floor-items li').last().innerText()).includes('Oficinas DEPI'));
      for (const selector of ['#detail .close', '#detail #save-place']) {
        assert.ok(await page.locator(selector).evaluate(el => { const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.y>=0&&r.bottom<=innerHeight&&!!hit&&(hit===el||el.contains(hit)); }), `${selector} became inaccessible after list scroll`);
      }
      await page.locator('#detail [role="tab"][data-level="tercer-piso"]').focus();
      await page.keyboard.press('Home'); await assertFloor(page, 'primer-piso');
      await page.keyboard.press('ArrowRight'); await assertFloor(page, 'segundo-piso');
      await page.keyboard.press('End'); await assertFloor(page, 'tercer-piso');
      await closeDetail(page);
      assert.equal(await page.locator('#detail').isVisible(), false);
    });
    await check(page, row, 'Floor-item searches select the matching UA or UP level', async () => {
      await fit(page);
      for (const [query,id,level,match] of [
        ['UP-15','7','primer-piso','Aula UP-15'],
        ['Laboratorio de Mecatrónica','6','planta-baja','Laboratorio de Mecatrónica'],
        ['Laboratorio de Instrumentación y Procesamiento de Señales','7','primer-piso','Laboratorio de Instrumentación y Procesamiento de Señales'],
        ['Incubadora de Software','7','segundo-piso','Incubadora de Software'],
        ['Saida Lizárraga','7','tercer-piso','Cubículo de la Dra. Flor de la Cruz Saida Lizárraga'],
        ['DEPI','7','tercer-piso','Oficinas DEPI']
      ]) { await assertSearchFloor(page,query,id,level,match); await closeDetail(page); }
    });
    await check(page, row, 'Recent professor search restores the matching third-floor cubicle', async () => {
      await assertSearchFloor(page,'Saida Lizárraga','7','tercer-piso','Cubículo de la Dra. Flor de la Cruz Saida Lizárraga');
      await closeDetail(page);
      await page.locator('#search').fill('');
      await page.locator('#search').focus();
      const recent=page.locator('#suggestions [role="option"]').filter({hasText:'Saida Lizárraga'}).first();
      await recent.waitFor({state:'visible'});
      await recent.click();
      await page.locator('#detail').waitFor({state:'visible'});
      await assertFloor(page,'tercer-piso');
      assert.equal(await page.locator('.place.selected').getAttribute('data-id'),'7');
      assert.ok((await page.locator('#detail .floor-item.is-match').innerText()).includes('Saida Lizárraga'));
      await closeDetail(page);
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
    await check(page, row, 'Events opens and closes without blocking the map or inventing publication', async () => {
      const launcher=page.locator('#open-events');
      await launcher.waitFor({state:'visible'});
      await page.waitForFunction(() => !document.querySelector('#open-events').disabled);
      const transform=await page.locator('#world').getAttribute('transform');
      const configResponse=await page.request.get(new URL('data/events-config.json?v=native-v1',target).href);
      assert.ok(configResponse.ok());
      const config=await configResponse.json(),configured=Boolean(config.url&&config.publishableKey);
      const backendOrigin=configured?new URL(config.url).origin:null,mutations=[];
      const observe=request=>{
        const url=new URL(request.url());
        if(url.origin===backendOrigin&&!['GET','HEAD','OPTIONS'].includes(request.method())&&(/^\/(rest|auth|functions)\/v1\//.test(url.pathname)||url.pathname.startsWith('/storage/v1/object/')&&!url.pathname.startsWith('/storage/v1/object/sign/')))mutations.push({method:request.method(),path:url.pathname});
      };
      page.on('request',observe);
      let publicReadStatus,publishedCount,nativeReadiness;
      try{
        if(configured){
          const [response]=await Promise.all([
            page.waitForResponse(response=>{const url=new URL(response.url());return url.origin===backendOrigin&&url.pathname==='/rest/v1/campus_events'&&url.searchParams.get('status')==='eq.published'&&response.request().method()==='GET';}),
            launcher.click()
          ]);
          assert.ok(response.ok(),`Public events read returned HTTP ${response.status()}`);
          const published=await response.json();
          assert.ok(Array.isArray(published),'The public gallery must read an event array');
          assert.ok(published.every(event=>event.status==='published'),'The public response must contain only published events');
          publicReadStatus=response.status();publishedCount=published.length;
        }else await launcher.click();
        await page.locator('#events-dialog').waitFor({state:'visible'});
        assert.equal(await page.locator('#events-dialog').evaluate(el=>el.open),true);
        await page.waitForFunction(()=>document.querySelector('#events-gallery')?.getAttribute('aria-busy')==='false');
        if(configured){
          assert.equal(await page.locator('#events-gallery [data-event-id]').count(),publishedCount);
          if(!publishedCount)assert.equal(await page.locator('#events-gallery .events-empty h3').innerText(),'No hay eventos publicados.');
        }
        await page.screenshot({path:path.join(out,`events-${name}-published-gallery.png`),fullPage:true});
        await page.locator('#events-manage').click();
        if(configured){
          await page.locator('#events-login-form').waitFor({state:'visible'});
          assert.equal(await page.locator('#events-new-event,#events-editor-form').count(),0,'A public visitor must not open the publisher');
          if(config.nativeLive?.enabled&&new URL(target).origin==='https://dmgproyectos01.github.io'){
            // Public production checks use no user token, password or media.
            // Authentication must reject start before any room can be reserved.
            const endpoint=new URL('/functions/v1/'+config.nativeLive.functionName,config.url).href;
            const origin=new URL(target).origin,headers={Origin:origin,apikey:config.publishableKey,'Content-Type':'application/json'};
            const preflight=await page.request.fetch(endpoint,{method:'OPTIONS',headers:{...headers,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'apikey,authorization,content-type'}});
            assert.equal(preflight.status(),204,'Native server configuration must accept production preflight');
            assert.equal(preflight.headers()['access-control-allow-origin'],origin);
            const expected=[['start',401,'AUTH_REQUIRED'],['view',404,'STREAM_UNAVAILABLE']];
            const statuses={};
            for(const[action,status,code]of expected){
              const response=await page.request.post(endpoint,{headers,data:{action,eventId:'00000000-0000-4000-8000-000000000000'}});
              const body=await response.json();
              assert.equal(response.status(),status,`Native public ${action} must return ${code}`);
              assert.equal(body.error?.code,code);
              assert.deepEqual(Object.keys(body),['error'],'Public denial must not return connection credentials');
              assert.deepEqual(Object.keys(body.error).sort(),['code','message']);
              assert.equal(response.headers()['access-control-allow-origin'],origin);
              assert.equal(response.headers()['cache-control'],'no-store');
              statuses[action]={status,code,tokenIssued:false};
            }
            const denied=await page.request.post(endpoint,{headers:{...headers,Origin:'https://invalid.example'},data:{action:'view',eventId:'00000000-0000-4000-8000-000000000000'}});
            assert.equal(denied.status(),403);
            assert.equal((await denied.json()).error?.code,'ORIGIN_DENIED');
            assert.equal(denied.headers()['access-control-allow-origin'],undefined);
            nativeReadiness={preflight:204,publicStart:statuses.start,unavailableView:statuses.view,foreignOrigin:403,providerCredentials:'A signed-in production broadcast must still verify the LiveKit key pair'};
          }
        }else{
          assert.ok((await page.locator('#events-gallery-feedback').innerText()).includes('La publicación de eventos todavía no está habilitada.'));
          assert.equal(await page.locator('#events-login-form').count(),0);
        }
        await page.keyboard.press('Escape');
        await page.locator('#events-dialog').waitFor({state:'hidden'});
        assert.equal(await launcher.evaluate(el=>document.activeElement===el),true);
        assert.equal(await page.locator('#world').getAttribute('transform'),transform);
        assert.deepEqual(mutations,[],'Public gallery verification must never write to the backend');
      }finally{page.off('request',observe);}
      await search(page,'EH02');
      assert.equal(await page.locator('.place.selected').getAttribute('data-id'),'H');
      await closeDetail(page);
      return{eventsConfigured:configured,...(configured?{publicReadStatus,publishedCount}:{}),...(nativeReadiness?{nativeReadiness}:{}),backendMutations:mutations.length};
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
