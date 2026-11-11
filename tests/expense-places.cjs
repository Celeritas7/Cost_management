// Run with Node and Playwright installed: node tests/expense-places.cjs
// Exercises the actual JSX handlers with a minimal hook renderer; no live writes.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const path = require('node:path');
const babel = require(require.resolve('playwright').replace(/index.js$/, 'lib/transform/babelBundle.js'));
const source = fs.readFileSync(path.join(__dirname, '../js/app.jsx'), 'utf8');
const helpers = source.slice(source.indexOf('function expenseShopLabel'), source.indexOf('function enrichRow'));
const capture = source.slice(source.indexOf('function ShopCaptureView'), source.indexOf('function TransactionsView'));
const mutations = source.slice(source.indexOf('function useExpenseMutations'), source.indexOf('function useExpenseMutations') + 12000);
const context = { console: { log() {}, warn() {} }, Number, Set };
vm.createContext(context); vm.runInContext(helpers, context);
const {capturePlace, expenseShopLabel} = context;
const history = [{shop:'FamilyMart', category:'Food'}];
const candidate = {name:'FamilyMart Ageo East Exit', place_id:'branch-a', address:'1-2 Ageo'};
assert.equal(expenseShopLabel(capturePlace(candidate, history)), 'FamilyMart · Ageo East Exit');
assert.equal(capturePlace({name:'ファミリーマート上尾駅東口店'}, history).shop, 'FamilyMart');
assert.equal(capturePlace({name:'FamilyMart', address:'1-2 Ageo'}, history).place_name, '1-2 Ageo');
assert.equal(capturePlace({name:'FamilyMart'}, history).place_name, '');
assert.equal(capturePlace({name:'FamilyMartial Arts'}, history).shop, 'FamilyMartial Arts');
assert.equal(expenseShopLabel({shop:'FamilyMart', place_name:'FamilyMart'}), 'FamilyMart');
assert.equal(expenseShopLabel({shop:'Old shop'}), 'Old shop');
let state=[], cursor=0, writes=[], outcome={ok:true}, resolveSave;
const theme = new Proxy({}, {get:()=> '#888888'});
Object.assign(context, {
  require:()=>({jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}),
  useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],v=>state[i]=typeof v==='function'?v(state[i]):v];},
  useRef(initial){const i=cursor++;return state[i]||(state[i]={current:initial});},
  useMemo:fn=>fn(), useTheme:()=>({theme,inputStyle:{},labelStyle:{},fetchData(){},categories:[{name:'Food'}],currency:'JPY'}),
  useExpenseMutations:()=>({insertExpense:async row=>{writes.push(row);return resolveSave ? new Promise(r=>resolveSave=r) : outcome;},modals:null}),
  inferCategory:()=>({category:'Food',step:1}),CASCADE_LABELS:{1:'history'},ymdToday:()=> '2026-11-11',CUR:{symbol:'¥'},Icon:()=>null,
  hubPlacesNearby:async()=>({http:200,res:{status:'fetched',candidates:[candidate]}}),
  navigator:{geolocation:{getCurrentPosition:fn=>fn({coords:{latitude:1,longitude:1}})}}
});
vm.runInContext(babel.babelTransform(capture,'capture.jsx',false,[],[]).code,context);
const render=()=>{cursor=0;return context.ShopCaptureView({allExpenses:history});};
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const find=(predicate)=>{const n=nodes(render()).find(predicate);assert.ok(n,'UI control exists');return n;};
const button=text=>find(n=>n.type==='button'&&n.props.children===text);
const field=label=>find(n=>n.type==='input'&&n.props['aria-label']===label);
async function select(){button('📍 Find shops near me').props.onClick();await new Promise(r=>setImmediate(r));find(n=>n.type==='button'&&nodes(n).some(c=>c.props?.children?.[0]===candidate.name)).props.onClick();}
function amount(value){find(n=>n.type==='input'&&n.props.type==='number').props.onChange({target:{value}});}
(async()=>{
 await select();assert.equal(field('Place / branch').props.value,'Ageo East Exit');
 amount('178.5');assert.equal(button('Add expense').props.disabled,true);
 amount('178');const save=button('Add expense');resolveSave=true;const pending=save.props.onClick();
 await save.props.onClick();assert.equal(writes.length,1,'double-tap only writes once');resolveSave({ok:true});await pending;resolveSave=null;
 assert.equal(writes[0].shop,'FamilyMart');assert.equal(writes[0].place_name,'Ageo East Exit');assert.equal(writes[0].place_id,'branch-a');
 await select();field('Place / branch').props.onChange({target:{value:'My nearby branch'}});amount('200');outcome={ok:false,error:'offline disabled'};await button('Add expense').props.onClick();
 assert.equal(field('Place / branch').props.value,'My nearby branch','failed save retains draft');assert.equal(writes.at(-1).place_id,null);
 outcome={ok:true,queued:true};await button('Add expense').props.onClick();assert.equal(writes.at(-1).place_name,'My nearby branch');
 await select();find(n=>n.type==='input'&&n.props.value==='FamilyMart').props.onChange({target:{value:'Different shop'}});assert.equal(field('Place / branch').props.value,'','changing shop clears stale branch');
 // Actual offline write/overlay code preserves metadata through local JSON storage.
 const queueSource=source.slice(source.indexOf('const OUTBOX_KEY'),source.indexOf('const idOrd'));
 let storage={};Object.assign(context,{localStorage:{getItem:k=>storage[k],setItem:(k,v)=>storage[k]=v},window:{dispatchEvent(){}},Event:function(){},navigator:{onLine:false},setTimeout(){}});
 vm.runInContext(queueSource,context);
 await context.writeThrough({table:'cost_management_expenses',op:'insert',row:writes[0]});
 const queued=vm.runInContext('overlayExpenses([])',context);assert.equal(queued[0].place_name,'Ageo East Exit');assert.equal(queued[0].place_id,'branch-a');
 // Reload projection must retain both fields as well as the unmodified shop key.
 assert.match(source,/shop: r.shop, place_name: r.place_name \|\| null, place_id: r.place_id \|\| null/);
 assert.match(mutations,/place_name: \(editForm.place_name \|\| ""\).trim\(\) \|\| null/);
 for(const file of ['../js/app.jsx','../supabase/functions/akatsuki-places-nearby/index.ts']){babel.babelTransform(fs.readFileSync(path.join(__dirname,file),'utf8'),file,false,[],[]);}
 console.log('PASS: branch/address labels, legacy entries, alias boundaries, capture save, duplicate prevention, failed-save retry, edits, offline queue, reload projection, JSX/TS compilation');
})().catch(e=>{console.error(e);process.exitCode=1;});
