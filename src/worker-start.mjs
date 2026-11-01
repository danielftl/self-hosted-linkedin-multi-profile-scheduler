import { runWorker } from './worker.mjs';
const controller=new AbortController();
for(const event of ['SIGINT','SIGTERM']) process.once(event,()=>controller.abort());
await runWorker({signal:controller.signal});
