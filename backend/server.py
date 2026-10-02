"""Local static website + vision-to-scene API. No third-party Python packages."""
import base64, json, math, os, re, threading, urllib.request, urllib.error
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / '.env.local'
if ENV.exists():
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"\''))
PROMPT = (Path(__file__).with_name('scene_prompt.txt')).read_text()
BUSY = threading.BoundedSemaphore(2)

def validate_plan(p):
    def number(v, lo, hi):
        if isinstance(v, bool) or not isinstance(v, (int,float)) or not math.isfinite(v) or not lo <= v <= hi:
            raise ValueError('场景数值超出范围')
        return v
    def color(v):
        if not isinstance(v,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',v): raise ValueError('无效材质颜色')
        return v
    if not isinstance(p,dict) or p.get('version') != 1: raise ValueError('无效场景版本')
    p['summary'] = str(p['summary'])[:500]
    if not isinstance(p['limitations'],list): raise ValueError('缺少重建说明')
    p['limitations'] = [str(x)[:300] for x in p['limitations'][:10]]
    t=p['terrain']; color(t['color'])
    if t['surface'] not in ['grass','sand','stone','snow']: raise ValueError('无效地表类型')
    h=t['heights']
    if not isinstance(h,list) or len(h)!=9 or any(not isinstance(row,list) or len(row)!=9 for row in h): raise ValueError('地形必须为9×9高度场')
    for row in h:
        for v in row: number(v,-30,60)
    s=p['sky']; number(s['horizon'],0,1); number(s['cloudCoverage'],0,1)
    for k in ['topColor','horizonColor','cloudColor']: color(s[k])
    l=p['lighting']; color(l['color']); color(l['ambientColor']); number(l['intensity'],0,4); number(l['ambientIntensity'],.1,3)
    d=l['sunDirection']
    if not isinstance(d,list) or len(d)!=3:raise ValueError('无效太阳方向')
    for v in d:number(v,-1,1)
    if d[1]<.05:raise ValueError('光照必须位于地面上方')
    sp=p['spawn'];number(sp['x'],-180,180);number(sp['z'],-180,180);number(sp['yaw'],-6.3,6.3);number(sp['pitch'],.1,1.1);number(sp['distance'],4,18)
    for key,limit in [('objects',100),('waters',8),('paths',20)]:
        if not isinstance(p[key],list) or len(p[key])>limit:raise ValueError('场景物体数量超出范围')
    for o in p['objects']:
        if o['kind'] not in ['building','tree','rock','block']:raise ValueError('无效物体类型')
        for k in ['x','z']:number(o[k],-200,200)
        for k in ['width','height','depth']:number(o[k],.3,60)
        number(o['rotation'],-6.3,6.3);color(o['color']);color(o['roofColor'])
    for o in p['waters']+p['paths']:
        a=o['polygon']
        if not isinstance(a,list) or not 3<=len(a)<=24:raise ValueError('无效地面轮廓')
        for pt in a:
            if not isinstance(pt,list) or len(pt)!=2:raise ValueError('无效轮廓点')
            for v in pt:number(v,-200,200)
        area=sum(a[i][0]*a[(i+1)%len(a)][1]-a[(i+1)%len(a)][0]*a[i][1] for i in range(len(a)))
        if abs(area)<1:raise ValueError('轮廓面积太小')
        def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
        for i in range(len(a)):
            for j in range(i+2,len(a)):
                if i==0 and j==len(a)-1:continue
                aa,bb,cc,dd=a[i],a[(i+1)%len(a)],a[j],a[(j+1)%len(a)]
                if cross(aa,bb,cc)*cross(aa,bb,dd)<0 and cross(cc,dd,aa)*cross(cc,dd,bb)<0:raise ValueError('轮廓存在交叉边')
        color(o['color'])
        if 'level' in o:number(o['level'],-30,60);color(o['reflectionColor'])
    return p

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def end_headers(self):
        origin=self.headers.get('Origin','')
        allowed={'https://cain0624.github.io',f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}'}
        allowed.update(filter(None,os.environ.get('SCENE_ALLOWED_ORIGINS','').split(',')))
        if origin in allowed:self.send_header('Access-Control-Allow-Origin',origin);self.send_header('Vary','Origin')
        self.send_header('Cache-Control','no-store')
        super().end_headers()
    def reply(self,status,data):
        body=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def do_OPTIONS(self):
        self.send_response(204);self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS');self.send_header('Access-Control-Allow-Headers','Content-Type');self.end_headers()
    def do_GET(self):
        if self.path=='/api/health':return self.reply(200,{'configured':bool(os.getenv('SCENE_VISION_MODEL') and os.getenv('SCENE_VISION_KEY')),'provider': 'vision-scene-v1'})
        # Never expose keys, backend sources or git files through the static server.
        from urllib.parse import unquote,urlsplit
        parts=Path(unquote(urlsplit(self.path).path)).parts
        if any(x.startswith('.') for x in parts) or 'backend' in parts or 'tests' in parts:return self.reply(404,{'error':'Not found'})
        return super().do_GET()
    def do_POST(self):
        if self.path!='/api/reconstruct':return self.reply(404,{'error':'Not found'})
        origin=self.headers.get('Origin','')
        allowed={'https://cain0624.github.io',f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}'}
        allowed.update(filter(None,os.environ.get('SCENE_ALLOWED_ORIGINS','').split(',')))
        if origin and origin not in allowed:return self.reply(403,{'error':'该网页来源未获后端授权'})
        if not os.getenv('SCENE_VISION_KEY') or not os.getenv('SCENE_VISION_MODEL'):return self.reply(503,{'error':'请先在本地 .env.local 配置视觉模型和密钥，再重启后端。'})
        if not BUSY.acquire(blocking=False):return self.reply(429,{'error':'当前生成任务较多，请稍后重试'})
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 1<=length<=6_000_000:raise ValueError('照片请求过大，请使用小于4MB的压缩图片')
            payload=json.loads(self.rfile.read(length));image=payload.get('image','')
            if not isinstance(image,str) or not re.match(r'^data:image/(jpeg|png|webp);base64,',image):raise ValueError('请上传JPEG、PNG或WebP图片')
            raw=base64.b64decode(image.split(',',1)[1],validate=True)
            if not raw or len(raw)>4_000_000:raise ValueError('图片为空或超出限制')
            body={'model':os.environ['SCENE_VISION_MODEL'],'messages':[{'role':'system','content':PROMPT},{'role':'user','content':[{'type':'text','text':'Analyze the supplied photo. Return the complete scene schema.'},{'type':'image_url','image_url':{'url':image}}]}],'response_format':{'type':'json_object'}}
            url=os.getenv('SCENE_VISION_BASE_URL','https://api.openai.com/v1').rstrip('/')+'/chat/completions'
            request=urllib.request.Request(url,data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+os.environ['SCENE_VISION_KEY'],'Content-Type':'application/json'})
            with urllib.request.urlopen(request,timeout=120) as response:data=json.load(response)
            content=data['choices'][0]['message']['content'];plan=validate_plan(json.loads(content))
            self.reply(200,{'plan':plan,'provenance':{'method':'vision-assisted-procedural','model':os.environ['SCENE_VISION_MODEL'],'approximate':True}})
        except (ValueError,KeyError,TypeError,IndexError) as e:self.reply(422,{'error':'照片分析或场景格式无效：'+str(e)[:200]})
        except urllib.error.HTTPError as e:self.reply(502,{'error':f'视觉服务返回 HTTP {e.code}，请检查模型、接口和后端密钥'})
        except Exception:self.reply(502,{'error':'视觉服务连接失败或超时，请检查后端配置'})
        finally:BUSY.release()

if __name__=='__main__':
    port=int(os.getenv('SCENE_PORT','8766'))
    print(f'Website + API: http://127.0.0.1:{port}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',port),Handler).serve_forever()
