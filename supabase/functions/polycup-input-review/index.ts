import {createInputHandler} from '../_shared/input-review.mjs';
const names=['POLYCUP_INPUT_CRON_TOKEN','POLYCUP_INPUT_WORKER_ENABLED','POLYCUP_INPUT_DATABASE_URL','POLYCUP_INPUT_CA_PEM','POLYCUP_INPUT_LOCAL_TEST'];
Deno.serve(createInputHandler(Object.fromEntries(names.map(n=>[n,Deno.env.get(n)]))));
