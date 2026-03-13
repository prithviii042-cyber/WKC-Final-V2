import React, { useState, useMemo, useCallback } from 'react';
import {
  ResponsiveContainer, ComposedChart, LineChart, BarChart, AreaChart,
  Line, Bar, Area, XAxis, YAxis, CartesianGrid as RCG, Tooltip,
  Legend, ReferenceLine, Cell
} from 'recharts';

// ===== DESIGN TOKENS =====
const T = {
  bg0:'#f4f6f9', bg1:'#ffffff', bg2:'#f0f3f7', bg3:'#e8ecf2',
  b0:'#e2e7ef', b1:'#d4dbe7', b2:'#c0cad8',
  t0:'#0f1c2e', t1:'#2d4158', t2:'#5a7190', t3:'#8fa3ba',
  confirmed:'#0c9e5c', contract:'#1478d4', spot:'#d9660a', adj:'#7c3aed',
  warn:'#b5780a', pos:'#0c9e5c', neg:'#c8192e',
  avi:'#6d3fc4', mar:'#0e8a6b', lnd:'#c25a0a',
  ams:'#1265b8', ara:'#0b7a5e', tot:'#7c3aed',
  gold:'#a8740e'
};

// ===== CONSTANTS =====
const HORIZON = 13;
const OPENING_CASH = 16800;
const RCF_DEFAULT = 25000;
const ALERT_DEFAULT = 8000;
const LOCK_WKS = 3;
const OPEX_FIXED = 185;
const COLLECT_RATE = 0.96;
const GROWTH_VOL = 1.05;
const GROWTH_PX = 1.02;
const PRIOR_WKS = 8;
const SPOT_PASS = 0.55;

const SEASONAL = [1.00,1.01,1.02,1.03,1.05,1.07,1.08,1.09,1.08,1.07,1.06,1.05,1.04];
const SEAS_PRIOR = [0.93,0.94,0.95,0.96,0.97,0.97,0.98,0.99];

// ===== SEGMENTS =====
const SEGS = [
  { id:'avi', name:'Aviation', buyPx:940, sellPx:1025, margin:85, vol:1850, dso:40, dpo:12, color:T.avi },
  { id:'mar', name:'Marine',   buyPx:623, sellPx:695,  margin:72, vol:3400, dso:32, dpo:10, color:T.mar },
  { id:'lnd', name:'Land',     buyPx:783, sellPx:861,  margin:78, vol:2200, dso:28, dpo:14, color:T.lnd }
];

// ===== REGIONS =====
const REGIONS = [
  { id:'ams', name:'Americas', flag:'US', volShare:0.52, color:T.ams,
    customers:[
      { name:'United Airlines', seg:'avi', tier:'Prime' },
      { name:'MSC Americas', seg:'mar', tier:'Good' },
      { name:'US Petro Fleet', seg:'lnd', tier:'Good' },
      { name:'Spot Accounts', seg:'all', tier:'Watch' }
    ]},
  { id:'ara', name:'Europe/ARA', flag:'EU', volShare:0.48, color:T.ara,
    customers:[
      { name:'Lufthansa Group', seg:'avi', tier:'Prime' },
      { name:'CMA CGM', seg:'mar', tier:'Prime' },
      { name:'DHL/DB Schenker', seg:'lnd', tier:'Good' },
      { name:'Spot Accounts', seg:'all', tier:'Watch' }
    ]}
];

// ===== CREDIT TIERS =====
const TIERS = { Prime:{dsoMul:0.80,pd:0.01,color:T.confirmed}, Good:{dsoMul:1.00,pd:0.04,color:T.contract}, Watch:{dsoMul:1.35,pd:0.10,color:T.adj} };

// ===== SUPPLY PREMIUMS =====
const SUPPLY_PREM = { port_cong:0.12,vessel_delay:0.12,pipeline:0.12,terminal_cap:0.10,road_strike:0.08,credit_event:0.08,coll_delay:0.08,vol_dispute:0.08 };

// ===== NOISE =====
const noise = (i, salt) => 1 + Math.sin(i*1.31+salt)*0.022 + Math.cos(i*0.71+salt*2.1)*0.012;

// ===== FORMATTERS =====
const n0 = v => new Intl.NumberFormat('en-US').format(Math.round(v ?? 0));
const fK = v => v==null?'--':(v<0?'-$'+n0(Math.abs(v))+'k':'$'+n0(v)+'k');
const fM = v => (v<0?'-$'+Math.abs(v/1000).toFixed(2)+'M':'$'+(v/1000).toFixed(2)+'M');
const clr = (v,p=T.pos,n=T.neg) => v>=0?p:n;


// ===== SCENARIO DEFINITIONS =====
const DISRUPTIONS = [
  { id:'port_cong', name:'Port Congestion', icon:'#', color:'#c2580a', segs:['avi','mar'],
    tags:['Delivery delay'], desc:'Vessel waiting time up -> delivery deferred -> contract AR misses, forced spot buy to cover customer commitment.',
    presets:{mild:{pct:20,dur:2},moderate:{pct:40,dur:3},severe:{pct:65,dur:5}},
    apRatio:0.40, recovery:0.85, spot:true },
  { id:'vessel_delay', name:'Vessel / Barge Delay', icon:'~', color:'#1565c0', segs:['mar'],
    tags:['Marine only'], desc:'Route-specific delay -> Marine AR deferred -> emergency spot buy covers customer gap.',
    presets:{mild:{pct:15,dur:1},moderate:{pct:30,dur:2},severe:{pct:50,dur:3}},
    apRatio:0.60, recovery:0.85, spot:true },
  { id:'road_strike', name:'Road Transport Strike', icon:'!', color:'#b45309', segs:['lnd'],
    tags:['Land only'], desc:'Road logistics halted -> Land deliveries delayed -> spot procurement at premium to fulfil contracts.',
    presets:{mild:{pct:20,dur:1},moderate:{pct:38,dur:2},severe:{pct:58,dur:3}},
    apRatio:0.55, recovery:0.85, spot:true },
  { id:'lc_delay', name:'LC / Letter of Credit Delay', icon:'$', color:'#0369a1', segs:['mar'],
    tags:['Documentation'], desc:'LC processing delay -> AR held pending bank confirmation -> no supply impact, cash timing only.',
    presets:{mild:{pct:35,dur:2},moderate:{pct:35,dur:3},severe:{pct:35,dur:4}},
    apRatio:0, recovery:0.38, spot:false, fixed:true },
  { id:'credit_event', name:'Customer Credit Event', icon:'X', color:'#c8192e', segs:['avi','mar','lnd'],
    tags:['Write-off risk'], desc:'Customer default or downgrade -> partial AR write-off -> forced spot to replace lost volume.',
    presets:{mild:{pct:25,dur:1},moderate:{pct:55,dur:1},severe:{pct:100,dur:1}},
    apRatio:0, recovery:0, spot:true, oneTime:true, arFactor:0.22 }
];

const UPSIDES = [
  { id:'demand_surge', name:'Demand Surge', icon:'+', color:'#0c9e5c', segs:['avi','mar','lnd'],
    tags:['Volume driven'], desc:'Unexpected demand increase across segments -> higher AR with proportional AP increase.',
    presets:{mild:{pct:8,dur:3},moderate:{pct:15,dur:4},severe:{pct:25,dur:6}}, apRatio:0.80 },
  { id:'price_rally', name:'Fuel Price Rally', icon:'^', color:'#1478d4', segs:['avi','mar','lnd'],
    tags:['Price driven'], desc:'Market price rally -> sell prices rise faster than buy -> expanded margin window.',
    presets:{mild:{pct:4,dur:3},moderate:{pct:8,dur:5},severe:{pct:14,dur:8}}, arFactor:0.92, apRatio:0.85 },
  { id:'contract_win', name:'New Contract Win', icon:'*', color:'#0b7a5e', segs:['avi','mar','lnd'],
    tags:['New business'], desc:'New long-term contract secured -> incremental volume and AR at contracted margins.',
    presets:{mild:{pct:5,dur:6},moderate:{pct:10,dur:9},severe:{pct:18,dur:13}}, apRatio:0.82 }
];

const ALL_SCENARIOS = [...DISRUPTIONS, ...UPSIDES];

// ===== MACRO SIGNALS =====
const MACRO_CATS = [
  { id:'price', name:'PRICE DRIVERS', color:'#1478d4' },
  { id:'volume', name:'VOLUME DRIVERS', color:'#0c9e5c' },
  { id:'crack', name:'CRACK SPREADS', color:'#a8740e' },
  { id:'fx', name:'FX', color:'#7c3aed' },
  { id:'logistics', name:'LOGISTICS', color:'#c8192e' }
];

const MACROS = [
  { id:'brent', name:'Brent Crude', icon:'B', cat:'price', unit:'$/bbl', def:82, base:75, type:'px', pxCoeff:1.55, segs:['avi','mar','lnd'],
    desc:'Primary crude benchmark. 85-90% correlation with all fuel prices.',
    formula:`Brent +$1/bbl -> buy cost +$1.55/MT` },
  { id:'eia', name:'EIA Inventory Surprise', icon:'I', cat:'price', unit:'Mbbl vs est.', def:0, base:0, type:'shock', pxCoeff:2.5, segs:['avi','mar','lnd'],
    desc:'Weekly US crude+product stock surprise. Draw -> price spike.',
    formula:`-1Mbbl surprise -> all +$2.5/MT` },
  { id:'opec', name:'OPEC+ Supply Decision', icon:'O', cat:'price', unit:`Mbpd Δ (neg=cut)`, def:0, base:0, type:'shock', pxCoeff:4.0, segs:['avi','mar','lnd'],
    desc:'Production cut flows to all fuel prices within days.',
    formula:`-0.5Mbpd cut -> all +$4/MT` },
  { id:'ati', name:'Air Traffic Index (ATI)', icon:'A', cat:'volume', unit:'RPK % YoY', def:3.2, base:0, type:'vol', volCoeff:0.30, segs:['avi'],
    desc:'IATA weekly RPK growth. Drives Jet A-1 volume + sell price premium when ATI>5%.',
    formula:`ATI +1% -> Avi vol +0.8%` },
  { id:'scfi', name:'SCFI Container Freight', icon:'S', cat:'volume', unit:'Index pts', def:1820, base:1500, type:'vol', volCoeff:0.00017, segs:['mar'],
    desc:'Higher SCFI -> more container ships -> MGO demand.',
    formula:`SCFI +100pts -> Marine vol +1.7%` },
  { id:'pmi', name:'PMI Manufacturing', icon:'P', cat:'volume', unit:'Index', def:52.7, base:50.0, type:'vol', volCoeff:0.012, segs:['lnd'],
    desc:'PMI >50 = expansion. Each point adds diesel demand.',
    formula:`PMI +1pt -> Land vol +1.2%` },
  { id:'dat', name:'DAT Trucking Freight Index', icon:'D', cat:'volume', unit:'Index pts', def:112.6, base:100.0, type:'vol', volCoeff:0.008, segs:['lnd'],
    desc:'Trucking demand proxy. Higher index = more diesel consumption.',
    formula:`DAT +10pts -> Land vol +0.8%` },
  { id:'jet_crack', name:'Jet Crack Spread', icon:'J', cat:'crack', unit:'$/bbl vs Brent', def:18.5, base:16.0, buyCoeff:1.40, sellCoeff:1.00, segs:['avi'],
    desc:'Jet fuel premium over Brent. Widening = buy cost rises faster.',
    formula:`Crack +$1/bbl -> buy +$1.40/MT - sell +$1.00/MT` },
  { id:'diesel_crack', name:'Diesel Crack Spread', icon:'L', cat:'crack', unit:'$/bbl vs Brent', def:22, base:19.0, buyCoeff:1.50, sellCoeff:1.00, segs:['lnd'],
    desc:'ULSD crack. Compression squeezes Land segment margin.',
    formula:`Crack +$1/bbl -> buy +$1.50/MT - sell +$1.00/MT` },
  { id:'bunker_crack', name:'Bunker Crack (VLSFO/Brent)', icon:'K', cat:'crack', unit:'$/bbl vs Brent', def:14.0, base:12.0, buyCoeff:1.20, sellCoeff:1.00, segs:['mar'],
    desc:'VLSFO spread vs Brent. Compression hits Marine margin.',
    formula:`Crack +$1/bbl -> buy +$1.20/MT - sell +$1.00/MT` },
  { id:'dxy', name:'DXY USD Index', icon:'$', cat:'fx', unit:'Index', def:103.5, base:100.0, type:'fx', fxCoeff:0.008, segs:['mar','lnd'],
    desc:'Strong USD -> ARA buy costs rise in EUR terms.',
    formula:`DXY +1pt -> Europe/ARA AP +0.8%` },
  { id:'redsea', name:'Red Sea / Suez Disruption', icon:'R', cat:'logistics', unit:'% vessels re-routed', def:0, base:0, type:'logistics', volCoeff:0.015, pxCoeff:1.5, segs:['mar'],
    desc:'Rerouting via Cape adds 10-14 days -> bunker spike.',
    formula:`10% re-routed -> Marine vol +1.5% - buy px +1.5%` }
];


// ===== PRE-HORIZON SEEDING (module level) =====
function buildPrior(seg, region) {
  const arr = [];
  for (let j = 0; j < PRIOR_WKS; j++) {
    const v = seg.vol * region.volShare * GROWTH_VOL * SEAS_PRIOR[j] * noise(j, region.volShare*100);
    const ar = v * seg.sellPx * GROWTH_PX / 1000;
    const ap = v * seg.buyPx * GROWTH_PX / 1000;
    arr.push({ ar, ap, v });
  }
  return arr;
}

// ===== BUILD MODEL =====
function buildModel(region, shock, scenState, allScenDefs) {
  const shockMul = 1 + (shock || 0) / 100;
  const weeks = [];

  const priors = SEGS.map(s => buildPrior(s, region));

  for (let i = 0; i < HORIZON; i++) {
    const wk = `W${i + 1}`;
    let cAR = 0, cAP = 0, eAR = 0, eAP = 0;
    const segDetail = [];

    SEGS.forEach((seg, si) => {
      const dsoWk = Math.round(seg.dso / 7);
      const dpoWk = Math.round(seg.dpo / 7);
      const prior = priors[si];
      const n = noise(i, region.volShare * 100);
      const vol = seg.vol * region.volShare * GROWTH_VOL * SEASONAL[i] * n;
      const sBuy = seg.buyPx * GROWTH_PX * shockMul;
      const sSell = seg.sellPx * GROWTH_PX * shockMul;

      // Expected AR/AP for this week
      const weekAR = vol * sSell * COLLECT_RATE / 1000;
      const weekAP = vol * sBuy / 1000 + OPEX_FIXED / SEGS.length;

      // Prior period AR/AP tail
      const prIdx = PRIOR_WKS - dsoWk + i;
      const ppIdx = PRIOR_WKS - dpoWk + i;
      const priorAR = (prIdx >= 0 && prIdx < PRIOR_WKS) ? prior[prIdx].ar * COLLECT_RATE : 0;
      const priorAP = (ppIdx >= 0 && ppIdx < PRIOR_WKS) ? prior[ppIdx].ap : 0;

      // Confirmed: W1-W3 locked, W4+ only prior tail
      const confirmedAR = i < LOCK_WKS ? weekAR : priorAR;
      const confirmedAP = i < LOCK_WKS ? weekAP : priorAP;

      // Expected = full planned
      const expectedAR = weekAR + (i >= LOCK_WKS ? priorAR * 0.3 : 0);
      const expectedAP = weekAP + (i >= LOCK_WKS ? priorAP * 0.3 : 0);

      cAR += confirmedAR;
      cAP += confirmedAP;
      eAR += expectedAR;
      eAP += expectedAP;

      segDetail.push({ id: seg.id, vol, buyPx: sBuy, sellPx: sSell, eAR: expectedAR, eAP: expectedAP, cAR: confirmedAR, cAP: confirmedAP });
    });

    // Scenario adjustments
    let sDeltaAR = 0, sDeltaAP = 0, spotAR = 0;
    allScenDefs.forEach(sc => {
      const st = scenState[sc.id];
      if (!st || !st.on) return;
      const { pct, dur, startW } = st;
      const start = startW || 0;
      const isUp = UPSIDES.some(u => u.id === sc.id);

      SEGS.forEach(seg => {
        if (!sc.segs.includes(seg.id)) return;
        const segD = segDetail.find(d => d.id === seg.id);
        if (!segD) return;

        if (isUp) {
          if (i >= start && i < start + dur) {
            const arF = sc.arFactor || 1;
            sDeltaAR += segD.eAR * (pct / 100) * arF;
            sDeltaAP += segD.eAP * (pct / 100) * (sc.apRatio || 0.80);
          }
        } else if (sc.oneTime) {
          if (i === start) {
            const factor = sc.arFactor || 0.22;
            sDeltaAR -= segD.eAR * factor * (pct / 100);
            if (sc.spot) {
              const prem = SUPPLY_PREM[sc.id] || 0.08;
              spotAR += segD.eAR * factor * (pct / 100) * 0.70 * SPOT_PASS * (1 + prem);
            }
          }
        } else if (sc.fixed) {
          if (i >= start && i < start + dur) {
            sDeltaAR -= segD.eAR * 0.35;
          }
          if (i === start + dur && i < HORIZON) {
            sDeltaAR += segD.eAR * sc.recovery * dur * 0.94;
          }
        } else {
          // Standard disruption
          if (i >= start && i < start + dur) {
            sDeltaAR -= segD.eAR * (pct / 100);
            sDeltaAP -= segD.eAP * (pct / 100) * (sc.apRatio || 0.40);
            if (sc.spot) {
              const prem = SUPPLY_PREM[sc.id] || 0.08;
              spotAR += segD.eAR * (pct / 100) * 0.70 * SPOT_PASS * (1 + prem);
            }
          }
          // Recovery window
          const recStart = start + dur;
          const recEnd = recStart + Math.ceil(dur * 0.5);
          if (i >= recStart && i < recEnd) {
            const recFrac = (sc.recovery || 0.85) / Math.ceil(dur * 0.5);
            sDeltaAR += segD.eAR * (pct / 100) * recFrac;
            sDeltaAP += segD.eAP * (pct / 100) * (sc.apRatio || 0.40) * recFrac;
          }
        }
      });
    });

    const adjAR = Math.max(0, eAR + sDeltaAR + spotAR);
    const adjAP = eAP + sDeltaAP;
    const eNet = eAR - eAP;
    const cNet = cAR - cAP;
    const adjNet = adjAR - adjAP;

    weeks.push({
      wk, i,
      cAR, cAP, cNet,
      eAR, eAP, eNet,
      adjAR, adjAP, adjNet,
      sDeltaAR, sDeltaAP, spotAR,
      ctAR: eAR - cAR, // contract portion
      adjCtAR: Math.max(0, (eAR - cAR) + sDeltaAR),
      segDetail
    });
  }

  // Compute balances
  let cBal = OPENING_CASH, eBal = OPENING_CASH, aBal = OPENING_CASH;
  weeks.forEach(w => {
    cBal += w.cNet;
    eBal += w.eNet;
    aBal += w.adjNet;
    cBal = Math.min(cBal, eBal);
    w.cBal = cBal;
    w.eBal = eBal;
    w.aBal = aBal;
    w.aBPos = aBal >= eBal ? aBal : null;
    w.aBNeg = aBal < eBal ? aBal : null;
  });

  return weeks;
}


// ===== SHARED COMPONENTS =====
const Card = ({ children, style }) => (
  <div style={{ background:T.bg1, borderRadius:10, border:`1px solid ${T.b1}`, boxShadow:'0 1px 3px rgba(0,0,0,0.04)', padding:'14px 16px', ...style }}>{children}</div>
);

const Lbl = ({ children, c, style }) => (
  <div style={{ fontSize:8, fontWeight:700, letterSpacing:'0.08em', fontFamily:'monospace', color:c||T.t3, textTransform:'uppercase', ...style }}>{children}</div>
);

const Tog = ({ on, onChange, color }) => (
  <div onClick={onChange} style={{ width:32,height:16,borderRadius:8,background:on?(color||T.confirmed):T.b2,cursor:'pointer',position:'relative',transition:'background .15s' }}>
    <div style={{ width:12,height:12,borderRadius:6,background:'#fff',position:'absolute',top:2,left:on?18:2,transition:'left .15s' }} />
  </div>
);

const Inp = ({ value, onChange, step, width, min, max, style }) => (
  <input type="number" value={value} onChange={e=>onChange(+e.target.value)} step={step||1} min={min} max={max}
    style={{ background:T.bg3,border:`1px solid ${T.b2}`,borderRadius:5,fontFamily:'monospace',fontSize:12,padding:'3px 6px',width:width||60,outline:'none',WebkitAppearance:'none',MozAppearance:'textfield',...style }} />
);

const TT = ({ active, payload, label }) => {
  if (!active || !payload) return null;
  return (
    <div style={{ background:T.bg1, border:`1px solid ${T.b2}`, borderRadius:6, padding:'8px 10px', fontSize:11 }}>
      <div style={{ fontWeight:700, marginBottom:4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color:p.color, marginBottom:2 }}>
          {p.name}: <b>{fK(p.value)}</b>
        </div>
      ))}
    </div>
  );
};

const CG = () => <RCG strokeDasharray="3 3" stroke={T.b0} />;

const tierBadge = (tier) => {
  const t = TIERS[tier];
  return <span style={{ fontSize:9,fontWeight:700,padding:'1px 6px',borderRadius:4,background:t.color+'18',color:t.color }}>{tier}</span>;
};


// ===== MAIN APP COMPONENT =====
export default function App() {
  const [page, setPage] = useState('model');
  const [scen, setScen] = useState(() => {
    const o = {};
    ALL_SCENARIOS.forEach(s => { o[s.id] = { on:false, pct:s.presets.moderate.pct, dur:s.presets.moderate.dur, preset:'moderate', startW:0 }; });
    return o;
  });
  const [macro, setMacro] = useState(() => {
    const o = {};
    MACROS.forEach(m => { o[m.id] = { on:false, value:m.def }; });
    return o;
  });
  const [region, setRegion] = useState('ams');
  const [tier, setTier] = useState('expected');
  const [tab, setTab] = useState('cashflow');
  const [shock, setShock] = useState(0);
  const [thresh, setThresh] = useState(ALERT_DEFAULT);
  const [panel, setPanel] = useState('scen');
  const [saved, setSaved] = useState([]);
  const [saveName, setSaveName] = useState('');

  const upS = useCallback((id, patch) => setScen(prev => ({ ...prev, [id]: { ...prev[id], ...patch } })), []);
  const upM = useCallback((id, patch) => setMacro(prev => ({ ...prev, [id]: { ...prev[id], ...patch } })), []);

  // Build per-region data
  const sdAMS = useMemo(() => buildModel(REGIONS[0], shock, scen, ALL_SCENARIOS), [shock, scen]);
  const sdARA = useMemo(() => buildModel(REGIONS[1], shock, scen, ALL_SCENARIOS), [shock, scen]);

  // Region total = element-wise sum
  const totRD = useMemo(() => sdAMS.map((a, i) => {
    const b = sdARA[i];
    return {
      ...a, wk:a.wk, i:a.i,
      cAR:a.cAR+b.cAR, cAP:a.cAP+b.cAP, cNet:a.cNet+b.cNet,
      eAR:a.eAR+b.eAR, eAP:a.eAP+b.eAP, eNet:a.eNet+b.eNet,
      adjAR:a.adjAR+b.adjAR, adjAP:a.adjAP+b.adjAP, adjNet:a.adjNet+b.adjNet,
      sDeltaAR:a.sDeltaAR+b.sDeltaAR, spotAR:a.spotAR+b.spotAR,
      ctAR:a.ctAR+b.ctAR, adjCtAR:a.adjCtAR+b.adjCtAR,
      cBal:a.cBal+b.cBal, eBal:a.eBal+b.eBal, aBal:a.aBal+b.aBal,
      aBPos:(a.aBal+b.aBal)>=(a.eBal+b.eBal)?(a.aBal+b.aBal):null,
      aBNeg:(a.aBal+b.aBal)<(a.eBal+b.eBal)?(a.aBal+b.aBal):null
    };
  }), [sdAMS, sdARA]);

  const rd = region === 'ams' ? sdAMS : region === 'ara' ? sdARA : totRD;



  // Macro deltas
  const mDelta = useMemo(() => {
    return rd.map((w, i) => {
      let mAR = 0, mAP = 0;
      MACROS.forEach(mc => {
        const ms = macro[mc.id];
        if (!ms || !ms.on) return;
        const delta = ms.value - mc.base;
        if (delta === 0) return;
        mc.segs.forEach(segId => {
          const seg = SEGS.find(s => s.id === segId);
          if (!seg) return;
          const volBase = seg.vol * (region === 'tot' ? 1 : (region === 'ams' ? 0.52 : 0.48));
          if (mc.type === 'px' || mc.type === 'shock') {
            mAP += volBase * delta * mc.pxCoeff / 1000;
            mAR += volBase * delta * mc.pxCoeff * 0.84 / 1000;
          } else if (mc.type === 'vol') {
            mAR += volBase * seg.sellPx * delta * (mc.volCoeff || 0.01) / 1000;
            mAP += volBase * seg.buyPx * delta * (mc.volCoeff || 0.01) * 0.80 / 1000;
          } else if (mc.type === 'crack') {
            mAP += volBase * delta * (mc.buyCoeff || 1) / 1000;
            mAR += volBase * delta * (mc.sellCoeff || 1) / 1000;
          } else if (mc.type === 'fx') {
            mAP += volBase * seg.buyPx * delta * (mc.fxCoeff || 0.005) / 1000;
            mAR += volBase * seg.sellPx * delta * (mc.fxCoeff || 0.005) * 0.5 / 1000;
          } else if (mc.type === 'logistics') {
            mAR += volBase * seg.sellPx * delta * (mc.volCoeff || 0.01) / 1000;
            mAP += volBase * seg.buyPx * delta * (mc.pxCoeff || 1) / 1000;
          }
        });
      });
      return { mAR, mAP, mNet: mAR - mAP };
    });
  }, [rd, macro, region]);

  // P2 consolidated with macro
  const p2 = useMemo(() => {
    let bal = OPENING_CASH * (region === 'tot' ? 2 : 1);
    return rd.map((w, i) => {
      const md = mDelta[i];
      const fullNet = w.adjNet + md.mNet;
      bal += fullNet;
      return { ...w, mAR:md.mAR, mAP:md.mAP, mNet:md.mNet, fullNet, mBal:bal };
    });
  }, [rd, mDelta, region]);

  const activeScenCount = ALL_SCENARIOS.filter(s => scen[s.id]?.on).length;
  const activeMacroCount = MACROS.filter(m => macro[m.id]?.on).length;

  // KPI calculations
  const kpi = (() => {
    const eAR13 = rd.reduce((s,w) => s+w.eAR, 0);
    const eAP13 = rd.reduce((s,w) => s+w.eAP, 0);
    const eNet13 = eAR13 - eAP13;
    const scenOnlyAdj13 = rd.reduce((s,w) => s+w.adjNet, 0);
    const macroNet13 = mDelta.reduce((s,d) => s+d.mNet, 0);
    const adjNet13 = scenOnlyAdj13 + macroNet13;
    const minEBal = Math.min(...rd.map(w => w.eBal));
    const cAR13 = rd.reduce((s,w) => s+w.cAR, 0);
    const scenActive = activeScenCount > 0 || activeMacroCount > 0;
    // Use p2 for macro-inclusive balance
    const minABal = p2.length > 0 ? Math.min(...p2.map(w => w.mBal)) : Math.min(...rd.map(w => w.aBal));
    const delta = adjNet13 - eNet13;
    const alertWks = p2.length > 0 ? p2.filter(w => w.mBal < thresh).length : rd.filter(w => w.aBal < thresh).length;
    const maxDraw = p2.length > 0 ? Math.max(0, ...p2.map(w => -w.mBal)) : Math.max(0, ...rd.map(w => -w.aBal));
    return { eAR13, eAP13, eNet13, adjNet13, minEBal, cAR13, minABal, scenActive, delta, alertWks, maxDraw };
  })();





  // ===== RENDER =====
  return (
    <div style={{ background:T.bg0, minHeight:'100vh', fontFamily:'-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif', color:T.t1 }}>

      {/* HEADER */}
      <div style={{ background:T.bg1, borderBottom:`1px solid ${T.b1}`, padding:'10px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:32,height:32,borderRadius:16,background:'linear-gradient(135deg,#1478d4,#7c3aed)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:800,fontSize:14 }}>W</div>
          <div>
            <div style={{ fontSize:14,fontWeight:700,color:T.t0 }}>WKC Treasury</div>
            <div style={{ fontSize:9,color:T.t3 }}>13-Week Cashflow Forecast | POC v3</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          {['model','scenario'].map(p => (
            <button key={p} onClick={()=>setPage(p)}
              style={{ padding:'6px 14px',borderRadius:6,border:`1px solid ${page===p?T.contract:T.b1}`,background:page===p?T.contract+'10':T.bg1,color:page===p?T.contract:T.t2,fontWeight:600,fontSize:12,cursor:'pointer' }}>
              {p==='model'?'Forecast Model':`Scenario Builder (${activeScenCount})`}
            </button>
          ))}
        </div>
      </div>

      {page === 'model' ? (
        <div style={{ padding:'16px 24px' }}>

          {/* KPI TILES */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:10, marginBottom:14 }}>
            {[
              { label:'Exp AR 13W', value:fM(kpi.eAR13), color:T.contract },
              { label:'Exp AP 13W', value:fM(kpi.eAP13), color:T.neg },
              { label:'Exp Net 13W', value:fM(kpi.eNet13), color:clr(kpi.eNet13), sub:`W4: ${fK(rd[3]?.eNet)}  W13: ${fK(rd[12]?.eNet)}` },
              { label:'Scen Adj Net', value:kpi.scenActive?fM(kpi.adjNet13):'--', color:kpi.scenActive?clr(kpi.delta):T.t3, sub:kpi.scenActive?`Delta: ${fM(kpi.delta)}`:'' },
              { label:'Min Exp Balance', value:fM(kpi.minEBal), color:kpi.minEBal<thresh?T.neg:T.pos },
              { label:'Confirmed AR', value:fM(kpi.cAR13), color:T.confirmed }
            ].map((k,i) => (
              <Card key={i} style={{ background:T.bg2 }}>
                <Lbl>{k.label}</Lbl>
                <div style={{ fontSize:18,fontWeight:700,color:k.color,marginTop:4 }}>{k.value}</div>
                {k.sub && <div style={{ fontSize:9,color:T.t3,marginTop:2 }}>{k.sub}</div>}
              </Card>
            ))}
          </div>

          {/* SUB-HEADER CONTROLS */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
            <div style={{ display:'flex', gap:6, alignItems:'center' }}>
              {['expected','adj'].map(t => (
                <button key={t} onClick={()=>setTier(t)}
                  style={{ padding:'5px 12px',borderRadius:5,border:`1px solid ${tier===t?(t==='expected'?T.contract:clr(kpi.delta)):T.b1}`,
                    background:tier===t?(t==='expected'?T.contract+'10':clr(kpi.delta)+'10'):T.bg1,
                    color:tier===t?(t==='expected'?T.contract:clr(kpi.delta)):T.t2,fontWeight:600,fontSize:11,cursor:'pointer' }}>
                  {t==='expected'?'Expected':`Scenario Adj ${kpi.scenActive?fM(kpi.delta):''}`}
                </button>
              ))}
              <div style={{ marginLeft:16,display:'flex',alignItems:'center',gap:6 }}>
                <Lbl>Index Shock</Lbl>
                <input type="range" min={-20} max={30} value={shock} onChange={e=>setShock(+e.target.value)} style={{ width:100 }} />
                <span style={{ fontSize:11,fontWeight:700,fontFamily:'monospace',color:shock===0?T.t3:clr(shock) }}>{shock>0?'+':''}{shock}%</span>
                {shock!==0 && <button onClick={()=>setShock(0)} style={{ fontSize:9,padding:'1px 6px',borderRadius:3,border:`1px solid ${T.b2}`,background:T.bg2,cursor:'pointer',color:T.t2 }}>Reset</button>}
              </div>
            </div>
            <div style={{ display:'flex', gap:6 }}>
              {[{id:'ams',name:'Americas',flag:'US',data:sdAMS},{id:'ara',name:'Europe/ARA',flag:'EU',data:sdARA},{id:'tot',name:'Total',flag:'GL',data:totRD}].map(r => {
                const net13 = r.data.reduce((s,w)=>s+w.eNet,0);
                const minB = Math.min(...r.data.map(w=>w.eBal));
                return (
                  <button key={r.id} onClick={()=>setRegion(r.id)}
                    style={{ padding:'5px 10px',borderRadius:5,border:`1px solid ${region===r.id?T.contract:T.b1}`,background:region===r.id?T.contract+'10':T.bg1,cursor:'pointer',textAlign:'left',minWidth:120 }}>
                    <div style={{ display:'flex',alignItems:'center',gap:4 }}>
                      <span style={{ fontSize:9,fontWeight:700,padding:'1px 4px',borderRadius:2,background:T.b0 }}>{r.flag}</span>
                      <span style={{ fontSize:11,fontWeight:600,color:region===r.id?T.contract:T.t1 }}>{r.name}</span>
                    </div>
                    <div style={{ fontSize:9,color:T.t3,marginTop:2 }}>Net: {fM(net13)} | Min: {fM(minB)}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* TAB NAV */}
          <div style={{ display:'flex', gap:0, borderBottom:`1px solid ${T.b1}`, marginBottom:14 }}>
            {['cashflow','AP','AR','Price','Consolidated'].map(t => (
              <button key={t} onClick={()=>setTab(t)}
                style={{ padding:'8px 16px',border:'none',borderBottom:tab===t?`2px solid ${T.contract}`:'2px solid transparent',background:'none',
                  color:tab===t?T.contract:T.t2,fontWeight:tab===t?700:500,fontSize:12,cursor:'pointer' }}>
                {t === 'cashflow' ? 'Cash Flow' : t}
              </button>
            ))}
          </div>


          {/* CASH FLOW TAB */}
          {tab === 'cashflow' && (
            <div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
                <Card>
                  <Lbl style={{ marginBottom:8 }}>Cash Balance</Lbl>
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart data={rd}>
                      <CG />
                      <XAxis dataKey="wk" tick={{ fill:T.t2, fontSize:9 }} />
                      <YAxis yAxisId="n" tick={{ fill:T.t2, fontSize:9 }} tickFormatter={v=>fK(v)} />
                      <YAxis yAxisId="b" orientation="right" tick={{ fill:T.t2, fontSize:9 }} tickFormatter={v=>fK(v)} />
                      <Tooltip content={<TT />} />
                      <Bar yAxisId="n" dataKey={tier==='adj'?'adjNet':'eNet'} name="Net" maxBarSize={16} radius={[3,3,0,0]}>
                        {rd.map((w,i) => <Cell key={i} fill={((tier==='adj'?w.adjNet:w.eNet)>=0?T.pos:T.neg)+'66'} />)}
                      </Bar>
                      <Line yAxisId="b" type="monotone" dataKey="cBal" name="Confirmed" stroke={T.confirmed} strokeDasharray="4 3" dot={false} />
                      <Line yAxisId="b" type="monotone" dataKey="eBal" name="Expected" stroke={T.contract} strokeWidth={2.5} dot={false} />
                      {kpi.scenActive && <Line yAxisId="b" type="monotone" dataKey="aBPos" name="Adj (up)" stroke={T.pos} strokeDasharray="4 3" dot={false} connectNulls={false} />}
                      {kpi.scenActive && <Line yAxisId="b" type="monotone" dataKey="aBNeg" name="Adj (down)" stroke={T.neg} strokeDasharray="4 3" dot={false} connectNulls={false} />}
                      <ReferenceLine yAxisId="b" y={thresh} stroke={T.warn} strokeDasharray="4 3" label={{ value:`Alert ${fK(thresh)}`, fill:T.warn, fontSize:9 }} />
                      <ReferenceLine yAxisId="n" y={0} stroke={T.b1} />
                      <Legend wrapperStyle={{ fontSize:9 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  {kpi.scenActive && (
                    <div style={{ textAlign:'center', marginTop:4 }}>
                      <span style={{ fontSize:10, padding:'2px 8px', borderRadius:4, background:clr(kpi.delta)+'15', color:clr(kpi.delta), fontWeight:600 }}>
                        {activeScenCount} scenarios active - {kpi.delta>=0?'+':''}{fM(kpi.delta)} vs Expected
                      </span>
                    </div>
                  )}
                </Card>
                <Card>
                  <Lbl style={{ marginBottom:8 }}>AR by Source</Lbl>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={rd}>
                      <CG />
                      <XAxis dataKey="wk" tick={{ fill:T.t2, fontSize:9 }} />
                      <YAxis tick={{ fill:T.t2, fontSize:9 }} tickFormatter={v=>fK(v)} />
                      <Tooltip content={<TT />} />
                      <Bar dataKey="cAR" name="Confirmed AR" stackId="s" fill={T.confirmed} maxBarSize={16} />
                      <Bar dataKey={tier==='adj'?'adjCtAR':'ctAR'} name="Contract AR" stackId="s" fill={T.contract} maxBarSize={16} radius={[3,3,0,0]} />
                      {tier==='adj' && kpi.scenActive && <Bar dataKey="spotAR" name="Forced Spot AR" stackId="s" fill={T.adj} maxBarSize={16} radius={[3,3,0,0]} />}
                      <Legend wrapperStyle={{ fontSize:9 }} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </div>

              {/* DETAIL TABLE */}
              <Card>
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11, fontFamily:'monospace' }}>
                    <thead>
                      <tr style={{ borderBottom:`1px solid ${T.b1}` }}>
                        <th style={{ textAlign:'left', padding:'6px 8px', color:T.t2, fontSize:9, fontWeight:600 }}>Row</th>
                        {rd.map(w => <th key={w.wk} style={{ textAlign:'right', padding:'6px 4px', color:T.t2, fontSize:9, fontWeight:600 }}>{w.wk}</th>)}
                        <th style={{ textAlign:'right', padding:'6px 8px', color:T.t2, fontSize:9, fontWeight:600, background:T.bg3 }}>TOTAL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label:'AR Confirmed', key:'cAR' },
                        { label:'AR Contract', key:tier==='adj'?'adjCtAR':'ctAR' },
                        { label:'TOTAL AR', key:tier==='adj'?'adjAR':'eAR', bold:true },
                        { label:'AP Confirmed', key:'cAP' },
                        { label:'AP Contract', key:tier==='adj'?'adjAP':'eAP' },
                        { label:'TOTAL AP', key:tier==='adj'?'adjAP':'eAP', bold:true },
                        { label:'NET', key:tier==='adj'?'adjNet':'eNet', bold:true, colored:true },
                        { label:'BALANCE', key:tier==='adj'?'aBal':'eBal', bold:true, colored:true }
                      ].map((row,ri) => {
                        const total = rd.reduce((s,w) => s + (w[row.key]||0), 0);
                        return (
                          <tr key={ri} style={{ borderBottom:`1px solid ${T.b0}`, background:row.bold?T.bg2:'transparent' }}>
                            <td style={{ padding:'5px 8px', fontWeight:row.bold?700:400, fontSize:10, color:T.t1 }}>{row.label}</td>
                            {rd.map(w => {
                              const v = w[row.key] || 0;
                              return <td key={w.wk} style={{ textAlign:'right', padding:'5px 4px', fontWeight:row.bold?600:400, color:row.colored?clr(v):T.t1 }}>{fK(v)}</td>;
                            })}
                            <td style={{ textAlign:'right', padding:'5px 8px', fontWeight:700, background:T.bg3, color:row.colored?clr(total):T.t1 }}>{row.key==='aBal'||row.key==='eBal'?fK(rd[12]?.[row.key]):fK(total)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}


          {/* AP TAB */}
          {tab === 'AP' && (
            <div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
                <Card>
                  <Lbl style={{ marginBottom:8 }}>AP by Source</Lbl>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={rd}>
                      <CG />
                      <XAxis dataKey="wk" tick={{ fill:T.t2, fontSize:9 }} />
                      <YAxis tick={{ fill:T.t2, fontSize:9 }} tickFormatter={v=>fK(v)} />
                      <Tooltip content={<TT />} />
                      <Bar dataKey="cAP" name="Confirmed AP" stackId="s" fill={T.confirmed} maxBarSize={16} />
                      <Bar dataKey={tier==='adj'?'adjAP':'eAP'} name="Contract AP" stackId="s" fill={T.contract} maxBarSize={16} radius={[3,3,0,0]} />
                      <Legend wrapperStyle={{ fontSize:9 }} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
                <Card>
                  <Lbl style={{ marginBottom:8 }}>Segment Volume (MT/wk)</Lbl>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={rd.map(w => {
                      const o = { wk:w.wk };
                      w.segDetail?.forEach(s => { o[s.id] = Math.round(s.vol); });
                      return o;
                    })}>
                      <CG />
                      <XAxis dataKey="wk" tick={{ fill:T.t2, fontSize:9 }} />
                      <YAxis tick={{ fill:T.t2, fontSize:9 }} />
                      <Tooltip />
                      {SEGS.map((s,i) => <Bar key={s.id} dataKey={s.id} name={s.name} stackId="s" fill={s.color} maxBarSize={16} radius={i===SEGS.length-1?[3,3,0,0]:[0,0,0,0]} />)}
                      <Legend wrapperStyle={{ fontSize:9 }} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </div>
              <Card>
                <Lbl style={{ marginBottom:8 }}>Segment Assumptions</Lbl>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                  <thead>
                    <tr style={{ borderBottom:`1px solid ${T.b1}` }}>
                      {['Segment','Buy Px','Sell Px','Margin','Vol (MT/wk)','DSO','DPO'].map(h => (
                        <th key={h} style={{ textAlign:'left', padding:'6px 8px', color:T.t2, fontSize:9, fontWeight:600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SEGS.map(s => (
                      <tr key={s.id} style={{ borderBottom:`1px solid ${T.b0}` }}>
                        <td style={{ padding:'5px 8px', fontWeight:600, color:s.color }}>{s.name}</td>
                        <td style={{ padding:'5px 8px', fontFamily:'monospace' }}>${s.buyPx}</td>
                        <td style={{ padding:'5px 8px', fontFamily:'monospace' }}>${s.sellPx}</td>
                        <td style={{ padding:'5px 8px', fontFamily:'monospace' }}>${s.margin}</td>
                        <td style={{ padding:'5px 8px', fontFamily:'monospace' }}>{n0(s.vol)}</td>
                        <td style={{ padding:'5px 8px', fontFamily:'monospace' }}>{s.dso}d</td>
                        <td style={{ padding:'5px 8px', fontFamily:'monospace' }}>{s.dpo}d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          )}

          {/* AR TAB */}
          {tab === 'AR' && (
            <div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
                <Card>
                  <Lbl style={{ marginBottom:8 }}>AR by Source</Lbl>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={rd}>
                      <CG />
                      <XAxis dataKey="wk" tick={{ fill:T.t2, fontSize:9 }} />
                      <YAxis tick={{ fill:T.t2, fontSize:9 }} tickFormatter={v=>fK(v)} />
                      <Tooltip content={<TT />} />
                      <Area type="monotone" dataKey="cAR" name="Confirmed" stackId="s" fill={T.confirmed+'25'} stroke={T.confirmed} />
                      <Area type="monotone" dataKey="ctAR" name="Contract" stackId="s" fill={T.contract+'25'} stroke={T.contract} />
                      <Legend wrapperStyle={{ fontSize:9 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </Card>
                <Card>
                  <Lbl style={{ marginBottom:8 }}>Customer Credit Matrix</Lbl>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                    <thead>
                      <tr style={{ borderBottom:`1px solid ${T.b1}` }}>
                        {['Customer','Segment','Tier','DSO','PD%'].map(h => (
                          <th key={h} style={{ textAlign:'left', padding:'5px 8px', color:T.t2, fontSize:9, fontWeight:600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(region==='tot'?[...REGIONS[0].customers,...REGIONS[1].customers]:REGIONS.find(r=>r.id===region)?.customers||[]).map((c,i) => {
                        const t = TIERS[c.tier];
                        const seg = SEGS.find(s=>s.id===c.seg);
                        return (
                          <tr key={i} style={{ borderBottom:`1px solid ${T.b0}` }}>
                            <td style={{ padding:'4px 8px', fontWeight:500 }}>{c.name}</td>
                            <td style={{ padding:'4px 8px', color:seg?.color||T.t1 }}>{seg?.name||'All'}</td>
                            <td style={{ padding:'4px 8px' }}>{tierBadge(c.tier)}</td>
                            <td style={{ padding:'4px 8px', fontFamily:'monospace' }}>{seg?Math.round(seg.dso*t.dsoMul):'-'}d</td>
                            <td style={{ padding:'4px 8px', fontFamily:'monospace', color:t.pd>0.05?T.neg:T.t1 }}>{(t.pd*100).toFixed(0)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Card>
              </div>
            </div>
          )}


          {/* PRICE TAB */}
          {tab === 'Price' && (
            <div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
                <Card>
                  <Lbl style={{ marginBottom:8 }}>Effective Prices ($/MT)</Lbl>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={rd.map(w => {
                      const o = { wk:w.wk };
                      w.segDetail?.forEach(s => { o[s.id+'Buy']=Math.round(s.buyPx); o[s.id+'Sell']=Math.round(s.sellPx); });
                      return o;
                    })}>
                      <CG />
                      <XAxis dataKey="wk" tick={{ fill:T.t2, fontSize:9 }} />
                      <YAxis tick={{ fill:T.t2, fontSize:9 }} />
                      <Tooltip />
                      {SEGS.map(s => (
                        <React.Fragment key={s.id}>
                          <Line type="monotone" dataKey={s.id+'Buy'} name={`${s.name} Buy`} stroke={s.color} strokeDasharray="4 3" dot={false} />
                          <Line type="monotone" dataKey={s.id+'Sell'} name={`${s.name} Sell`} stroke={s.color} strokeWidth={2} dot={false} />
                        </React.Fragment>
                      ))}
                      <Legend wrapperStyle={{ fontSize:9 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
                <Card>
                  <Lbl style={{ marginBottom:8 }}>Spot Premium Structure</Lbl>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                    <thead>
                      <tr style={{ borderBottom:`1px solid ${T.b1}` }}>
                        {['Disruption Type','Buy Premium %','Sell Pass-through %','Margin Squeeze %'].map(h => (
                          <th key={h} style={{ textAlign:'left', padding:'5px 8px', color:T.t2, fontSize:9, fontWeight:600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(SUPPLY_PREM).map(([k,v]) => (
                        <tr key={k} style={{ borderBottom:`1px solid ${T.b0}` }}>
                          <td style={{ padding:'4px 8px', fontWeight:500 }}>{k.replace(/_/g,' ')}</td>
                          <td style={{ padding:'4px 8px', fontFamily:'monospace' }}>{(v*100).toFixed(0)}%</td>
                          <td style={{ padding:'4px 8px', fontFamily:'monospace' }}>{(SPOT_PASS*100).toFixed(0)}%</td>
                          <td style={{ padding:'4px 8px', fontFamily:'monospace', color:T.neg }}>{((1-(SPOT_PASS*(1+v))/(1+v))*100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            </div>
          )}

          {/* CONSOLIDATED TAB */}
          {tab === 'Consolidated' && (
            <div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
                <Card>
                  <Lbl style={{ marginBottom:8 }}>Net by Region</Lbl>
                  <ResponsiveContainer width="100%" height={220}>
                    <ComposedChart data={totRD.map((w,i) => ({
                      wk:w.wk,
                      ams:sdAMS[i].eNet,
                      ara:sdARA[i].eNet,
                      total:w.eNet
                    }))}>
                      <CG />
                      <XAxis dataKey="wk" tick={{ fill:T.t2, fontSize:9 }} />
                      <YAxis tick={{ fill:T.t2, fontSize:9 }} tickFormatter={v=>fK(v)} />
                      <Tooltip content={<TT />} />
                      <Bar dataKey="ams" name="Americas" stackId="s" fill={T.ams} maxBarSize={16} />
                      <Bar dataKey="ara" name="Europe/ARA" stackId="s" fill={T.ara} maxBarSize={16} radius={[3,3,0,0]} />
                      <Line type="monotone" dataKey="total" name="Total" stroke={T.gold} strokeWidth={2} dot={false} />
                      <Legend wrapperStyle={{ fontSize:9 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </Card>
                <Card>
                  <Lbl style={{ marginBottom:8 }}>Region Scorecard</Lbl>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                    <thead>
                      <tr style={{ borderBottom:`1px solid ${T.b1}` }}>
                        {['Region','Exp Net','Adj Net','Delta','Min Balance'].map(h => (
                          <th key={h} style={{ textAlign:'left', padding:'6px 8px', color:T.t2, fontSize:9, fontWeight:600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { name:'Americas', d:sdAMS },
                        { name:'Europe/ARA', d:sdARA },
                        { name:'Total', d:totRD, bold:true }
                      ].map(r => {
                        const en = r.d.reduce((s,w)=>s+w.eNet,0);
                        const an = r.d.reduce((s,w)=>s+w.adjNet,0);
                        const d = an - en;
                        const mb = Math.min(...r.d.map(w=>w.eBal));
                        return (
                          <tr key={r.name} style={{ borderBottom:`1px solid ${T.b0}`, background:r.bold?T.bg2:'transparent' }}>
                            <td style={{ padding:'5px 8px', fontWeight:r.bold?700:500 }}>{r.name}</td>
                            <td style={{ padding:'5px 8px', fontFamily:'monospace' }}>{fM(en)}</td>
                            <td style={{ padding:'5px 8px', fontFamily:'monospace' }}>{kpi.scenActive?fM(an):'--'}</td>
                            <td style={{ padding:'5px 8px', fontFamily:'monospace', fontWeight:700, color:kpi.scenActive?clr(d):T.t3 }}>{kpi.scenActive?fM(d):'--'}</td>
                            <td style={{ padding:'5px 8px', fontFamily:'monospace', color:mb<thresh?T.neg:T.t1 }}>{fM(mb)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Card>
              </div>
            </div>
          )}

        </div>
      ) : (


        /* PAGE 2: SCENARIO BUILDER */
        <div style={{ padding:'16px 24px' }}>

          {/* KPI ARITHMETIC PROOF ROW */}
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
            <Card style={{ background:T.contract+'10', flex:'0 0 auto' }}>
              <Lbl c={T.contract}>Expected Net</Lbl>
              <div style={{ fontSize:16,fontWeight:700,color:T.contract }}>{fM(kpi.eNet13)}</div>
            </Card>
            <span style={{ fontSize:18,fontWeight:700,color:T.t3 }}>-</span>
            <Card style={{ background:(kpi.delta>=0?T.pos:T.neg)+'10', flex:'0 0 auto' }}>
              <Lbl c={kpi.scenActive?clr(kpi.delta):T.t3}>Scenario Delta</Lbl>
              <div style={{ fontSize:16,fontWeight:700,color:kpi.scenActive?clr(kpi.delta):T.t3 }}>{kpi.scenActive?fM(kpi.delta):'--'}</div>
            </Card>
            <span style={{ fontSize:18,fontWeight:700,color:T.t3 }}>=</span>
            <Card style={{ background:T.bg2, flex:'0 0 auto' }}>
              <Lbl c={T.t2}>Scenario Adj</Lbl>
              <div style={{ fontSize:16,fontWeight:700,color:kpi.scenActive?clr(kpi.adjNet13):T.t3 }}>{kpi.scenActive?fM(kpi.adjNet13):'--'}</div>
            </Card>
            <div style={{ flex:1 }} />
            {[
              { label:'Min Adj Balance', value:kpi.scenActive?fM(kpi.minABal):'--', color:kpi.minABal<thresh?T.neg:T.pos },
              { label:'Max RCF Draw', value:kpi.maxDraw>0?fK(kpi.maxDraw):'$0k', color:kpi.maxDraw/RCF_DEFAULT>0.8?T.neg:T.t1 },
              { label:'Alert Weeks', value:`${kpi.alertWks}/13`, color:kpi.alertWks>0?T.neg:T.pos },
              { label:'Active Scenarios', value:String(activeScenCount), color:activeScenCount>0?T.adj:T.t3 }
            ].map((k,i) => (
              <Card key={i} style={{ flex:'0 0 auto', minWidth:100 }}>
                <Lbl>{k.label}</Lbl>
                <div style={{ fontSize:14,fontWeight:700,color:k.color,marginTop:2 }}>{k.value}</div>
              </Card>
            ))}
            <div style={{ display:'flex',alignItems:'center',gap:6 }}>
              <Lbl>Alert Threshold</Lbl>
              <Inp value={thresh} onChange={setThresh} step={500} width={70} />
            </div>
          </div>

          {/* PANEL TOGGLE */}
          <div style={{ display:'flex', gap:6, marginBottom:14 }}>
            {[{id:'scen',label:`Scenarios (${activeScenCount})`},{id:'macro',label:`Macro Signals (${activeMacroCount})`}].map(p => (
              <button key={p.id} onClick={()=>setPanel(p.id)}
                style={{ padding:'6px 14px',borderRadius:5,border:`1px solid ${panel===p.id?T.contract:T.b1}`,background:panel===p.id?T.contract+'10':T.bg1,
                  color:panel===p.id?T.contract:T.t2,fontWeight:600,fontSize:12,cursor:'pointer' }}>
                {p.label}
              </button>
            ))}
          </div>


          {/* SCENARIOS PANEL */}
          {panel === 'scen' && (
            <div style={{ display:'grid', gridTemplateColumns:'380px 1fr', gap:14 }}>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                <Lbl c={T.neg} style={{ fontSize:10 }}>Disruption Scenarios</Lbl>
                {DISRUPTIONS.map(sc => {
                  const st = scen[sc.id];
                  return (
                    <Card key={sc.id} style={{ background:T.bg1, borderRadius:10, padding:'16px 18px' }}>
                      {/* Header row: icon + name + tags + toggle */}
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                          <span style={{ fontSize:14, fontWeight:700, color:sc.color }}>{sc.icon}</span>
                          <span style={{ fontSize:13, fontWeight:700, color:T.t0 }}>{sc.name}</span>
                          {(sc.tags||[]).map(tag => (
                            <span key={tag} style={{ fontSize:9, fontWeight:600, padding:'2px 8px', borderRadius:4, background:T.bg2, color:T.t2, border:`1px solid ` }}>{tag}</span>
                          ))}
                          {sc.spot && <span style={{ fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:4, background:T.neg+'12', color:T.neg, display:'flex', alignItems:'center', gap:3 }}><span style={{ width:6,height:6,borderRadius:3,background:T.neg,display:'inline-block' }}></span> spot</span>}
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <span style={{ fontSize:10, color:T.t3, fontWeight:500 }}>{st.on?'ON':'OFF'}</span>
                          <Tog on={st.on} onChange={()=>upS(sc.id,{on:!st.on})} color={sc.color} />
                        </div>
                      </div>

                      {/* Description */}
                      <div style={{ fontSize:11, color:T.t2, lineHeight:1.4, marginBottom:10 }}>{sc.desc}</div>

                      {/* Segment badges */}
                      <div style={{ display:'flex', gap:4, marginBottom:12 }}>
                        {sc.segs.map(sid => {
                          const seg = SEGS.find(x=>x.id===sid);
                          return <span key={sid} style={{ fontSize:9, fontWeight:600, padding:'2px 8px', borderRadius:4, background:seg?.color+'12', color:seg?.color, border:`1px solid 30` }}>{seg?.name}</span>;
                        })}
                      </div>

                      {/* Controls: Start Week, Duration, Intensity */}
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:12 }}>
                        <div>
                          <Lbl style={{ marginBottom:4 }}>START WEEK</Lbl>
                          <select value={st.startW||0} onChange={e=>upS(sc.id,{startW:+e.target.value})}
                            style={{ width:'100%', padding:'6px 8px', borderRadius:6, border:`1px solid `, background:T.bg1, fontSize:11, fontFamily:'monospace', color:T.t1, outline:'none', cursor:'pointer' }}>
                            {Array.from({length:HORIZON},(_,i)=>i).map(w => (
                              <option key={w} value={w}>W{w+1}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <Lbl style={{ marginBottom:4 }}>DURATION (WKS)</Lbl>
                          <Inp value={st.dur} onChange={v=>upS(sc.id,{dur:v,preset:null})} step={1} width={'100%'} min={1} max={13} style={{ width:'100%', padding:'6px 8px', borderRadius:6 }} />
                        </div>
                        <div>
                          <Lbl style={{ marginBottom:4 }}>INTENSITY (%)</Lbl>
                          <Inp value={st.pct} onChange={v=>upS(sc.id,{pct:v,preset:null})} step={5} width={'100%'} min={0} max={100} style={{ width:'100%', padding:'6px 8px', borderRadius:6 }} />
                        </div>
                      </div>

                      {/* Presets: Mild / Moderate / Severe */}
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
                        {['mild','moderate','severe'].map(p => {
                          const pr = sc.presets[p];
                          const active = st.preset === p;
                          return (
                            <button key={p} onClick={()=>upS(sc.id,{pct:pr.pct,dur:pr.dur,preset:p})}
                              style={{ padding:'8px 6px', borderRadius:6, border:`1px solid `,
                                background:active?sc.color+'12':T.bg2, cursor:'pointer', textAlign:'center' }}>
                              <div style={{ fontSize:11, fontWeight:700, color:active?sc.color:T.t1, textTransform:'uppercase' }}>{p}</div>
                              <div style={{ fontSize:10, color:T.t3, marginTop:2, fontFamily:'monospace' }}>{pr.pct}% &middot; {pr.dur}wk</div>
                            </button>
                          );
                        })}
                      </div>
                    </Card>
                  );
                })}

                <Lbl c={T.pos} style={{ fontSize:10, marginTop:8 }}>Upside Scenarios</Lbl>
                {UPSIDES.map(sc => {
                  const st = scen[sc.id];
                  return (
                    <Card key={sc.id} style={{ background:T.bg1, borderRadius:10, padding:'16px 18px' }}>
                      {/* Header row */}
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                          <span style={{ fontSize:14, fontWeight:700, color:sc.color }}>{sc.icon}</span>
                          <span style={{ fontSize:13, fontWeight:700, color:T.t0 }}>{sc.name}</span>
                          {(sc.tags||[]).map(tag => (
                            <span key={tag} style={{ fontSize:9, fontWeight:600, padding:'2px 8px', borderRadius:4, background:T.bg2, color:T.t2, border:`1px solid ` }}>{tag}</span>
                          ))}
                          <span style={{ fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:4, background:T.pos+'12', color:T.pos }}>UPSIDE</span>
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <span style={{ fontSize:10, color:T.t3, fontWeight:500 }}>{st.on?'ON':'OFF'}</span>
                          <Tog on={st.on} onChange={()=>upS(sc.id,{on:!st.on})} color={sc.color} />
                        </div>
                      </div>

                      {/* Description */}
                      <div style={{ fontSize:11, color:T.t2, lineHeight:1.4, marginBottom:10 }}>{sc.desc}</div>

                      {/* Segment badges */}
                      <div style={{ display:'flex', gap:4, marginBottom:12 }}>
                        {sc.segs.map(sid => {
                          const seg = SEGS.find(x=>x.id===sid);
                          return <span key={sid} style={{ fontSize:9, fontWeight:600, padding:'2px 8px', borderRadius:4, background:seg?.color+'12', color:seg?.color, border:`1px solid 30` }}>{seg?.name}</span>;
                        })}
                      </div>

                      {/* Controls */}
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:12 }}>
                        <div>
                          <Lbl style={{ marginBottom:4 }}>START WEEK</Lbl>
                          <select value={st.startW||0} onChange={e=>upS(sc.id,{startW:+e.target.value})}
                            style={{ width:'100%', padding:'6px 8px', borderRadius:6, border:`1px solid `, background:T.bg1, fontSize:11, fontFamily:'monospace', color:T.t1, outline:'none', cursor:'pointer' }}>
                            {Array.from({length:HORIZON},(_,i)=>i).map(w => (
                              <option key={w} value={w}>W{w+1}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <Lbl style={{ marginBottom:4 }}>DURATION (WKS)</Lbl>
                          <Inp value={st.dur} onChange={v=>upS(sc.id,{dur:v,preset:null})} step={1} width={'100%'} min={1} max={13} style={{ width:'100%', padding:'6px 8px', borderRadius:6 }} />
                        </div>
                        <div>
                          <Lbl style={{ marginBottom:4 }}>INTENSITY (%)</Lbl>
                          <Inp value={st.pct} onChange={v=>upS(sc.id,{pct:v,preset:null})} step={2} width={'100%'} min={0} max={50} style={{ width:'100%', padding:'6px 8px', borderRadius:6 }} />
                        </div>
                      </div>

                      {/* Presets */}
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
                        {['mild','moderate','severe'].map(p => {
                          const pr = sc.presets[p];
                          const active = st.preset === p;
                          return (
                            <button key={p} onClick={()=>upS(sc.id,{pct:pr.pct,dur:pr.dur,preset:p})}
                              style={{ padding:'8px 6px', borderRadius:6, border:`1px solid `,
                                background:active?sc.color+'12':T.bg2, cursor:'pointer', textAlign:'center' }}>
                              <div style={{ fontSize:11, fontWeight:700, color:active?sc.color:T.t1, textTransform:'uppercase' }}>{p}</div>
                              <div style={{ fontSize:10, color:T.t3, marginTop:2, fontFamily:'monospace' }}>{pr.pct}% &middot; {pr.dur}wk</div>
                            </button>
                          );
                        })}
                      </div>
                    </Card>
                  );
                })}
              </div>

              {/* RIGHT: CHARTS */}
              <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                <Card>
                  <Lbl style={{ marginBottom:8 }}>Balance: Expected vs Scenario Adjusted</Lbl>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={rd}>
                      <CG />
                      <XAxis dataKey="wk" tick={{ fill:T.t2, fontSize:9 }} />
                      <YAxis tick={{ fill:T.t2, fontSize:9 }} tickFormatter={v=>fK(v)} />
                      <Tooltip content={<TT />} />
                      <Line type="monotone" dataKey="eBal" name="Expected" stroke={T.contract} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="aBal" name="Scenario Adj" stroke={T.adj} strokeDasharray="4 3" dot={false} />
                      <ReferenceLine y={thresh} stroke={T.warn} strokeDasharray="4 3" label={{ value:`Alert ${fK(thresh)}`, fill:T.warn, fontSize:9 }} />
                      <Legend wrapperStyle={{ fontSize:9 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>

                <Card>
                  <Lbl style={{ marginBottom:8 }}>Weekly Scenario Delta</Lbl>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={rd.map(w => ({ wk:w.wk, delta:w.adjNet-w.eNet }))}>
                      <CG />
                      <XAxis dataKey="wk" tick={{ fill:T.t2, fontSize:9 }} />
                      <YAxis tick={{ fill:T.t2, fontSize:9 }} tickFormatter={v=>fK(v)} />
                      <Tooltip content={<TT />} />
                      <ReferenceLine y={0} stroke={T.b1} />
                      <Bar dataKey="delta" name="Delta" maxBarSize={16} radius={[3,3,0,0]}>
                        {rd.map((w,i) => <Cell key={i} fill={(w.adjNet-w.eNet)>=0?T.pos:T.neg} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>

                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                  <Card>
                    <Lbl>RCF Utilisation</Lbl>
                    <div style={{ fontSize:14,fontWeight:700,color:kpi.maxDraw/RCF_DEFAULT>0.8?T.neg:T.t0,marginTop:4 }}>Peak: {fK(kpi.maxDraw)}</div>
                    <div style={{ height:8,borderRadius:4,background:T.b0,marginTop:6,overflow:'hidden' }}>
                      <div style={{ height:'100%',borderRadius:4,background:kpi.maxDraw/RCF_DEFAULT>0.8?T.neg:T.contract,width:`${Math.min(100,kpi.maxDraw/RCF_DEFAULT*100)}%`,transition:'width .3s' }} />
                    </div>
                    <div style={{ fontSize:9,color:T.t3,marginTop:4 }}>{(kpi.maxDraw/RCF_DEFAULT*100).toFixed(1)}% of ${n0(RCF_DEFAULT)}k RCF | {kpi.alertWks} alert weeks</div>
                  </Card>
                  <Card>
                    <Lbl>Save & Compare</Lbl>
                    <div style={{ display:'flex',gap:6,marginTop:6 }}>
                      <input type="text" value={saveName} onChange={e=>setSaveName(e.target.value)} placeholder="Scenario label..."
                        style={{ flex:1,padding:'4px 8px',borderRadius:4,border:`1px solid ${T.b2}`,fontSize:11,outline:'none' }} />
                      <button onClick={() => {
                        if (!saveName.trim() || saved.length >= 5) return;
                        setSaved(prev => [...prev, { id:Date.now(), name:saveName, e:kpi.eNet13, a:kpi.adjNet13, d:kpi.delta, mb:kpi.minABal, aw:kpi.alertWks }]);
                        setSaveName('');
                      }} style={{ padding:'4px 10px',borderRadius:4,border:`1px solid ${T.contract}`,background:T.contract+'10',color:T.contract,fontSize:11,fontWeight:600,cursor:'pointer' }}>Save</button>
                    </div>
                    {saved.length > 0 && (
                      <table style={{ width:'100%',borderCollapse:'collapse',fontSize:10,marginTop:8 }}>
                        <thead>
                          <tr style={{ borderBottom:`1px solid ${T.b1}` }}>
                            {['Label','Exp','Adj','Delta','MinBal','Alerts',''].map(h => (
                              <th key={h} style={{ textAlign:'left',padding:'3px 4px',color:T.t3,fontSize:8,fontWeight:600 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {saved.map(s => (
                            <tr key={s.id} style={{ borderBottom:`1px solid ${T.b0}` }}>
                              <td style={{ padding:'3px 4px',fontWeight:500 }}>{s.name}</td>
                              <td style={{ padding:'3px 4px',fontFamily:'monospace' }}>{fM(s.e)}</td>
                              <td style={{ padding:'3px 4px',fontFamily:'monospace' }}>{fM(s.a)}</td>
                              <td style={{ padding:'3px 4px',fontFamily:'monospace',fontWeight:700,color:clr(s.d) }}>{fM(s.d)}</td>
                              <td style={{ padding:'3px 4px',fontFamily:'monospace' }}>{fM(s.mb)}</td>
                              <td style={{ padding:'3px 4px',fontFamily:'monospace' }}>{s.aw}/13</td>
                              <td style={{ padding:'3px 4px' }}>
                                <button onClick={()=>setSaved(prev=>prev.filter(x=>x.id!==s.id))} style={{ border:'none',background:'none',color:T.neg,cursor:'pointer',fontSize:11,fontWeight:700 }}>X</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </Card>
                </div>
              </div>
            </div>
          )}


          {/* MACRO SIGNALS PANEL */}
          {panel === 'macro' && (
            <div>
              {/* Header */}
              <Lbl style={{ fontSize:11, marginBottom:14, letterSpacing:'0.12em' }}>MARKET INDICATORS -- TOGGLE TO APPLY</Lbl>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 340px', gap:18 }}>
                {/* LEFT: CHARTS */}
                <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                  <Card>
                    <Lbl style={{ marginBottom:8 }}>CASH BALANCE -- BASE / +SCENARIOS / +MACRO ($K)</Lbl>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={p2}>
                        <CG />
                        <XAxis dataKey="wk" tick={{ fill:T.t2, fontSize:9 }} />
                        <YAxis tick={{ fill:T.t2, fontSize:9 }} tickFormatter={v=>fK(v)} />
                        <Tooltip content={<TT />} />
                        <Line type="monotone" dataKey="eBal" name="Base" stroke={T.contract} strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="aBal" name="+Scenarios" stroke={T.adj} strokeDasharray="4 3" dot={false} />
                        <Line type="monotone" dataKey="mBal" name="+Macro" stroke={T.gold} strokeWidth={2.5} dot={false} />
                        <ReferenceLine y={thresh} stroke={T.warn} strokeDasharray="4 3" label={{ value:`Alert ${fK(thresh)}`, fill:T.warn, fontSize:9 }} />
                        <Legend wrapperStyle={{ fontSize:9 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>

                  <Card>
                    <Lbl style={{ marginBottom:8 }}>WEEKLY AR & AP DELTA ($K)</Lbl>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={p2.map(w => ({ wk:w.wk, AR:w.mAR, AP:-w.mAP }))}>
                        <CG />
                        <XAxis dataKey="wk" tick={{ fill:T.t2, fontSize:9 }} />
                        <YAxis tick={{ fill:T.t2, fontSize:9 }} tickFormatter={v=>fK(v)} />
                        <Tooltip content={<TT />} />
                        <ReferenceLine y={0} stroke={T.b1} />
                        <Bar dataKey="AR" name="AR Delta" fill={T.contract} maxBarSize={16} />
                        <Bar dataKey="AP" name="AP Delta" fill={T.neg} maxBarSize={16} />
                        <Legend wrapperStyle={{ fontSize:9 }} />
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>

                  <Card>
                    <Lbl style={{ marginBottom:8 }}>SEGMENT CRACK MARGIN & PRICE CRACK SPREAD ($K/WK)</Lbl>
                    {MACROS.filter(m=>m.type==='crack'&&macro[m.id]?.on).length > 0 ? (
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={p2.map((w,i) => {
                          const o = { wk:w.wk };
                          MACROS.filter(m=>m.type==='crack'&&macro[m.id]?.on).forEach(mc => {
                            const ms = macro[mc.id];
                            const delta = ms.value - mc.base;
                            mc.segs.forEach(segId => {
                              const seg = SEGS.find(s=>s.id===segId);
                              if (!seg) return;
                              const volBase = seg.vol * (region==='tot'?1:region==='ams'?0.52:0.48);
                              const label = seg.name + ' ' + String.fromCharCode(916);
                              o[label] = (o[label]||0) + volBase * delta * ((mc.sellCoeff||1) - (mc.buyCoeff||1)) / 1000;
                            });
                          });
                          return o;
                        })}>
                          <CG />
                          <XAxis dataKey="wk" tick={{ fill:T.t2, fontSize:9 }} />
                          <YAxis tick={{ fill:T.t2, fontSize:9 }} tickFormatter={v=>fK(v)} />
                          <Tooltip content={<TT />} />
                          <ReferenceLine y={0} stroke={T.b1} />
                          {SEGS.map(s => {
                            const label = s.name + ' ' + String.fromCharCode(916);
                            return <Bar key={s.id} dataKey={label} name={label} fill={s.color} maxBarSize={16} />;
                          })}
                          <Legend wrapperStyle={{ fontSize:9 }} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div style={{ padding:40, textAlign:'center', color:T.t3, fontSize:12 }}>Enable crack spread signals to see margin impact</div>
                    )}
                  </Card>
                </div>

                {/* RIGHT: SIGNAL CONTROLS */}
                <div style={{ display:'flex', flexDirection:'column', gap:6, overflowY:'auto', maxHeight:'85vh' }}>
                  {MACRO_CATS.map(cat => {
                    const catMacros = MACROS.filter(m => m.cat === cat.id);
                    if (catMacros.length === 0) return null;
                    const activeCount = catMacros.filter(m => macro[m.id]?.on).length;
                    return (
                      <div key={cat.id} style={{ marginBottom:8 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, borderLeft:`3px solid ${cat.color}`, paddingLeft:8 }}>
                          <Lbl c={cat.color} style={{ fontSize:10 }}>{cat.name}</Lbl>
                          <span style={{ fontSize:9, color:T.t3 }}>{activeCount}/{catMacros.length} active</span>
                        </div>
                        {catMacros.map(mc => {
                          const ms = macro[mc.id];
                          const delta = ms.value - mc.base;
                          const pctDelta = mc.base !== 0 ? ((delta / mc.base) * 100) : (delta * 100);
                          return (
                            <Card key={mc.id} style={{ marginBottom:8, background:T.bg1, borderLeft:ms.on ? `3px solid ${cat.color}` : '3px solid transparent' }}>
                              {/* Header: dot + icon + name + toggle */}
                              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                  <div style={{ width:8, height:8, borderRadius:4, background:ms.on ? cat.color : T.b2 }} />
                                  <span style={{ fontSize:13, fontWeight:700, color:T.t0 }}>{mc.name}</span>
                                </div>
                                <div style={{ display:'flex', alignItems:'center', gap:6, padding:'3px 10px', borderRadius:5, border:`1px solid ${ms.on ? T.pos : T.b2}`, background:ms.on ? T.pos+'08' : T.bg1, cursor:'pointer' }} onClick={() => upM(mc.id, {on:!ms.on})}>
                                  <div style={{ width:7, height:7, borderRadius:4, background:ms.on ? T.pos : T.b2 }} />
                                  <span style={{ fontSize:10, fontWeight:600, color:ms.on ? T.pos : T.t3 }}>{ms.on ? 'ON' : 'OFF'}</span>
                                </div>
                              </div>

                              {/* Input + unit + delta */}
                              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                                <Inp value={ms.value} onChange={v => upM(mc.id, {value:v})}
                                  step={mc.unit.includes('bbl') ? 0.5 : mc.unit.includes('pts') || mc.unit.includes('Index') ? 1 : 0.1}
                                  width={70} style={{ padding:'6px 8px', borderRadius:6, fontSize:12 }} />
                                <span style={{ fontSize:10, color:T.t3 }}>{mc.unit}</span>
                                <span style={{ fontSize:11, fontWeight:700, fontFamily:'monospace', color:delta === 0 ? T.t3 : clr(delta) }}>
                                  {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                                </span>
                                <span style={{ fontSize:11, fontWeight:700, fontFamily:'monospace', color:pctDelta === 0 ? T.t3 : clr(pctDelta) }}>
                                  {pctDelta > 0 ? '+' : ''}{pctDelta.toFixed(1)}%
                                </span>
                              </div>

                              {/* Description */}
                              <div style={{ fontSize:11, color:T.t2, lineHeight:1.4, marginBottom:4 }}>{mc.desc}</div>

                              {/* Impact formula */}
                              <div style={{ fontSize:10, color:T.t3, fontFamily:'monospace', marginBottom:mc.type === 'crack' && ms.on ? 8 : 0 }}>{mc.formula}</div>

                              {/* Crack spread breakdown when ON */}
                              {mc.type === 'crack' && ms.on && (() => {
                                const volBase = mc.segs.reduce((s, sid) => s + (SEGS.find(x => x.id === sid)?.vol || 0) * (region === 'tot' ? 1 : region === 'ams' ? 0.52 : 0.48), 0);
                                const buyImp = volBase * delta * (mc.buyCoeff || 1) / 1000;
                                const sellImp = volBase * delta * (mc.sellCoeff || 1) / 1000;
                                const netImp = sellImp - buyImp;
                                const squeeze = netImp < 0;
                                return (
                                  <div style={{ display:'flex', gap:6, marginTop:6 }}>
                                    <div style={{ flex:1, padding:'4px 8px', borderRadius:5, background:T.neg+'08', textAlign:'center' }}>
                                      <div style={{ fontSize:8, color:T.t3, fontWeight:600 }}>Buy Cost /MT</div>
                                      <div style={{ fontSize:11, fontWeight:700, color:T.neg }}>{fK(buyImp)}</div>
                                    </div>
                                    <div style={{ flex:1, padding:'4px 8px', borderRadius:5, background:T.pos+'08', textAlign:'center' }}>
                                      <div style={{ fontSize:8, color:T.t3, fontWeight:600 }}>Sell Rev /MT</div>
                                      <div style={{ fontSize:11, fontWeight:700, color:T.pos }}>{fK(sellImp)}</div>
                                    </div>
                                    <div style={{ flex:1, padding:'4px 8px', borderRadius:5, background:squeeze ? T.neg+'08' : T.pos+'08', textAlign:'center' }}>
                                      <div style={{ fontSize:8, color:T.t3, fontWeight:600 }}>Margin /MT</div>
                                      <div style={{ fontSize:11, fontWeight:700, color:squeeze ? T.neg : T.pos }}>{fK(netImp)}</div>
                                    </div>
                                  </div>
                                );
                              })()}
                            </Card>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
