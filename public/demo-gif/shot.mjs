import {createRequire} from 'module';
const r=createRequire(process.env.HOME+'/.local/lib/node_modules/@playwright/cli/node_modules/');
const {chromium}=r('playwright-core');
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:+process.argv[3]||1000,height:+process.argv[4]||600}});
await p.goto('file://'+process.argv[2]);
await p.screenshot({path:process.argv[2].replace(/\.html$/,'.png')});
await b.close();
