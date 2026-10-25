"""Offline rating experiments. No account data, network or production writes.

Run with the isolated environment documented in output/rating-sim/summary.json.
Synthetic Cup outcomes approximate current points/finalist rules, not game physics.
"""
from __future__ import annotations
import json, math, random, statistics, importlib.metadata
from pathlib import Path
from collections import Counter
import numpy as np
from openskill.models import PlackettLuce, BradleyTerryFull
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 'rating-sim'
OUT.mkdir(parents=True, exist_ok=True)
SEEDS = 20
POPULATION = 24
SCALE = 500
MODELS = {
    'PL default': lambda: PlackettLuce(),
    'PL responsive': lambda: PlackettLuce(tau=0.5),
    'BT default': lambda: BradleyTerryFull(),
    'BT balanced': lambda: BradleyTerryFull(tau=0.25),
    'BT responsive': lambda: BradleyTerryFull(tau=0.5),
}

def badge_score(mu):
    # Smooth, strictly increasing, positive mapping; never clamp the skill state.
    # Exactly 12,500 at the prior mean (25). Pure presentation experiment.
    z=mu/10
    softplus=max(z,0)+math.log1p(math.exp(-abs(z)))
    return 12500*softplus/math.log1p(math.exp(2.5))

def percentile(xs, p):
    return float(np.percentile(xs, p))

def cup(rng, ids, strength, affinities, noise=True):
    """Two sequential bans/picks each; shared picks collapse, 3 rounds/track.
    Session form, persistent track affinity, per-round noise and 4% DNF are synthetic.
    True tied final standings share rank rather than using display-only join order.
    """
    available = list(range(32))
    for _ in range(2):
        for p in ids:
            available.remove(min(available, key=lambda tr: affinities[p][tr]))
    picks = set()
    for p in ids:
        picks.update(sorted(available, key=lambda tr: affinities[p][tr], reverse=True)[:2])
    tracks = sorted(picks)
    rng.shuffle(tracks)
    form = {p: rng.gauss(0, 2) if noise else 0 for p in ids}
    scores = {p: 0 for p in ids}
    finalists = {}
    for r in range(500):
        track = tracks[(r // 3) % len(tracks)]
        performance = {p: strength[p] + affinities[p][track] + form[p] + (rng.gauss(0, 4.167) if noise else 0) for p in ids}
        finish = sorted([p for p in ids if not noise or rng.random() >= .04], key=lambda p: performance[p], reverse=True)
        winner = finish[0] if finish and finish[0] in finalists else None
        for place, p in enumerate(finish):
            if p not in finalists:
                scores[p] = min(140, scores[p] + [10, 8, 6, 5][place])
                if scores[p] == 140:
                    finalists[p] = (r, place)
        if winner is not None:
            key = lambda p: (0 if p == winner else 1, -scores[p], *finalists.get(p, (9999, 9999)))
            ordered = sorted(ids, key=key)
            ranks = {}
            for i, p in enumerate(ordered):
                ranks[p] = ranks[ordered[i-1]] if i and key(p) == key(ordered[i-1]) else i+1
            return [ranks[p] for p in ids], r+1
    raise AssertionError('Synthetic Cup did not finish')

def update(model, ratings, ids, ranks):
    before = [ratings[p].mu for p in ids]
    after = model.rate([[ratings[p]] for p in ids], ranks=ranks)
    for p, group in zip(ids, after):
        ratings[p] = group[0]
        assert math.isfinite(ratings[p].mu) and ratings[p].sigma > 0
    return [ratings[p].mu - old for p, old in zip(ids, before)]

def pair_accuracy(ratings, truth):
    vals = [r.mu if hasattr(r, 'mu') else r for r in ratings]
    pairs = [(i,j) for i in range(len(vals)) for j in range(i) if abs(truth[i]-truth[j]) >= 2]
    return sum((vals[i]-vals[j])*(truth[i]-truth[j])>0 for i,j in pairs)/len(pairs)

def elo_update(ratings, counts, ids, ranks):
    # A simple normalized pairwise Elo comparator, not a selected production model.
    changes = []
    for i,p in enumerate(ids):
        error = 0
        for j,q in enumerate(ids):
            if p == q: continue
            expected = 1/(1+math.exp((ratings[q]-ratings[p])/6))
            actual = 1 if ranks[i]<ranks[j] else .5 if ranks[i]==ranks[j] else 0
            error += actual-expected
        changes.append((3 if counts[p]<10 else 1.5)*error/(len(ids)-1))
    for p,d in zip(ids,changes): ratings[p]+=d; counts[p]+=1

def snapshots():
    scenarios = [
      ('Even four, established', [25]*4, [3]*4, [1,2,3,4]),
      ('Even four, settled confidence', [25]*4, [2.2]*4, [1,2,3,4]),
      ('Even four, new', [25]*4, [25/3]*4, [1,2,3,4]),
      ('Even three, established', [25]*3, [3]*3, [1,2,3]),
      ('Even duel, established', [25]*2, [3]*2, [1,2]),
      ('Favourite second', [35,20,20,20], [3]*4, [2,1,3,4]),
      ('Underdog third', [15,30,30,30], [3]*4, [3,1,2,4]),
      ('Expected unequal order', [35,30,20,15], [3]*4, [1,2,3,4]),
      ('Shared second place', [25]*4, [3]*4, [1,2,2,4]),
    ]
    result = []
    for title,mus,sigmas,ranks in scenarios:
        row = {'scenario':title,'before_mu':mus,'sigma':sigmas,'places':ranks,'models':{}}
        for name,make in MODELS.items():
            model=make(); ratings=[model.rating(mu=m,sigma=s) for m,s in zip(mus,sigmas)]
            deltas=update(model,ratings,list(range(len(mus))),ranks)
            row['models'][name]={'delta_mu':deltas,'delta_compact':[round(d*50) for d in deltas],
              'delta_wide':[round(d*500) for d in deltas],
              'before_wide':[round(m*500) for m in mus], 'after_wide':[round(r.mu*500) for r in ratings],
              'positive_before':[round(badge_score(m)) for m in mus],
              'positive_after':[round(badge_score(r.mu)) for r in ratings],
              'positive_delta':[round(badge_score(r.mu))-round(badge_score(m)) for r,m in zip(ratings,mus)]}
        result.append(row)
    return result

def population(seed):
    rng=random.Random(21000+seed)
    truth=[15+20*i/(POPULATION-1) for i in range(POPULATION)]
    affinity=[[rng.gauss(0,2) for _ in range(32)] for _ in truth]
    models={name:make() for name,make in MODELS.items()}
    ratings={name:[model.rating() for _ in truth] for name,model in models.items()}
    elo=[25.0]*POPULATION; counts=[0]*POPULATION
    fixed=[12500.0]*POPULATION
    round_counts=[]; tied=0; curves={name:[] for name in MODELS}; late_deltas={name:[] for name in MODELS}
    late_badge_deltas={name:[] for name in MODELS}
    bad_sign={name:Counter() for name in MODELS}
    for match in range(2400):
        n=rng.choices([2,3,4],[.15,.2,.65])[0]
        # Every other match selects nearby latent strengths; remaining matches
        # simulate a quiet mixed-skill queue. Same results reach every model.
        ids=rng.sample(range(POPULATION),n) if match%2 else None
        if ids is None:
            start=max(0,min(POPULATION-8,rng.randrange(POPULATION)-4))
            ids=rng.sample(list(range(start,start+8)),n)
        ranks,rounds=cup(rng,ids,truth,affinity)
        round_counts.append(rounds); tied+=len(set(ranks))<n
        for name,model in models.items():
            before_badge=[badge_score(ratings[name][p].mu) for p in ids]
            ds=update(model,ratings[name],ids,ranks)
            if match>=2000:
                late_deltas[name].extend(abs(d)*SCALE for d in ds)
                late_badge_deltas[name].extend(abs(badge_score(ratings[name][p].mu)-v) for p,v in zip(ids,before_badge))
                if n==4:
                    for rank,d in zip(ranks,ds):
                        bad_sign[name]['second_total']+=rank==2
                        bad_sign[name]['second_loses']+=rank==2 and d<0
                        bad_sign[name]['third_total']+=rank==3
                        bad_sign[name]['third_gains']+=rank==3 and d>0
            if (match+1)%100==0:
                curves[name].append({'cups':match+1,'mean':statistics.mean(r.mu*SCALE for r in ratings[name]),
                  'accuracy':pair_accuracy(ratings[name],truth),'median_sigma':statistics.median(r.sigma for r in ratings[name])})
        elo_update(elo,counts,ids,ranks)
        # Symmetric placement-only baseline, averaged over occupied tied positions.
        for p,rank in zip(ids,ranks):
            tied_count=ranks.count(rank)
            fixed[p]+=statistics.mean((n+1-2*k)/(n-1)*150 for k in range(rank,rank+tied_count))
    return {'seed':seed,'rounds_median':statistics.median(round_counts),'tie_rate':tied/2400,
       'models':{name:{'accuracy':pair_accuracy(rs,truth),'ratings':[r.mu*SCALE for r in rs],
         'sigmas':[r.sigma for r in rs],'mean':statistics.mean(r.mu*SCALE for r in rs),
         'late_badge_abs_delta_median':statistics.median(late_badge_deltas[name]),
         'late_abs_delta_median':statistics.median(late_deltas[name]),'signs':dict(bad_sign[name]),'curve':curves[name]}
         for name,rs in ratings.items()},
       'elo':{'accuracy':pair_accuracy(elo,truth),'ratings':[r*SCALE for r in elo]},
       'fixed':{'accuracy':pair_accuracy(fixed,truth),'ratings':fixed}}

def trajectories(seed):
    rng=random.Random(41000+seed)
    truth=[15]+[16+18*i/22 for i in range(23)]
    affinity=[[rng.gauss(0,2) for _ in range(32)] for _ in truth]
    models={name:make() for name,make in MODELS.items()}
    ratings={name:[m.rating() for _ in truth] for name,m in models.items()}
    for match in range(2000):
        ids=rng.sample(range(POPULATION),4)
        ranks,_=cup(rng,ids,truth,affinity)
        for name,m in models.items(): update(m,ratings[name],ids,ranks)
    result={}
    for kind,new_strength in [('strong_newcomer',35),('beginner_newcomer',15),('improving_regular',35),('returning_unchanged',15)]:
        srng=random.Random(51000+seed)
        ts=list(truth);ts[0]=new_strength
        states={name:[m.rating(mu=r.mu,sigma=r.sigma) for r in ratings[name]] for name,m in models.items()}
        if 'newcomer' in kind:
            for name,m in models.items(): states[name][0]=m.rating()
        # A 90-day absence has no rating update. This checks our proposed policy,
        # not a library wall-clock feature (rate() receives no elapsed time).
        traces={name:[{'game':0,'rating':rs[0].mu*SCALE,'sigma':rs[0].sigma,
          'position':1+sum(r.mu>rs[0].mu for r in rs[1:])}] for name,rs in states.items()}
        for game in range(1,101):
            ids=[0]+srng.sample(list(range(1,POPULATION)),3)
            ranks,_=cup(srng,ids,ts,affinity)
            for name,m in models.items():
                update(m,states[name],ids,ranks)
                rs=states[name]
                traces[name].append({'game':game,'rating':rs[0].mu*SCALE,'sigma':rs[0].sigma,
                  'position':1+sum(r.mu>rs[0].mu for r in rs[1:])})
        result[kind]=traces
    return result

def repeated_group():
    rows=[]
    for noisy in [False,True]:
        for name,make in MODELS.items():
            rng=random.Random(71000);m=make();rs=[m.rating() for _ in range(4)]; trace=[]
            for game in range(1,1001):
                # Permanently ordered players is deliberately an extreme stress
                # case, contrasted with noisy similarly skilled opponents.
                ranks=[1,2,3,4] if not noisy else [0]*4
                if noisy:
                    order=sorted(range(4),key=lambda i:[27,26,24,23][i]+rng.gauss(0,4),reverse=True)
                    for place,p in enumerate(order): ranks[p]=place+1
                update(m,rs,list(range(4)),ranks)
                if game in (10,100,500,1000):trace.append({'games':game,'rating':[r.mu*SCALE for r in rs]})
            rows.append({'model':name,'mode':'noisy peers' if noisy else 'same order every time','trace':trace})
    return rows

def summarize(populations,paths):
    pop={}
    for name in MODELS:
        data=[x['models'][name] for x in populations]
        ratings=[v for x in data for v in x['ratings']]
        pop[name]={'pair_order_accuracy_median':statistics.median(x['accuracy'] for x in data),
          'rating_percentiles':{str(p):percentile(ratings,p) for p in (0,10,25,50,75,90,100)},
          'population_mean_median':statistics.median(x['mean'] for x in data),
          'late_abs_delta_median':statistics.median(x['late_abs_delta_median'] for x in data),
          'late_badge_abs_delta_median':statistics.median(x['late_badge_abs_delta_median'] for x in data),
          'median_sigma':statistics.median(v for x in data for v in x['sigmas']),
          'positive_rating_percentiles':{str(p):percentile([badge_score(r/SCALE) for r in ratings],p) for p in (0,10,25,50,75,90,100)},
          'second_loses_pct':100*sum(x['signs']['second_loses'] for x in data)/sum(x['signs']['second_total'] for x in data),
          'third_gains_pct':100*sum(x['signs']['third_gains'] for x in data)/sum(x['signs']['third_total'] for x in data)}
    trajectory={}
    for kind in paths[0]:
        trajectory[kind]={}
        for name in MODELS:
            entries=[x[kind][name] for x in paths]
            trajectory[kind][name]={str(n):{'rating_median':statistics.median(x[n]['rating'] for x in entries),
              'positive_rating_median':statistics.median(badge_score(x[n]['rating']/SCALE) for x in entries),
              'position_median':statistics.median(x[n]['position'] for x in entries),
              'rating_p10':percentile([x[n]['rating'] for x in entries],10),
              'rating_p90':percentile([x[n]['rating'] for x in entries],90)} for n in [0,1,5,10,20,50,100]}
    return {'packages':{x:importlib.metadata.version(x) for x in ['openskill','matplotlib','numpy']},
      'seeds':SEEDS,'population':POPULATION,'population_cups_per_seed':2400,
      'trajectory_training_cups_per_seed':2000,'trajectory_cups_per_scenario':100,
      'display_scales':{'compact':'50 * mu','wide':'500 * mu'},
      'settings':{'default':{'mu':25,'sigma':25/3,'beta':25/6,'tau':25/300},'balanced_tau':.25,'responsive_tau':.5},
      'positive_display_formula':'12500 * softplus(mu / 10) / softplus(2.5); compact = this / 10',
      'synthetic_assumptions':{'latent_skills':'15..35','track_affinity_sd':2,'session_form_sd':2,
        'round_noise_sd':4.167,'dnf_probability':.04,'track_catalog_size':32,'bans':2,'picks':2,
        'rounds_per_track':3,'finalist_points':140,'population_queue':'half random, half nearby latent skill',
        'caveats':['Not native physics or real player data','One update per Cup; genuine standings ties shared',
        'Absolute skill offset is unidentifiable from placements alone','No rank thresholds selected',
        'Scenario cohort is 24 synthetic players, not a population forecast']},
      'total_cups_generated':SEEDS*(2400+2000+4*100),
      'population_summary':pop,'trajectory_summary':trajectory,
      'elo_accuracy_median':statistics.median(x['elo']['accuracy'] for x in populations),
      'fixed_accuracy_median':statistics.median(x['fixed']['accuracy'] for x in populations),
      'median_cup_rounds':statistics.median(x['rounds_median'] for x in populations),
      'median_cup_tie_rate':statistics.median(x['tie_rate'] for x in populations)}

def plot(summary,populations,paths):
    plt.rcParams.update({'figure.facecolor':'#11182b','axes.facecolor':'#1b2440','text.color':'#edf1ff',
      'axes.labelcolor':'#b8c8e7','xtick.color':'#b8c8e7','ytick.color':'#b8c8e7','axes.edgecolor':'#53627c',
      'font.size':10,'axes.titleweight':'bold','grid.color':'#45516b','legend.facecolor':'#1b2440','legend.edgecolor':'#45516b'})
    colors={'PL default':'#ffb454','PL responsive':'#e579d5','BT default':'#5dc2ff','BT balanced':'#ffffff','BT responsive':'#65e3ba'}
    fig,axs=plt.subplots(2,2,figsize=(14,9),layout='constrained')
    for ax,(kind,title) in zip(axs.flat[:3],[('strong_newcomer','Strong newcomer'),('beginner_newcomer','Beginner newcomer'),('improving_regular','Experienced player improves sharply')]):
        for name in MODELS:
            arr=np.array([[v['rating'] for v in x[kind][name]] for x in paths])
            med=np.median(arr,axis=0);lo,hi=np.percentile(arr,[10,90],axis=0)
            ax.plot(range(101),med,label=name,color=colors[name]);ax.fill_between(range(101),lo,hi,color=colors[name],alpha=.07)
        ax.set_title(title,loc='left');ax.set_xlabel('Cups played after change');ax.set_ylabel('Displayed rating (500 × mu)');ax.grid(alpha=.3)
    ax=axs.flat[3]
    for name in MODELS:
        ys=np.array([[v['mean'] for v in x['models'][name]['curve']] for x in populations])
        ax.plot(range(100,2401,100),np.median(ys,axis=0),color=colors[name],label=name)
    ax.axhline(12500,color='white',linestyle=':',alpha=.5);ax.set_title('Closed 24-player pool: average rating',loc='left')
    ax.set_xlabel('Cups played across the community');ax.set_ylabel('Community mean rating');ax.grid(alpha=.3)
    axs.flat[0].legend(fontsize=9)
    fig.suptitle('PolyCup rating lab · OpenSkill 6.2.0',fontsize=19,fontweight='bold')
    fig.supxlabel('Synthetic Cup results · 20 seeds · lines = medians; bands = 10th–90th percentiles · responsive = tau 0.5',fontsize=10)
    fig.savefig(OUT/'rating-scenarios.png',dpi=160);plt.close(fig)
    fig,axs=plt.subplots(1,3,figsize=(15,4.5),layout='constrained')
    for ax,(kind,title) in zip(axs,[('strong_newcomer','Strong newcomer'),('beginner_newcomer','Beginner newcomer'),('improving_regular','Established player improves')]):
        for name in ['BT default','BT balanced','BT responsive']:
            arr=np.array([[badge_score(v['rating']/SCALE) for v in x[kind][name]] for x in paths])
            ax.plot(range(101),np.median(arr,axis=0),label=name,color=colors[name])
            lo,hi=np.percentile(arr,[10,90],axis=0)
            ax.fill_between(range(101),lo,hi,color=colors[name],alpha=.07)
        ax.set_title(title,loc='left');ax.set_xlabel('Cups after change');ax.set_ylabel('Positive displayed rating');ax.grid(alpha=.3)
    axs[0].legend(fontsize=9)
    fig.suptitle('OpenSkill Bradley–Terry Full · positive badge scale',fontsize=17,fontweight='bold')
    fig.supxlabel('Synthetic results · 20 seeds · median with 10th–90th percentile bands · divide numbers by 10 for the compact scale',fontsize=9)
    fig.savefig(OUT/'badge-scale-scenarios.png',dpi=160);plt.close(fig)

def main():
    # Deterministic scorer smoke check: reaching 140 is not itself a win.
    ranks,rounds=cup(random.Random(0),[0,1,2,3],[40,30,20,10],[[0]*32 for _ in range(4)],False)
    assert ranks==[1,2,3,4] and rounds==15
    assert abs(badge_score(25)-12500)<1e-8
    assert 0<badge_score(-100)<badge_score(0)<badge_score(25)<badge_score(100)
    populations=[];paths=[]
    for seed in range(SEEDS):
        populations.append(population(seed));paths.append(trajectories(seed))
        print(f'Seed {seed+1}/{SEEDS} complete',flush=True)
    summary=summarize(populations,paths)
    summary['single_cup_examples']=snapshots();summary['repeated_group']=repeated_group()
    (OUT/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf8')
    (OUT/'raw-results.json').write_text(json.dumps({'populations':populations,'trajectories':paths}),encoding='utf8')
    plot(summary,populations,paths)
    print(json.dumps({k:summary[k] for k in ['total_cups_generated','population_summary','elo_accuracy_median','fixed_accuracy_median']},indent=2),flush=True)

if __name__=='__main__':main()
