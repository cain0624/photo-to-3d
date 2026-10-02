export function serviceUrl() {
  const saved=localStorage.getItem('scene-service-url');
  if(saved)return saved.replace(/\/$/,'');
  return ['localhost','127.0.0.1'].includes(location.hostname)?location.origin:'';
}
export async function reconstruct(image) {
  const base=serviceUrl();
  if(!base)throw new Error('请先打开“转换服务”设置后端地址，或使用本地后端网站上传。');
  let response;
  try{response=await fetch(base+'/api/reconstruct',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image}),signal:AbortSignal.timeout(150000)});}
  catch{throw new Error('无法连接转换服务，请确认本地后端已启动、地址正确，并允许浏览器访问。');}
  let data;try{data=await response.json();}catch{throw new Error('当前地址没有转换接口，请启动 python3 backend/server.py 并使用 8766 端口。');}
  if(!response.ok)throw new Error(data.error||'照片分析失败');
  if(data.plan?.version!==1||!Array.isArray(data.plan.objects))throw new Error('转换服务未返回有效场景描述');
  return data;
}
