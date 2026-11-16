import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve('.'),port=Number((process.argv.includes('--port')?process.argv[process.argv.indexOf('--port')+1]:null)||process.env.PORT||3000),mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+sep))throw Error();const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(404);res.end('No encontrado');}}).listen(port,'0.0.0.0',()=>console.log(`Campus disponible en http://localhost:${port}`));
