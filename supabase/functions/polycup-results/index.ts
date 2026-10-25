import { createResultHandler } from '../_shared/ranked-worker.mjs';

const names = ['POLYCUP_RESULT_CRON_TOKEN', 'POLYCUP_RESULT_WORKER_ENABLED',
  'POLYCUP_RESULT_DATABASE_URL', 'POLYCUP_RESULT_CA_PEM', 'POLYCUP_RESULT_LOCAL_TEST'];
const env = Object.fromEntries(names.map(name => [name, Deno.env.get(name)]));
Deno.serve(createResultHandler(env));
