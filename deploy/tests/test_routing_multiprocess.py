import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class MultiprocessTests(unittest.TestCase):
    def test_workers_share_counters_and_dead_workers_release_gauges(self):
        worker = '''
import asyncio, os
from prometheus_client import CollectorRegistry
from realai_private.routing_telemetry import RoutingTelemetry, EventJournal
async def main():
    observer=RoutingTelemetry(CollectorRegistry(),EventJournal(os.environ['TEST_JOURNAL']))
    await observer.async_pre_call_deployment_hook({'model':'openai/qwen','metadata':{'model_group':'Qwen','model_info':{'id':'replica-a'}},'litellm_call_id':'test'},None)
asyncio.run(main())
'''
        reader = '''
import json, os
from prometheus_client import CollectorRegistry, multiprocess
registry=CollectorRegistry();multiprocess.MultiProcessCollector(registry)
def sample(name):return registry.get_sample_value(name,{'model':'Qwen','deployment':'replica-a',**({'kind':'initial'} if 'attempts' in name else {})})
before=[sample('realai_route_attempts_total'),sample('realai_route_inflight')]
for pid in json.loads(os.environ['TEST_PIDS']):multiprocess.mark_process_dead(pid)
after=[sample('realai_route_attempts_total'),sample('realai_route_inflight')]
print(json.dumps({'before':before,'after':after}))
'''
        with tempfile.TemporaryDirectory() as folder:
            env={**os.environ,'PROMETHEUS_MULTIPROC_DIR':folder,'TEST_JOURNAL':str(Path(folder)/'events.sqlite3')}
            workers=[subprocess.Popen([sys.executable,'-c',worker],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE) for _ in range(2)]
            for process in workers:
                _,error=process.communicate(timeout=45)
                self.assertEqual(process.returncode,0,error.decode()[-1000:])
            env['TEST_PIDS']=json.dumps([process.pid for process in workers])
            result=json.loads(subprocess.check_output([sys.executable,'-c',reader],env=env))
            self.assertEqual(result['before'],[2,2])
            self.assertEqual(result['after'][0],2)
            self.assertIn(result['after'][1],(0,None))


if __name__=='__main__':unittest.main()
