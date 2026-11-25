import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_POST(self):
        payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if payload['model']=='primary':
            body=b'{"error":{"message":"synthetic failure","type":"server_error"}}'
            self.send_response(503);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
        if payload.get('stream'):
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
            for delta,finish in [({'role':'assistant'},None),({'content':'验收响应'},None),({},'stop')]:
                chunk={'id':'local-test','object':'chat.completion.chunk','created':int(time.time()),'model':payload['model'],'choices':[{'index':0,'delta':delta,'finish_reason':finish}]}
                self.wfile.write(('data: '+json.dumps(chunk)+'\n\n').encode());self.wfile.flush();time.sleep(.1)
            usage={'id':'local-test','object':'chat.completion.chunk','created':int(time.time()),'model':payload['model'],'choices':[],'usage':{'prompt_tokens':3,'completion_tokens':4,'total_tokens':7}}
            self.wfile.write(('data: '+json.dumps(usage)+'\n\ndata: [DONE]\n\n').encode());return
        body=json.dumps({'id':'local-test','object':'chat.completion','created':int(time.time()),'model':payload['model'],'choices':[{'index':0,'message':{'role':'assistant','content':'验收响应'},'finish_reason':'stop'}],'usage':{'prompt_tokens':3,'completion_tokens':4,'total_tokens':7}}).encode()
        self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)


if __name__=='__main__':ThreadingHTTPServer(('127.0.0.1',19200),Handler).serve_forever()
