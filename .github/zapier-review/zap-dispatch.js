import { createZapierSdk } from '@zapier/zapier-sdk';
const zapier = createZapierSdk({maxNetworkRetries: 0});

// Copilot可修改Input Data里的policy。只启动一次完整云端任务，不逐块触发Zap。
// App Connections中已选择GitHub账号Glace678。不要把PAT写入Input Data。
export default async function main({inputData, connections}) {
  const repo = String(inputData.repo);
  const issueNumber = Number(inputData.issue_number);
  const maxTasks = Number(inputData.max_tasks);
  if (repo !== 'Glace678/3' || inputData.model_id !== 'openai/gpt-5.6-luna')
    throw new Error('只允许已配置的仓库和Zapier托管Luna。');
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1 || !Number.isSafeInteger(maxTasks) || maxTasks < 1 || maxTasks > 74)
    throw new Error('Issue编号或预算无效；预算必须低于75 tasks。');
  if (inputData.workflow_ref !== 'main' || inputData.workflow_file !== 'luna-autonomous.yml')
    throw new Error('云端流程入口不匹配。');
  const policy = String(inputData.policy || '');
  if (!policy || policy.length > 12000) throw new Error('请填写有效的审查要求。');
  const issueResponse = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}`, {
    headers:{Accept:'application/vnd.github+json'}, signal:AbortSignal.timeout(7000)
  });
  if (!issueResponse.ok) throw new Error(`读取Issue失败：HTTP ${issueResponse.status}`);
  const issue = await issueResponse.json();
  if (issue.user?.login !== 'Glace678' || issue.pull_request || issue.state !== 'open')
    throw new Error('仅允许仓库主人创建且未关闭的Issue。');
  const result = await zapier.fetch(`https://api.github.com/repos/${repo}/actions/workflows/luna-autonomous.yml/dispatches`, {
    connection: connections?.github || 66435003,
    method:'POST', maxTimeSeconds:12,
    headers:{Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
    body:JSON.stringify({ref:'main',inputs:{issue_number:String(issueNumber),model_id:inputData.model_id,max_tasks:String(maxTasks),policy,job_branch:'',plan_only:String(inputData.plan_only || 'false')}})
  });
  if (!result.ok) throw new Error(`启动云端任务失败：HTTP ${result.status}；未自动重试。`);
  return {status:'started',issue_number:issueNumber,model:inputData.model_id,max_tasks:maxTasks,
    message:'已自动启动完整任务。进度和最终草稿PR会回到Issue；不需要逐批操作。',
    runs_url:`https://github.com/${repo}/actions/workflows/luna-autonomous.yml`};
}
