/** Explicit opt-in fixture: never imports operational data or provider credentials. */
const bcrypt = require('bcrypt');
const { sqlite, closeAll } = require('../src/db');

const FORECAST_SAMPLE_TITLE = '[示例] 美国手机配件 30 天情景判断';

/** 演示用的情景判断样本：一条已回评、一条待回评。全部为虚构演示数据。 */
function ensureDemoForecast(orgId, userId) {
  const existing = sqlite.prepare('SELECT id FROM reports WHERE org_id = ? AND title = ?').get(orgId, FORECAST_SAMPLE_TITLE);
  if (existing) return existing.id;

  const question = '美国手机配件市场未来 30 天的新品与合规走向';
  const generatedAt = new Date(Date.now() - 60 * 86400000).toISOString();
  const validUntil = new Date(Date.now() - 30 * 86400000).toISOString();
  const forecast = {
    status: 'scenario',
    question,
    horizon_days: 30,
    generated_at: generatedAt,
    valid_until: validUntil,
    baseline: '新品线索维持当前节奏，合规通报零星出现',
    upside: '更多零售渠道同步上架新品，关注度上行',
    downside: '安全通报增多导致渠道收紧上架',
    assumptions: ['主要渠道保持稳定', '公开来源持续更新'],
    watch_signals: ['新品上架公告', '安全通报'],
    invalidation: '主要渠道停止上架或出现大规模召回',
    confidence: 'low',
    method: '基于公开信号的情景判断，非统计概率预测',
    basis_evidence_ids: ['page_demo_a', 'page_demo_b'],
    evaluation_status: 'pending'
  };
  const evidence = [
    { evidence_id: 'page_demo_a', title: '示例：渠道新品公告（虚构）', url: 'https://example.com/demo/new-product', evidence_level: 'fulltext', published_date: generatedAt.slice(0, 10) },
    { evidence_id: 'page_demo_b', title: '示例：合规通报（虚构）', url: 'https://example.com/demo/notice', evidence_level: 'fulltext', published_date: generatedAt.slice(0, 10) }
  ];
  const runId = 'demo-forecast-1';
  const result = {
    title: FORECAST_SAMPLE_TITLE,
    summary: '示例情景判断：新品线索维持当前节奏（基准），渠道同步上架为上行，合规通报增多为下行。',
    answer: '这是预置的示例情景判断。演示账号不调用 AI 或搜索服务，结论均为虚构演示数据。',
    key_points: ['情景判断与事实结论分开保存', '到期后由回评任务回看一次'],
    claim_citations: [],
    signal_type: 'neutral',
    sentiment: 'neutral',
    confidence: 'low',
    evidence_ids: ['page_demo_a', 'page_demo_b'],
    forecast,
    proposed_actions: []
  };
  const rawData = {
    demo: true,
    agent_run_id: runId,
    answer: result.answer,
    confidence: 'low',
    evidence_ids: result.evidence_ids,
    evidence,
    warnings: [],
    proposed_actions: [],
    forecast
  };

  sqlite.prepare("INSERT INTO agent_runs (id,org_id,user_id,goal,status,current_phase,step_count,result_json,metadata,completed_at) VALUES (?,?,?,?,'completed','completed',1,?,?,datetime('now'))")
    .run(runId, orgId, userId, `示例：${question}`, JSON.stringify(result), JSON.stringify({ demo: true, conversation_id: runId, agent: 'forecast_demo' }));

  const reportId = Number(sqlite.prepare("INSERT INTO reports (org_id,agent_run_id,watchlist_id,title,query,summary,key_points,signal_type,sentiment,sources,raw_data,report_date,created_at) VALUES (?,?,NULL,?,?,?,?, 'neutral','neutral','[]',?,date('now',?),datetime('now',?))")
    .run(orgId, runId, FORECAST_SAMPLE_TITLE, question, result.summary, JSON.stringify(result.key_points), JSON.stringify(rawData), '-60 days', '-60 days').lastInsertRowid);
  sqlite.prepare('UPDATE agent_runs SET report_id = ? WHERE id = ?').run(reportId, runId);

  // 已回评一条（示例判定），另一条保持待回评，展示两种状态
  sqlite.prepare("INSERT INTO forecast_reviews (org_id,report_id,agent_run_id,question,horizon_days,valid_until,status,verdict,rationale,evidence_ids,confidence,evaluated_at,created_at) VALUES (?,?,?,?,30,?,'evaluated','upside',?,?, 'medium', datetime('now',?), datetime('now',?))")
    .run(orgId, reportId, runId, question, validUntil,
      '（示例判定）两家示例渠道同步上架新品，渠道动作快于基准情景；合规通报未扩散到主要渠道，失效条件未出现。',
      JSON.stringify(['page_demo_a', 'page_demo_b']), '-28 days', '-60 days');
  sqlite.prepare("INSERT INTO forecast_reviews (org_id,report_id,agent_run_id,question,horizon_days,valid_until,status,created_at) VALUES (?,?,?,?,90,?,'pending',datetime('now',?))")
    .run(orgId, reportId, runId, '美国手机配件市场未来 90 天的渠道结构变化', new Date(Date.now() + 30 * 86400000).toISOString(), '-5 days');

  return reportId;
}

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
      ensureDemoForecast(existing.org_id, user.id);
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
    ensureDemoForecast(orgId, userId);
    sqlite.exec('COMMIT');
    return {userId,orgId,created:true};
  } catch(error) { sqlite.exec('ROLLBACK'); throw error; }
}
if (require.main === module) seedDemo().then(result => console.log('Demo seeded:',result)).finally(closeAll).catch(error=>{ console.error(error.message); process.exitCode=1; });
module.exports = {seedDemo};
