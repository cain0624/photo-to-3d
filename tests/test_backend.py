import base64,copy,importlib.util,json,os,threading,unittest,urllib.request,urllib.error
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
spec=importlib.util.spec_from_file_location('scene_server',Path(__file__).parents[1]/'backend/server.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
def fixture(surface='grass'):
    return {'version':1,'summary':'测试模型响应，不是真实照片分析','limitations':['测试几何'],
      'sky':{'horizon':.4 if surface=='grass' else .23,'topColor':'#617f96','horizonColor':'#afbbc6','cloudColor':'#a6a5a3','cloudCoverage':.4},
      'lighting':{'color':'#ffe0b0','ambientColor':'#c5c9cd','intensity':1.3,'ambientIntensity':1.1,'sunDirection':[-.1,.5,-.8]},
      'terrain':{'color':'#526345' if surface=='grass' else '#777777','surface':surface,'heights':[[z*.8 for _ in range(9)] for z in range(9)]},
      'spawn':{'x':0,'z':50,'yaw':0,'pitch':.38,'distance':13},
      'objects':[{'kind':'tree' if surface=='grass' else 'building','x':10,'z':0,'width':6,'height':8,'depth':5,'rotation':.1,'color':'#465b36','roofColor':'#394d59'}],
      'waters':[{'polygon':[[-100,-190],[100,-190],[100,-100],[-100,-100]],'level':2,'color':'#9fafa9','reflectionColor':'#f8bb60'}] if surface=='grass' else [],'paths':[{'polygon':[[-3,20],[3,20],[3,160],[-3,160]],'color':'#928574'}] if surface=='grass' else []}
class Upstream(BaseHTTPRequestHandler):
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert data['messages'][1]['content'][1]['type']=='image_url'
        out=json.dumps({'choices':[{'message':{'content':json.dumps(fixture())}}]}).encode()
        self.send_response(200);self.end_headers();self.wfile.write(out)
    def log_message(self,*a):pass
class Tests(unittest.TestCase):
    def test_invalid_model_geometry(self):
        p=fixture();p['terrain']['heights'][0][0]=float('nan')
        with self.assertRaises(ValueError):mod.validate_plan(p)
        p=fixture();p['objects'][0]['width']=10000
        with self.assertRaises(ValueError):mod.validate_plan(p)
    def test_no_keys_static_and_real_request_contract(self):
        upstream=ThreadingHTTPServer(('127.0.0.1',0),Upstream);threading.Thread(target=upstream.serve_forever,daemon=True).start()
        server=ThreadingHTTPServer(('127.0.0.1',0),mod.Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
        old=dict(os.environ)
        try:
            os.environ.update(SCENE_VISION_KEY='test-key',SCENE_VISION_MODEL='test-model',SCENE_VISION_BASE_URL=f'http://127.0.0.1:{upstream.server_port}/v1')
            base=f'http://127.0.0.1:{server.server_port}'
            data=json.dumps({'image':'data:image/png;base64,'+base64.b64encode(b'contract-test-image').decode()}).encode()
            d=json.load(urllib.request.urlopen(urllib.request.Request(base+'/api/reconstruct',data=data,headers={'Content-Type':'application/json'})))
            self.assertEqual(d['plan']['objects'][0]['kind'],'tree');self.assertTrue(d['provenance']['approximate'])
            for path in ['/.env.local','/%2egit/config','/backend/server.py']:
                with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(base+path)
                self.assertEqual(error.exception.code,404)
            os.environ.pop('SCENE_VISION_KEY')
            with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(urllib.request.Request(base+'/api/reconstruct',data=data))
            self.assertEqual(error.exception.code,503)
        finally:
            os.environ.clear();os.environ.update(old);server.shutdown();upstream.shutdown();server.server_close();upstream.server_close()
if __name__=='__main__':unittest.main()
