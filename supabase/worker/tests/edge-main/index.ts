// Local QA supervisor only. The function runs as a USER worker with Free-plan
// resource limits, not the unrestricted main worker. Never deploy this router.
Deno.serve(async request => {
  if(new URL(request.url).pathname === '/health') return new Response('ready');
  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: '/workspace/supabase/functions/polycup-results',
      importMapPath: '/workspace/supabase/functions/polycup-results/deno.json',
      memoryLimitMb: 256, workerTimeoutMs: 150_000,
      cpuTimeSoftLimitMs: 1800, cpuTimeHardLimitMs: 2000,
      forceCreate: true, noModuleCache: false,
      envVars: Object.entries(Deno.env.toObject()).filter(([key])=>key.startsWith('POLYCUP_RESULT_')),
    });
    return await worker.fetch(request);
  } catch {
    return Response.json({error:'qa_worker_failed'}, {status:500});
  }
});
