export function serviceUrl() {
  const saved=localStorage.getItem('scene-service-url');
  if(saved)return saved.replace(/\/$/,'');
  return ['localhost','127.0.0.1'].includes(location.hostname)?location.origin:'';
}
async function api(base,path,options={}) {
  let response;
  try {response=await fetch(base+path,{...options,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(150000)]):AbortSignal.timeout(150000)});}
  catch {throw new Error('无法连接转换服务；已提交的 Marble 任务可以稍后继续。');}
  let data;try {data=await response.json();}catch {throw new Error('当前地址没有转换接口，请启动本地后端。');}
  if(!response.ok||data.error)throw new Error(data.error||'转换服务未响应');
  return data;
}
export async function refreshMarble(world) {
  if(!world.serviceUrl)return world;
  const data=await api(world.serviceUrl,'/api/marble/jobs/'+world.jobId+'?refresh=1');
  return {...data.world,serviceUrl:world.serviceUrl};
}
export async function reconstruct(image,{name='',job=null,onJob=()=>{},onProgress=()=>{},signal}={}) {
  const base=job?.serviceUrl||serviceUrl();
  if(!base)throw new Error('请先打开“转换服务”设置后端地址。');
  let data=job?{jobId:job.jobId,done:false}:await api(base,'/api/reconstruct',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image,name}),signal});
  if(data.jobId){
    const pending={jobId:data.jobId,serviceUrl:base};await onJob(pending);
    for(let attempt=0;!data.done;attempt++){
      signal?.throwIfAborted();
      if(attempt>=240)throw new Error('生成仍未完成，任务已保存；可以稍后点击卡片继续。');
      onProgress('Marble 正在生成三维世界 · '+Math.floor(attempt*5/60)+'分'+attempt*5%60+'秒');
      await new Promise(resolve=>setTimeout(resolve,5000));
      data=await api(base,'/api/marble/jobs/'+pending.jobId,{signal});
    }
    data.world={...data.world,serviceUrl:base};
    return data;
  }
  if(data.plan?.version!==1||!Array.isArray(data.plan.objects))throw new Error('转换服务未返回有效场景');
  return data;
}
