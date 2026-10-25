"""Regenerate SQL conformance fixtures using the approved Python reference."""
import json, math, random, importlib.metadata
from pathlib import Path
from openskill.models import BradleyTerryFull

assert importlib.metadata.version('openskill') == '6.2.0'
rng = random.Random(221022)
model = BradleyTerryFull(tau=.25)
cases = []
inputs = [[{'mu':25,'sigma':25/3,'place':p+1} for p in range(n)] for n in [2,3,4]]
for n in [2,3,4]:
    for _ in range(80):
        inputs.append([{'mu':rng.uniform(-30,80),'sigma':rng.uniform(.1,9),
                        'place':rng.randint(1,n)} for _ in range(n)])
for entries in inputs:
    after = model.rate([[model.rating(mu=p['mu'],sigma=p['sigma'])] for p in entries], ranks=[p['place'] for p in entries])
    expected=[]
    for group in after:
        p=group[0]; z=p.mu/10
        rating=round(12500*(max(z,0)+math.log1p(math.exp(-abs(z))))/math.log1p(math.exp(2.5)))
        expected.append({'mu':p.mu,'sigma':p.sigma,'rating':rating})
    cases.append({'input':entries,'expected':expected})
path=Path(__file__).resolve().parents[1]/'supabase/tests/fixtures/ranked-btf.json'
path.parent.mkdir(exist_ok=True)
path.write_text(json.dumps({'reference':'openskill 6.2.0 BradleyTerryFull(tau=0.25)','cases':cases},indent=2)+'\n',encoding='utf8')
print(f'Wrote {len(cases)} reference cases')
