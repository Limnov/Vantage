/** Explicit opt-in fixture: never imports operational data or provider credentials. */
const bcrypt = require('bcrypt');
const { sqlite, closeAll } = require('../src/db');
async function seedDemo() {
  const hash = await bcrypt.hash('demo', 10);
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    let user = sqlite.prepare("SELECT id FROM users WHERE username = 'demo'").get();
    const existing = user && sqlite.prepare('SELECT org_id FROM demo_accounts WHERE user_id = ?').get(user.id);
    if (user && !existing) throw new Error('Username demo belongs to a regular account; refusing to overwrite it.');
    if (existing) {
      // Upgrade only old demo fixture shapes; leave normal tenant records alone.
      sqlite.prepare("UPDATE agent_steps SET output_json=json_object('ok',json('true'),'data',json(output_json)) WHERE run_id IN (SELECT id FROM agent_runs WHERE org_id=?) AND json_extract(output_json,'$.demo')=1 AND json_extract(output_json,'$.ok') IS NULL").run(existing.org_id);
      sqlite.prepare("UPDATE alerts SET level=CASE level WHEN 'high' THEN 'critical' WHEN 'medium' THEN 'warning' ELSE level END WHERE org_id=?").run(existing.org_id);
      sqlite.exec('COMMIT'); return { userId: user.id, orgId: existing.org_id, created: false };
    }
    if (sqlite.prepare("SELECT id FROM organizations WHERE slug = 'vantage-demo'").get()) throw new Error('Demo organization slug already exists; refusing to overwrite it.');
    const orgId = Number(sqlite.prepare("INSERT INTO organizations (name, slug, description) VALUES ('Vantage 演示空间', 'vantage-demo', '独立只读示例，所有市场信息均为虚构演示数据')").run().lastInsertRowid);
    const userId = Number(sqlite.prepare("INSERT INTO users (username,email,password_hash,display_name) VALUES ('demo','demo@vantage.invalid',?,'Demo 访客')").run(hash).lastInsertRowid);
    sqlite.prepare("INSERT INTO org_members (org_id,user_id,role) VALUES (?,?,'viewer')").run(orgId,userId);
    sqlite.prepare('INSERT INTO demo_accounts (user_id,org_id) VALUES (?,?)').run(userId,orgId);
    const topics = [
      ['东南亚消费电子', 'opportunity', '示例：轻量化配件关注度提升', '示例资料显示便携配件需求出现变化，建议进一步验证渠道与用户反馈。'],
      ['欧洲智能家居', 'risk', '示例：渠道价格竞争加剧', '示例场景中同类产品定价趋同，需要持续关注毛利与差异化。'],
      ['北美户外装备', 'neutral', '示例：季节性需求观察', '这是季节性需求监控的展示样本，不构成真实市场判断。'],
      ['跨境物流', 'risk', '示例：履约时效波动', '示例物流时效出现波动，建议在实际业务中核实承运商公告。'],
    ];
    for (const [i, [name, signal, title, summary]] of topics.entries()) {
      const watchId = Number(sqlite.prepare("INSERT INTO watchlist (org_id,owner_id,name,type,query,category,tags,enabled,last_status,last_run_at,meta) VALUES (?,?,?,'topic',?,'示例市场研究',?,0,'success',datetime('now'),?)").run(orgId,userId, name+' · 示例', name, JSON.stringify(['Demo','示例']),JSON.stringify({demo:true})).lastInsertRowid);
      let latestReport;
      for (let day=6;day>=0;day--) {
        latestReport = Number(sqlite.prepare("INSERT INTO reports (org_id,watchlist_id,title,query,summary,key_points,signal_type,sources,raw_data,report_date,created_at) VALUES (?,?,?,?,?,?,?,?,?,date('now',?),datetime('now',?))").run(orgId,watchId,title,name,summary,JSON.stringify(['全部内容为演示样本，请勿作为业务依据。','实际产品可保留来源、持续监控并审批后发送通知。']),signal,'[]',JSON.stringify({demo:true}),`-${day} days`,`-${day} days`).lastInsertRowid);
      }
      sqlite.prepare("INSERT INTO alerts (org_id,watchlist_id,report_id,level,type,title,message,status) VALUES (?,?,?,?,?,?,?,'pending')").run(orgId,watchId,latestReport,signal==='risk'?'critical':signal==='opportunity'?'warning':'info',signal,title,summary+'（未发送任何真实通知）');
      const runId = `demo-research-${i+1}`;
      const result = {title,summary,answer:summary+'\n\n这是预置的示例执行记录。演示账号不调用 AI 或搜索服务。',key_points:['查看示例报告和监控目标','真实执行需使用自己的正式账号配置服务'],confidence:'low',sources:[],evidence_ids:[],report_id:latestReport};
      sqlite.prepare("INSERT INTO agent_runs (id,org_id,user_id,goal,status,current_phase,step_count,report_id,result_json,metadata,completed_at) VALUES (?,?,?,?,'completed','completed',1,?,?,?,datetime('now'))").run(runId,orgId,userId,`示例：研究${name}的市场变化`,latestReport,JSON.stringify(result),JSON.stringify({demo:true,conversation_id:runId}));
      sqlite.prepare("INSERT INTO agent_steps (run_id,step_no,kind,name,input_json,output_json) VALUES (?,1,'tool','list_reports',?,?)").run(runId,JSON.stringify({demo:true}),JSON.stringify({ok:true,data:{items:[{id:latestReport,title,summary}],total:1,demo:true}}));
      sqlite.prepare('UPDATE reports SET agent_run_id = ? WHERE id = ?').run(runId,latestReport);
    }
    sqlite.exec('COMMIT');
    return {userId,orgId,created:true};
  } catch(error) { sqlite.exec('ROLLBACK'); throw error; }
}
if (require.main === module) seedDemo().then(result => console.log('Demo seeded:',result)).finally(closeAll).catch(error=>{ console.error(error.message); process.exitCode=1; });
module.exports = {seedDemo};
