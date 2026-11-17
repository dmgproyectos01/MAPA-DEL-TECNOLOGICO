import { createLiveHandler } from '../_shared/campus-live.js';
Deno.serve(createLiveHandler({ env: Deno.env }));
