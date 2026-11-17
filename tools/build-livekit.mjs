import {build} from 'esbuild';
import {mkdir, readFile, writeFile, copyFile, readdir} from 'node:fs/promises';
import {resolve, dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'vendor/livekit-client.esm.js');
const sdk = JSON.parse(await readFile(resolve(root, 'node_modules/livekit-client/package.json'), 'utf8'));
if (sdk.version !== '2.24.1') throw new Error('Install the pinned livekit-client@2.24.1 before building.');
await mkdir(dirname(output), {recursive: true});
const result = await build({
  absWorkingDir: root,
  stdin: {contents: 'export {Room, RoomEvent, Track, TrackEvent, VideoPresets, createLocalTracks, createLocalVideoTrack, setLogLevel} from "livekit-client";', resolveDir: root, sourcefile: 'campus-livekit-entry.js'},
  bundle: true, format: 'esm', platform: 'browser', target: ['es2020'], minify: true,
  legalComments: 'external', metafile: true, outfile: output,
  banner: {js: '/*! LiveKit Client 2.24.1; rebundled and minified for the campus static application. Original dependency licenses: ./livekit-licenses/NOTICE.txt */'}
});
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes('node_modules/')) continue;
  let path = dirname(resolve(root, input));
  while (path.startsWith(resolve(root, 'node_modules'))) {
    try {await readFile(resolve(path, 'package.json')); packages.add(path); break;} catch {}
    path = dirname(path);
  }
}
// The published SDK is itself a bundle; retain its declared runtime dependency
// licenses too, even when esbuild sees only the SDK's prebundled ESM file.
async function includeDependencies(path) {
  if (packages.has(path + ':visited')) return;
  packages.add(path + ':visited');
  const pkg = JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8'));
  for (const dependency of Object.keys(pkg.dependencies || {})) {
    const candidate = resolve(root, 'node_modules', dependency);
    try {await readFile(resolve(candidate, 'package.json')); packages.add(candidate); await includeDependencies(candidate);} catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
}
await includeDependencies(resolve(root, 'node_modules/livekit-client'));
for (const path of [...packages]) if (path.endsWith(':visited')) packages.delete(path);
const licenseRoot = resolve(root, 'vendor/livekit-licenses');
await mkdir(licenseRoot, {recursive: true});
const notices = [`LiveKit SDK ${sdk.version} rebundled/minified for the campus application.`, 'No provider credentials are included. Sources and license texts follow.', ''];
for (const path of [...packages].sort()) {
  const pkg = JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8'));
  const name = `${pkg.name.replace(/\//g, '__')}@${pkg.version}`;
  const folder = resolve(licenseRoot, name);
  await mkdir(folder, {recursive: true});
  const files = (await readdir(path)).filter(file => /^(license|licence|copying|notice)(\.|$)/i.test(file));
  for (const file of files) await copyFile(resolve(path, file), resolve(folder, file));
  notices.push(`${pkg.name}@${pkg.version} — ${typeof pkg.license === 'string' ? pkg.license : 'See package license'}`, `Source: ${typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || pkg.homepage || 'https://www.npmjs.com/package/' + pkg.name}`, `Included license files: ${files.length ? name + '/' + files.join(', ') : 'license declared in package manifest'}`, '');
  await writeFile(resolve(folder, 'package-attribution.json'), JSON.stringify({name: pkg.name, version: pkg.version, license: pkg.license, repository: pkg.repository, homepage: pkg.homepage}, null, 2) + '\n');
}
await writeFile(resolve(licenseRoot, 'NOTICE.txt'), notices.join('\n'));
console.log(`Built ${relative(root, output)} (${(await readFile(output)).byteLength} bytes); retained ${packages.size} dependency license notices.`);
