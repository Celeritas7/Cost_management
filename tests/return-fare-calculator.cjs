const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const babel=require(require.resolve('playwright').replace(/index.js$/, 'lib/transform/babelBundle.js'));
const src=fs.readFileSync(path.join(__dirname,'../js/app.jsx'),'utf8');let state=[],cursor=0,rows=[];
const theme=new Proxy({}, {get:()=> '#888888'});
const ctx={console,Date,Number,Map,Set,require:()=>({jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}),
 useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],v=>state[i]=typeof v==='function'?v(state[i]):v];},
 useRef(initial){const i=cursor++;return state[i]||(state[i]={current:initial});},useMemo:fn=>fn(),
 useTheme:()=>({theme,inputStyle:{},labelStyle:{},supabase:{},fetchData(){},currency:'JPY'}),
 useExpenseMutations:()=>({insertExpense:async row=>{rows.push(row);await Promise.resolve();return {ok:true};},modals:null}),
 ymdToday:()=> '2026-12-30',canonStation:s=>s.trim(),SEED_STATIONS:[],jrRoutes:()=>[],fareLookup:async()=>({fare_ic:199,source:'book',verified:true}),
 fareBookSave:async()=>({status:'ok'}),fareTone:()=> '#888888',fareSourceLabel:()=> 'Saved fare',overridden:x=>x!=null&&x!=='',fmt:x=>'¥'+x,CUR:{symbol:'¥'},Icon:()=>null,StationPicker:()=>null,stnKey:s=>String(s||'').toLowerCase().replace(/[\s-]/g,'')};
vm.createContext(ctx);vm.runInContext(src.slice(src.indexOf('// Round trips are one'),src.indexOf('function App(')),ctx);
vm.runInContext(babel.babelTransform(src.slice(src.indexOf('function FareCalcView'),src.indexOf('function FareBookView')),'fare.jsx',false,[],[]).code,ctx);
const render=()=>{cursor=0;return ctx.FareCalcView({allExpenses:[],dueAdd(){}});};
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const find=fn=>{const n=nodes(render()).find(fn);assert.ok(n,'control exists');return n;};
const text=n=>n==null?'':typeof n==='object'?(Array.isArray(n)?n.map(text).join(''):text(n.props?.children)):String(n);
const button=t=>find(n=>n.type==='button'&&text(n).startsWith(t));
const field=name=>find(n=>n.type==='input'&&n.props['aria-label']===name);
async function plan(){
 find(n=>n.type==='button'&&n.props['aria-label']==='Choose from station').props.onClick();
 find(n=>n.type===ctx.StationPicker).props.onChoose('A','');
 find(n=>n.type==='button'&&n.props['aria-label']==='Choose to station').props.onClick();
 find(n=>n.type===ctx.StationPicker).props.onChoose('B','');
 await button('Calculate 1 leg').props.onClick();
}
(async()=>{
 await plan();button('Round trip').props.onClick();
 field('Return date').props.onChange({target:{value:'2027-01-02'}});field('Return fare').props.onChange({target:{value:'209'}});
 const save=button('Add round trip');assert.equal(save.props.disabled,false);const p=save.props.onClick();await save.props.onClick();await p;
 assert.equal(rows.length,1);assert.equal(rows[0].date,'2026-12-30');assert.equal(rows[0].return_date,'2027-01-02');assert.equal(rows[0].return_amount,209);assert.equal(rows[0].amount,408);assert.equal(rows[0].shop,'A → B');
 assert.ok(text(render()).includes('2027-01-02'));assert.ok(!text(render()).includes('× 2'));
 button('Plan another journey').props.onClick();await plan();await button('Add journey').props.onClick();assert.equal(rows[1].return_date,null);assert.equal(rows[1].amount,199);
 button('Plan another journey').props.onClick();await plan();button('Round trip').props.onClick();field('Return date').props.onChange({target:{value:'2026-12-29'}});assert.equal(button('Add round trip').props.disabled,true);
 field('Return date').props.onChange({target:{value:'2026-12-30'}});field('Return fare').props.onChange({target:{value:'209.5'}});assert.equal(button('Add round trip').props.disabled,true);
 field('Return fare').props.onChange({target:{value:''}});await button('Add round trip').props.onClick();assert.equal(rows[2].return_amount,199);assert.equal(rows[2].amount,398);
 console.log('PASS: calculator one-row insert, different return fare/date, same-day default, double-click prevention, invalid values and one-way reset');
})().catch(e=>{console.error(e);process.exitCode=1;});
