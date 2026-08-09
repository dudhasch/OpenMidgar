/// <reference lib="webworker" />
import { workerScopeEndpoint } from './endpoint.js';
import { PipelineWorkerHost } from './worker-host.js';

/** Browser-Entry des Parser-Workers: identischer Host wie im Loopback-Test. */
new PipelineWorkerHost(workerScopeEndpoint(self as unknown as DedicatedWorkerGlobalScope));
