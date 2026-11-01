import { createApp } from './server.mjs';
const {server,store}=createApp();
server.listen(Number(process.env.PORT || 3000),'127.0.0.1',()=>console.log('Scheduler web server listening'));
for(const event of ['SIGINT','SIGTERM']) process.once(event,()=>server.close(()=>{store.close();process.exit(0);}));
