const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const babel=require(require.resolve('playwright').replace(/index.js$/,'lib/transform/babelBundle.js'));
const source=fs.readFileSync(path.join(__dirname,'../js/app.jsx'),'utf8');
new vm.Script(babel.babelTransform(source,'app.jsx',false,[],[]).code);
let state=[],cursor=0,writes=[],resolveSave,storage=new Map();
const ctx={console,expenseRecord:r=>r,hasReturnJourney:r=>r.return_amount!=null,regionOf:r=>r.region||'JPY',
 expenseShopLabel:r=>r.shop+(r.place_name?' · '+r.place_name:''),fmt:n=>'¥'+n,ymdToday:()=> '2026-11-19',Modal:()=>null,
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
 require:()=>({jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}),
 useState(initial){let i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],v=>state[i]=typeof v==='function'?v(state[i]):v];},
 useRef(v){let i=cursor++;return state[i]||(state[i]={current:v});},useMemo:fn=>fn(),
 useTheme:()=>({theme:{},inputStyle:{},currency:'JPY',fetchData(){}}),
 useExpenseMutations:()=>({modals:null,insertExpense:r=>{writes.push(r);return new Promise(resolve=>resolveSave=resolve);}})};
vm.createContext(ctx);
vm.runInContext(babel.babelTransform(source.slice(source.indexOf('// Frequent transaction shortcuts'),source.indexOf('function SmartEntryView')),'favourites.jsx',false,[],[]).code,ctx);
const rows=[
{id:1,shop:'Mart',category:'Food',place_name:'East',amount:120,date:'2026-11-01'},
{id:2,shop:'Mart',category:'Food',place_name:'East',amount:120,date:'2026-11-03'},
{id:3,shop:'Mart',category:'Food',place_name:'West',amount:120,date:'2026-11-02'},
{id:4,shop:'Mart',category:'Food',place_name:'East',amount:150,date:'2026-11-02'},
{id:5,shop:'A → B',category:'Transportation',amount:310,return_amount:155,date:'2026-11-02'},
{id:6,shop:'Mart',category:'Food',amount:10,region:'INR'},
{id:7,shop:'Bad',category:'Food',amount:0}];
const options=ctx.frequentTransactionOptions([...rows,rows[0]],'JPY');
assert.equal(options.length,4);assert.equal(options[0].count,2);assert.equal(options[0].record.place_name,'East');
assert.equal(options.find(o=>o.record.shop==='A → B').record.amount,155);
assert.ok(!('id' in options[0].record));assert.ok(!('return_amount' in options[0].record));
const render=()=>{cursor=0;return ctx.FrequentTransactionsPanel({allExpenses:rows,userId:'user-a'});};
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const find=fn=>{const node=nodes(render()).find(fn);assert.ok(node);return node;};
const button=text=>find(n=>n.type==='button'&&n.props.children===text);
(async()=>{
button('Choose transactions').props.onClick();
find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange();
assert.equal(JSON.parse(storage.get('cm_favourites_v1:user-a:JPY')).length,1);
button('Done choosing').props.onClick();
find(n=>n.type==='button'&&n.props.style.minHeight===84).props.onClick();
assert.equal(find(n=>n.props?.['aria-label']==='Favourite entry date').props.value,'2026-11-19');
const save=button('Save entry').props.onClick;
const promise=save();save();assert.equal(writes.length,1);assert.equal(writes[0].date,'2026-11-19');assert.equal(writes[0].place_name,'East');
assert.ok(!('id' in writes[0]));assert.ok(!('outwardOnly' in writes[0]));
resolveSave({ok:false,error:'Offline failure'});await promise;
assert.ok(nodes(render()).some(n=>n.props?.['aria-label']==='Favourite entry amount'),'failed save retains draft');
const retry=button('Save entry').props.onClick();resolveSave({ok:true});await retry;
assert.ok(!nodes(render()).some(n=>n.props?.['aria-label']==='Favourite entry amount'));
state=[];assert.ok(nodes(render()).some(n=>n.type==='button'&&n.props.style.minHeight===84),'selection survives remount');
console.log('PASS: full JSX, grouping, branch/amount/region isolation, round-trip outward amount, selection persistence, review, duplicate click protection, failed-save retry');
})().catch(e=>{console.error(e);process.exitCode=1});
