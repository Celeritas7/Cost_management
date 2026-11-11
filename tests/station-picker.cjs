// Run with Node and Playwright installed. Uses the actual catalog and JSX handlers.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const babel=require(require.resolve('playwright').replace(/index.js$/, 'lib/transform/babelBundle.js'));
const src=fs.readFileSync(path.join(__dirname,'../js/app.jsx'),'utf8');
let state=[],cursor=0,chosen=null,closed=false;
const ctx={console,Map,Set,Number,require:()=>({jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}),
 useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],v=>state[i]=typeof v==='function'?v(state[i]):v];},
 useRef(initial){const i=cursor++;return state[i]||(state[i]={current:initial});},useMemo:fn=>fn(),useEffect(){},
 useTheme:()=>({theme:new Proxy({}, {get:()=> '#888888'}),inputStyle:{}}),Modal:()=>null,
 canonStation:s=>s.trim(),document:{activeElement:null}};
vm.createContext(ctx);
vm.runInContext(src.slice(src.indexOf('const JR_LINES ='),src.indexOf('// 特定区間')),ctx);
vm.runInContext(src.match(/const stnKey = .*;/)[0],ctx);
vm.runInContext(babel.babelTransform(src.slice(src.indexOf('// Station selection is separate'),src.indexOf('// ═══ PHASE A')),'picker.jsx',false,[],[]).code,ctx);
const lines=vm.runInContext('JR_LINES',ctx),all=[...new Set(lines.flatMap(l=>l.stations.map(([n])=>n)))];
const options=ctx.stationPickerOptions;
assert.equal(options(['Musashi-Urawa','Musashi Urawa']).length,1,'spacing aliases deduplicated');
assert.equal(options(all,'musashino','musashi urawa')[0],'Musashi-Urawa');
assert.equal(options(all,'musashino','akihabara').length,0,'unrelated line station excluded');
assert.equal(options(all,'','',['Nishi-Urawa'])[0],'Nishi-Urawa','recent ranked first');
assert.equal(options(all,'musashino','',['Akihabara'])[0],'Fuchuhommachi','line remains in station order');
let props={title:'From',value:'',stations:all,recent:['Akihabara','Nishi-Urawa'],initialLine:'',onChoose:(name,line)=>chosen={name,line},onClose:()=>closed=true};
const render=()=>{cursor=0;return ctx.StationPicker(props);};
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const find=fn=>{const n=nodes(render()).find(fn);assert.ok(n,'control exists');return n;};
const select=()=>find(n=>n.type==='select'&&n.props['aria-label']==='Railway line');
const search=()=>find(n=>n.type==='input'&&n.props['aria-label']==='Search stations');
select().props.onChange({target:{value:'musashino'}});
let stationButtons=nodes(render()).filter(n=>n.type==='button'&&n.props['aria-label']?.startsWith('Select '));
assert.equal(stationButtons.length,lines.find(l=>l.id==='musashino').stations.length);
assert.ok(!stationButtons.some(n=>n.props['aria-label']==='Select Akihabara'));
search().props.onChange({target:{value:'musashi urawa'}});
find(n=>n.props?.['aria-label']==='Select Musashi-Urawa').props.onClick();assert.equal(chosen.name,'Musashi-Urawa');assert.equal(chosen.line,'musashino');
search().props.onChange({target:{value:'Other Station'}});
assert.ok(!nodes(render()).some(n=>n.type==='button'&&String(n.props.children).startsWith('Use ')));
select().props.onChange({target:{value:''}});
find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]==='Use “').props.onClick();assert.equal(chosen.name,'Other Station');assert.equal(chosen.line,'');
find(n=>n.props?.role==='dialog').props.onKeyDown({key:'Escape',preventDefault(){}});assert.equal(closed,true);
assert.equal(search().props.autoFocus,undefined,'opening does not summon keyboard');
state=[];props={...props,value:'Akihabara',initialLine:'musashino'};assert.equal(select().props.value,'','existing station on different line stays visible');
state=[];props={...props,value:'',initialLine:'musashino',title:'To'};assert.equal(select().props.value,'musashino','next station starts with last selected line');
console.log('PASS: real line membership, unrelated station exclusion, whitespace search, recent ranking, deduplication, line order, selection, manual fallback, remembered line and keyboard dismissal');
