import {Hono} from 'hono';
const app=new Hono();
app.use('*',async(c,next)=>{await next();c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','strict-origin-when-cross-origin');c.header('X-Frame-Options','DENY');});
app.get('/health',c=>c.json({status:'showcase_ready',service:'Vantage',showcase:true,demo:true,product:false,reason:'awaiting_workers_paid_activation'}));
app.all('/api/*',c=>c.json({error:'product_pending_activation',message:'正式产品等待云端运行配置完成，当前可体验独立 Demo'},503));
app.all('/mcp',c=>c.json({error:'product_pending_activation'},503));
app.get('*',c=>{
 const path=c.req.path;
 if(path==='/'||path==='/demo'||path.startsWith('/assets/')||['/vantage-logo.png','/vantage-logo-white.png','/robots.txt','/sitemap.xml'].includes(path))return c.env.ASSETS.fetch(c.req.raw);
 c.header('Retry-After','3600');c.header('X-Robots-Tag','noindex');
 return c.html(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vantage · 产品准备中</title><style>body{margin:0;background:#f3efe6;color:#24221e;font:16px/1.7 system-ui,sans-serif}main{max-width:650px;margin:16vh auto;padding:32px}h1{font-size:44px;letter-spacing:-1px}p{color:#716959}a{display:inline-block;margin:20px 12px 0 0;padding:12px 22px;border-radius:6px;border:1px solid #d4cdbf;color:inherit;text-decoration:none}a:first-of-type{background:#24221e;color:#fffdf8}</style></head><body><main><strong>Vantage</strong><h1>正式工作台准备中。</h1><p>展示页和 Demo 已开放。正式产品正在完成云端运行配置，暂不提供登录与真实任务执行。</p><a href="/demo">体验独立 Demo →</a><a href="/">了解产品</a></main></body></html>`,503);
});
export default app;
