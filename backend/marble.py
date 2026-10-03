"""World API adapter. API credentials stay on the local server."""
import json, os, re, uuid, urllib.request
from pathlib import Path
JOBS = Path(__file__).resolve().parent.parent / '.marble-jobs'

def request(path, body=None):
    key=os.getenv('MARBLE_API_KEY')
    if not key: raise ValueError('请在 .env.local 填写 MARBLE_API_KEY 并重启后端')
    url=os.getenv('MARBLE_BASE_URL','https://api.worldlabs.ai/marble/v1').rstrip('/')+path
    req=urllib.request.Request(url,data=json.dumps(body).encode() if body is not None else None,
        headers={'WLT-Api-Key':key,'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=90) as response:return json.load(response)

def save(ticket, data):
    JOBS.mkdir(exist_ok=True,mode=0o700)
    target=JOBS/(ticket+'.json');temp=target.with_suffix('.'+uuid.uuid4().hex+'.tmp')
    temp.write_text(json.dumps(data));temp.chmod(0o600);temp.replace(target)

def load(ticket):
    if not re.fullmatch(r'[a-f0-9]{32}',ticket):raise ValueError('无效生成任务')
    try:return json.loads((JOBS/(ticket+'.json')).read_text())
    except FileNotFoundError:raise ValueError('本地没有此任务，请使用创建任务的后端')

def start(image, name):
    mime,encoded=image.split(',',1)
    ext='jpg' if 'jpeg' in mime else ('png' if 'png' in mime else 'webp')
    model=os.getenv('MARBLE_MODEL','marble-1.1')
    operation=request('/worlds:generate',{'display_name':str(name or '照片世界')[:100],'model':model,
      'world_prompt':{'type':'image','is_pano':False,'image_prompt':{'source':'data_base64','data_base64':encoded,'extension':ext},
      'text_prompt':'Create an explorable 3D world faithful to this image. Preserve terrain slopes, buildings, vegetation, sky, water colors, materials and the original lighting direction. Extend unseen surroundings naturally. Do not add picture frames or relief panels.'}})
    ticket=uuid.uuid4().hex
    save(ticket,{'operation_id':operation['operation_id'],'model':model})
    return {'jobId':ticket,'done':False,'provider':'marble'}

def status(ticket, refresh=False):
    job=load(ticket)
    if refresh and job.get('world'):
        job['world']=request('/worlds/'+job['world']['world_id']);save(ticket,job)
    if not job.get('world'):
        operation=request('/operations/'+job['operation_id'])
        if operation.get('error'):return {'done':True,'error':'Marble 生成失败：'+str(operation['error'].get('message','未知错误'))[:300]}
        if not operation.get('done'):return {'done':False,'jobId':ticket}
        world=operation.get('response') or {}
        if not world.get('assets'):
            world=request('/worlds/'+(world.get('world_id') or operation.get('metadata',{}).get('world_id','')))
        if not world.get('world_id'):raise ValueError('Marble 未返回世界编号')
        job['world']=world;save(ticket,job)
    world=job['world'];assets=world.get('assets') or {};splats=assets.get('splats') or {};urls=splats.get('spz_urls') or {}
    splat=urls.get('500k') or urls.get('100k') or urls.get('full_res')
    collider=(assets.get('mesh') or {}).get('collider_mesh_url')
    if not splat or not collider:raise ValueError('Marble 尚未返回三维视觉资产或碰撞网格，请稍后重试此任务')
    return {'done':True,'jobId':ticket,'world':{'id':world['world_id'],'jobId':ticket,'splatUrl':splat,'colliderUrl':collider,
      'semantics':splats.get('semantics_metadata') or {},'viewerUrl':world.get('world_marble_url'),'caption':assets.get('caption','')},
      'provenance':{'method':'marble-world','model':job['model'],'approximate':True}}
