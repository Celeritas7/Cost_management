const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const babel=require(require.resolve('playwright').replace(/index.js$/,'lib/transform/babelBundle.js'));
const src=fs.readFileSync(path.join(__dirname,'../js/app.jsx'),'utf8');
let state=[],cursor=0,effects=[],writes=[],resolveSave,geoSuccess,hidden=false,view='';
const store=new Map(),areas=[{id:'a',name:'Office',lat:35,lng:139}],windowMock={cm:{pos:null},addEventListener(){},removeEventListener(){}};
const ctx={console,Date,window:windowMock,navigator:{geolocation:{getCurrentPosition(ok){geoSuccess=ok;}}},
setInterval:()=>1,clearInterval(){},expenseRecord:r=>r,hasReturnJourney:()=>false,regionOf:()=> 'JPY',expenseShopLabel:r=>r.shop,fmt:n=>'¥'+n,ymdToday:()=> '2026-11-19',Modal:()=>null,
distanceMeters:(a,b)=>Math.hypot(a.lat-b.lat,a.lng-b.lng)*111000,
localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
require:()=>({jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}),
useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],v=>state[i]=typeof v==='function'?v(state[i]):v];},
useRef(v){const i=cursor++;return state[i]||(state[i]={current:v});},useMemo:fn=>fn(),useEffect:fn=>effects.push(fn),useKeyboardUp:()=>hidden,
useTheme:()=>({theme:{},inputStyle:{},currency:'JPY',favouriteAreas:areas,stopPins:[],setView:v=>view=v}),
useExpenseMutations:()=>({modals:null,insertExpense:r=>{writes.push(r);return new Promise(resolve=>resolveSave=resolve);}})};
vm.createContext(ctx);
vm.runInContext(babel.babelTransform(src.slice(src.indexOf('// Frequent transaction shortcuts'),src.indexOf('function SmartEntryView')),'quick.jsx',false,[],[]).code,ctx);
for(const [slot,start,end] of [['morning',5,11],['lunch',11,15],['evening',17,23]]) {
 assert.equal(ctx.quickTimeMatch(slot,start),true);assert.equal(ctx.quickTimeMatch(slot,end),false);assert.equal(ctx.quickTimeMatch(slot,start-1),false);
}
const rows=Array.from({length:7},(_,i)=>({id:i,shop:'Shop '+i,category:'Food',place_name:'Office',amount:100+i,date:'2026-11-18'}));
const opts=ctx.frequentTransactionOptions(rows,'JPY'),keys=opts.map(x=>x.key),locations={hubs:{},assignments:{},times:{}};
store.set('cm_favourites_v1:u:JPY',JSON.stringify(keys));
const noon=new Date(2026,10,19,12); locations.times[keys[0]]='morning';locations.times[keys[1]]='lunch';
const list=ctx.quickEntrySuggestions(opts,keys,locations,areas,[],{lat:35,lng:139},'',noon);
assert.equal(list.length,5);assert.equal(list[0].key,keys[1]);assert.ok(!list.some(x=>x.key===keys[0]));
assert.equal(ctx.quickEntrySuggestions(opts,keys,locations,areas,[],{lat:36,lng:139},'',noon).length,0);
const render=()=>{cursor=0;return ctx.FrequentTransactionsPanel({userId:'u',allExpenses:rows,compact:true});};
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const find=fn=>{const n=nodes(render()).find(fn);assert.ok(n);return n;};
(async()=>{
render();const mount=effects[0];mount();
assert.ok(!nodes(render()).some(n=>n.props?.['data-quick-ready']),'no location means no ready dot');
windowMock.cm.pos={lat:35,lng:139,acc:10,t:Date.now()};mount();
assert.ok(nodes(render()).some(n=>n.props?.['data-quick-ready']));
hidden=true;assert.ok(!nodes(render()).some(n=>n.props?.['aria-haspopup']==='dialog'));hidden=false;
find(n=>n.props?.['aria-haspopup']==='dialog').props.onClick();
assert.ok(nodes(render()).some(n=>n.props?.role==='dialog'&&n.props['aria-label']==='Quick add'));
const cards=nodes(render()).filter(n=>n.type==='button'&&n.props.style.minHeight===66);assert.equal(cards.length,5);assert.equal(writes.length,0);
cards[0].props.onClick();
assert.ok(!nodes(render()).some(n=>n.props?.role==='dialog'&&n.props['aria-label']==='Quick add'));
assert.equal(find(n=>n.props?.['aria-label']==='Favourite entry date').props.value,'2026-11-19');
const save=find(n=>n.type==='button'&&n.props.children==='Save entry').props.onClick;const pending=save();save();assert.equal(writes.length,1);resolveSave({ok:true});await pending;
windowMock.cm.pos={lat:35,lng:139,acc:10,t:Date.now()-180000};mount();assert.ok(!nodes(render()).some(n=>n.props?.['data-quick-ready']));
find(n=>n.props?.['aria-haspopup']==='dialog').props.onClick();
find(n=>n.type==='button'&&n.props.children==='Manage').props.onClick();assert.equal(view,'smart');assert.equal(store.get('cm_smart_seg'),'favourites');
console.log('PASS: time boundaries/ranking, five-item limit, nearby exclusion, fresh/stale ready dot, keyboard hiding, open/review/save flow, duplicate clicks and Manage navigation');
})().catch(e=>{console.error(e);process.exitCode=1});
