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
function chooseStation(kind, name) {
 find(n=>n.type==='button'&&n.props['aria-label']===`Choose ${kind} station`).props.onClick();
 find(n=>n.type===ctx.StationPicker).props.onChoose(name,'');
}
async function plan(){
 chooseStation('from','A');
 chooseStation('to','B');
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
 button('Plan another journey').props.onClick();
 assert.equal(field('Fare paid').props.disabled,true);
 let bookWrites=0;
 ctx.fareBookSave=async()=>{bookWrites++; return {status:'ok'};};
 const estimate=ctx.fareLookup;
 ctx.fareLookup=()=>{throw Error('Manual entry triggered a fare lookup');};
 chooseStation('from','Musashi Urawa');
 chooseStation('to','Minami Urawa');
 const pay=(value,name='Fare paid')=>field(name).props.onChange({target:{value}});
 for(const invalid of ['0','-5','199.5','abc','2147483648']){
   pay(invalid);
   assert.equal(button('Add journey').props.disabled,true,invalid);
   await button('Add journey').props.onClick();
 }
 assert.equal(rows.length,3);
 pay('１９９');
 assert.equal(button('Add journey').props.disabled,false);
 const failOnce=ctx.useExpenseMutations;
 ctx.useExpenseMutations=()=>({insertExpense:async()=>({ok:false}),modals:null});
 await button('Add journey').props.onClick();
 assert.equal(field('Fare paid').props.value,'199','keeps the entered fare for retry');
 ctx.useExpenseMutations=failOnce;
 const manualSave=button('Add journey');
 await Promise.all([manualSave.props.onClick(),manualSave.props.onClick()]);
 assert.equal(rows.length,4);
 assert.equal(rows[3].amount,199);
 assert.equal(rows[3].return_amount,null);
 assert.equal(rows[3].shop,'Musashi Urawa → Minami Urawa');
 assert.equal(rows[3].category,'Transportation');
 assert.equal(rows[3].region,'JPY');
 assert.ok(text(render()).includes('Journey saved'));

 button('Plan another journey').props.onClick();
 chooseStation('from','A');chooseStation('to','B');
 pay('155');button('Add transfer stop').props.onClick();
 assert.equal(field('Fare paid').props.value,'','route edit clears previous fare');
 chooseStation('to','C');button('Round trip').props.onClick();
 pay('200','Outward fare paid');
 assert.ok(text(button('Add round trip')).includes('¥400'));
 field('Return fare').props.onChange({target:{value:'210'}});
 field('Return date').props.onChange({target:{value:'2027-01-02'}});
 await button('Add round trip').props.onClick();
 assert.equal(rows.length,5);
 assert.equal(rows[4].shop,'A → B → C');
 assert.equal(rows[4].amount,410);
 assert.equal(rows[4].return_amount,210);
 assert.equal(rows[4].return_date,'2027-01-02');
 assert.ok(text(render()).includes('A → B → C'));
 assert.ok(text(render()).includes('C → B → A'));
 assert.equal(bookWrites,0,'whole-journey fares do not verify individual legs');

 button('Plan another journey').props.onClick();
 ctx.fareLookup=estimate;
 await plan();pay('180');assert.ok(text(button('Add journey')).includes('¥180'));
 pay('');assert.ok(text(button('Add journey')).includes('¥199'));
 let finish;
 ctx.fareLookup=()=>new Promise(resolve=>{finish=resolve;});
 const pending=button('Calculate 1 leg').props.onClick();
 chooseStation('to','C');
 finish({fare_ic:499,source:'book'});await pending;
 assert.ok(!text(render()).includes('¥499'),'discard the estimate for the previous route');
 console.log('PASS: upfront fare entry, transfer and round-trip totals, validation, retry, route edits and switching back to estimates');
 console.log('PASS: calculator one-row insert, different return fare/date, same-day default, double-click prevention, invalid values and one-way reset');
})().catch(e=>{console.error(e);process.exitCode=1;});
