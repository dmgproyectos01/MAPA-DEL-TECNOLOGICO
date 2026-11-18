import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const runtimePlaywright = '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js';
let playwright;
try {playwright = await import('playwright');} catch (error) {if (!existsSync(runtimePlaywright)) throw error; playwright = await import(runtimePlaywright);}
const {chromium} = playwright.chromium ? playwright : playwright.default;
const executablePath = process.env.CAMPUS_CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({...(executablePath ? {executablePath} : {}), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
try {
  for (const viewport of [{width: 1366, height: 900}, {width: 390, height: 844}]) {
    const page = await browser.newPage({viewport});
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.CAMPUS_QA_URL || 'http://127.0.0.1:3000/');
    const launcher = page.locator('#open-student-services'), dialog = page.locator('#student-services-dialog');
    await launcher.click(); await dialog.waitFor({state: 'visible'});
    await page.locator('#student-services-search').fill('Alma Lorena');
    const lorena = page.locator('[data-service-id="psicologia-lorena"]');
    assert.equal(await dialog.locator('.student-service').count(), 1);
    await lorena.locator('summary').click();
    assert.match(await lorena.innerText(), /Desarrollo Académico/);
    assert.match(await lorena.innerText(), /activo o vigente/);
    assert.equal(await lorena.locator('a').getAttribute('href'), 'https://psicologa-lorena.youcanbook.me/');
    assert.equal(await lorena.getByRole('button', {name: 'Ver en el mapa'}).count(), 0);
    await page.screenshot({path: `/tmp/servicios-${viewport.width}.png`});
    await page.locator('#student-services-search').fill('evaluacion vocacional');
    await page.locator('[data-service-id="evaluacion-vocacional"] summary').click();
    assert.match(await dialog.innerText(), /coordinación de la carrera de destino/);
    assert.match(await dialog.locator('[data-service-id="evaluacion-vocacional"] a').getAttribute('href'), /itculiacanedu.sharepoint.com/);
    await page.locator('#student-services-search').fill('kardex');
    const escolar = dialog.locator('[data-service-id="control-escolar"]');
    await escolar.locator('summary').click();
    assert.match(await escolar.innerText(), /08:00 a 18:00/);
    assert.match(await escolar.innerText(), /Consultado el/);
    assert.equal(await escolar.locator('a').first().getAttribute('href'), 'https://www.culiacan.tecnm.mx/control-escolar/');
    await page.locator('#student-services-search').fill('');
    await dialog.getByRole('button', {name: 'Bienestar', exact: true}).click();
    assert.equal(await dialog.locator('[data-service-id="control-escolar"]').count(), 0);
    assert.ok(await dialog.locator('[data-service-id="seguro-thona"]').count());
    await dialog.getByRole('button', {name: 'Todos', exact: true}).click();
    await page.locator('#student-services-search').fill('sin-coincidencias');
    assert.match(await dialog.innerText(), /No encontramos ese servicio/);
    await page.keyboard.press('Escape'); await dialog.waitFor({state: 'hidden'});
    assert.equal(await launcher.evaluate(el => document.activeElement === el), true);
    await page.locator('#search').fill('Alma Lorena'); await page.locator('#suggestion-0').click();
    assert.match(await page.locator('#detail').innerText(), /Desarrollo Académico/);
    await page.getByRole('button', {name: 'Ver información del servicio'}).click();
    await dialog.waitFor({state: 'visible'});
    assert.equal(await lorena.getAttribute('open'), '');
    await dialog.getByRole('button', {name: 'Cerrar servicios'}).click();
    await launcher.click(); await page.locator('#student-services-search').fill('biblioteca');
    await page.locator('[data-service-id="biblioteca"] summary').click();
    await dialog.getByRole('button', {name: 'Ver en el mapa'}).click();
    assert.match(await page.locator('#detail h2').innerText(), /Biblioteca/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log(`PASS servicios ${viewport.width}×${viewport.height}: búsqueda, citas, ubicación, ficha, teclado y navegación.`);
    await page.close();
  }
} finally {await browser.close();}
