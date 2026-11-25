import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
        payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        def chunk(text,finish=None):
            return {'id':'local-route-test','object':'chat.completion.chunk','created':int(time.time()),'model':payload['model'],'choices':[{'index':0,'delta':{'content':text},'finish_reason':finish}]}
        if payload.get('stream'):
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Connection','close');self.end_headers()
            for i in range(10):
                self.wfile.write(('data: '+json.dumps(chunk('持续响应-'+str(i)))+'\n\n').encode());self.wfile.flush();time.sleep(.2)
            self.wfile.write(('data: '+json.dumps(chunk('', 'stop'))+'\n\ndata: [DONE]\n\n').encode());self.wfile.flush()
        else:
            body=json.dumps({'id':'local-route-test','object':'chat.completion','created':int(time.time()),'model':payload['model'],'choices':[{'index':0,'message':{'role':'assistant','content':'真实兼容接口验证成功'},'finish_reason':'stop'}],'usage':{'prompt_tokens':3,'completion_tokens':7,'total_tokens':10}}).encode()
            self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)

if __name__=='__main__':ThreadingHTTPServer(('127.0.0.1',19190),Handler).serve_forever()
