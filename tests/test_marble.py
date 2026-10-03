# coding: utf-8
"""Official request/response shape, fake upstream only; never spends API credits."""
import base64, importlib.util, json, os, tempfile, threading, unittest, urllib.request
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
spec=importlib.util.spec_from_file_location('server',Path(__file__).parents[1]/'backend/server.py');servermod=importlib.util.module_from_spec(spec);spec.loader.exec_module(servermod)
marble=servermod.marble
class Upstream(BaseHTTPRequestHandler):
    generated=0
    def log_message(self,*a):pass
    def do_POST(self):
        assert self.headers['WLT-Api-Key']=='test-secret'
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert self.path=='/marble/v1/worlds:generate'
        assert data['model']=='marble-1.1'
        assert data['world_prompt']['image_prompt']=={'source':'data_base64','extension':'png','data_base64':base64.b64encode(b'test-image').decode()}
        assert data['world_prompt']['is_pano'] is False
        Upstream.generated+=1;self.reply({'operation_id':'operation-1','done':False})
    def do_GET(self):
        assert self.headers['WLT-Api-Key']=='test-secret'
        world={'world_id':'world-1','assets':{'splats':{'spz_urls':{'500k':'https://assets.test/world.spz'},'semantics_metadata':{'metric_scale_factor':2,'ground_plane_offset':.3}},'mesh':{'collider_mesh_url':'https://assets.test/collider.glb'}}}
        if self.path.endswith('/operations/operation-1'):self.reply({'done':True,'response':world})
        elif self.path.endswith('/worlds/world-1'):self.reply(world)
        else:self.send_error(404)
    def reply(self,value):
        self.send_response(200);self.end_headers();self.wfile.write(json.dumps(value).encode())
class Tests(unittest.TestCase):
    def test_generation_resume_refresh_privacy(self):
        old=dict(os.environ);old_jobs=marble.JOBS
        upstream=ThreadingHTTPServer(('127.0.0.1',0),Upstream);threading.Thread(target=upstream.serve_forever,daemon=True).start()
        site=ThreadingHTTPServer(('127.0.0.1',0),servermod.Handler);threading.Thread(target=site.serve_forever,daemon=True).start()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                marble.JOBS=Path(tmp)/'.marble-jobs';os.environ.update(SCENE_PROVIDER='marble',MARBLE_MODEL='marble-1.1',MARBLE_API_KEY='test-secret',MARBLE_BASE_URL=f'http://127.0.0.1:{upstream.server_port}/marble/v1')
                base=f'http://127.0.0.1:{site.server_port}'
                def get(path):return json.load(urllib.request.urlopen(base+path))
                data=json.dumps({'image':'data:image/png;base64,'+base64.b64encode(b'test-image').decode(),'name':'test'}).encode()
                job=json.load(urllib.request.urlopen(urllib.request.Request(base+'/api/reconstruct',data=data,headers={'Content-Type':'application/json'})))
                result=get('/api/marble/jobs/'+job['jobId']);self.assertTrue(result['done']);self.assertEqual(result['world']['semantics']['metric_scale_factor'],2)
                refreshed=get('/api/marble/jobs/'+job['jobId']+'?refresh=1');self.assertEqual(refreshed['world']['id'],'world-1');self.assertEqual(Upstream.generated,1)
                self.assertNotIn('test-secret',json.dumps(result));self.assertEqual(get('/api/health')['provider'],'marble')
                with self.assertRaises(ValueError):marble.load('../.env.local')
                os.environ.pop('MARBLE_API_KEY');self.assertFalse(get('/api/health')['configured'])
        finally:
            marble.JOBS=old_jobs;os.environ.clear();os.environ.update(old);site.shutdown();upstream.shutdown();site.server_close();upstream.server_close()
if __name__=='__main__':unittest.main()
