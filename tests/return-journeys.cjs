// Node + Playwright: node tests/return-journeys.cjs. No live database writes.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const babel=require(require.resolve('playwright').replace(/index.js$/, 'lib/transform/babelBundle.js'));
const source=fs.readFileSync(path.join(__dirname,'../js/app.jsx'),'utf8');
const context={console,Date,Number,Map,Set};vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('// Round trips are one'),source.indexOf('function App(')),context);
const {expenseLegs,groupJourneyHistory,journeyFields,journeyFormError,canAddReturnJourney,expenseRecord}=vm.runInContext("({expenseLegs,groupJourneyHistory,journeyFields,journeyFormError,canAddReturnJourney,expenseRecord})",context);
const outward={id:42,amount:199,date:'2026-12-30',shop:'A → B',category:'Transportation',region:'JPY',notes:'Keep me',tags:'Travel'};
const trip={...outward,amount:408,return_amount:209,return_date:'2027-01-02'};
const legs=expenseLegs(trip);
assert.equal(legs.length,2);assert.equal(legs[0].amount,199);assert.equal(legs[1].amount,209);
assert.equal(legs[1].date,'2027-01-02');assert.equal(legs[1].year,2027);assert.equal(legs[1].month,1);
assert.equal(legs[1].shop,'B → A');assert.notEqual(legs[0].id,legs[1].id);
assert.equal(legs.reduce((s,l)=>s+l.amount,0),408);assert.equal(expenseRecord(legs[1]),trip);
assert.equal(groupJourneyHistory(legs).length,1);assert.equal(groupJourneyHistory(legs)[0].amount,408);
assert.equal(groupJourneyHistory(legs.filter(l=>l.year===2027))[0].amount,209);
assert.equal(groupJourneyHistory(legs.filter(l=>l.shop==='A → B'))[0].amount,199);
assert.equal(expenseLegs(outward)[0],outward);
assert.equal(expenseLegs({...outward,shop:'A → B → A',amount:398}).length,1,'legacy round trip remains unchanged');
assert.equal(canAddReturnJourney(outward),true);assert.equal(canAddReturnJourney(legs[1]),false);
assert.equal(canAddReturnJourney({...outward,shop:'A → B → A'}),false);
const sameDay=expenseLegs({...trip,return_date:trip.date});assert.equal(sameDay.reduce((s,l)=>s+l.amount,0),408);
const form={...outward,has_return:true,return_amount:209,return_date:'2027-01-02'};
assert.equal(journeyFormError(form),'');
for(const patch of [{return_date:'2026-12-29'},{return_date:'2027-02-30'},{return_amount:0},{return_amount:1.5},{return_amount:-1},{category:'Food'},{amount:2147483647}]) assert.ok(journeyFormError({...form,...patch}));
assert.equal(journeyFields(form).amount,408);
assert.equal(journeyFields({...form,has_return:false}).amount,199);assert.equal(journeyFields({...form,has_return:false}).return_date,null);
let state=[],cursor=0,writes=[],mode='ok',changed=0;
const theme=new Proxy({}, {get:()=> '#888888'});
Object.assign(context,{
 require:()=>({jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}),
 useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],v=>state[i]=typeof v==='function'?v(state[i]):v];},
 useRef(initial){const i=cursor++;return state[i]||(state[i]={current:initial});},
 useTheme:()=>({theme,inputStyle:{},categories:[{name:'Transportation'}],tags:[],getCatIcon:()=> '🚆'}),
 Modal:()=>null,TagSelector:()=>null,fmt:n=>'¥'+n,ymdToday:()=> '2027-01-02',setTimeout(){},
 writeThrough:async w=>{writes.push(w);await Promise.resolve();return mode==='fail'?{ok:false,error:'Save failed'}:{ok:true,queued:mode==='offline'};}
});
const hook=source.slice(source.indexOf('function useExpenseMutations'),source.indexOf('//  SMART ENTRY'));
vm.runInContext(babel.babelTransform(hook,'hook.jsx',false,[],[]).code,context);
const render=()=>{cursor=0;return context.useExpenseMutations({onChange:()=>changed++});};
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const find=pred=>{const n=nodes(render().modals).find(pred);assert.ok(n,'control rendered');return n;};
const field=name=>find(n=>n.type==='input'&&n.props['aria-label']===name);
const save=()=>find(n=>n.type==='button'&&n.props.children==='Save');
(async()=>{
 render().addReturnJourney(outward);
 assert.equal(field('Outward fare').props.value,199);assert.equal(field('Return date').props.value,'2027-01-02');
 field('Return fare').props.onChange({target:{value:'209'}});
 const button=save();const first=button.props.onClick();await button.props.onClick();await first;
 assert.equal(writes.length,1,'duplicate taps cannot add twice');assert.equal(writes[0].op,'update');assert.equal(writes[0].match.id,42);
 assert.equal(writes[0].row.amount,408);assert.equal(writes[0].row.return_date,'2027-01-02');assert.equal(writes[0].row.notes,'Keep me');
 render().openEdit(legs[1]);assert.equal(field('Outward date').props.value,'2026-12-30');assert.equal(field('Outward fare').props.value,199);
 field('Return date').props.onChange({target:{value:'2026-12-29'}});assert.equal(save().props.disabled,true);
 field('Return date').props.onChange({target:{value:'2027-01-03'}});mode='fail';await save().props.onClick();assert.equal(field('Return date').props.value,'2027-01-03');
 mode='offline';await save().props.onClick();assert.equal(writes.at(-1).match.id,42);assert.equal(writes.at(-1).row.amount,408);
 render().openEdit(legs[1]);find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:false}});await save().props.onClick();
 assert.equal(writes.at(-1).row.amount,199);assert.equal(writes.at(-1).row.return_amount,null);assert.equal(writes.at(-1).row.return_date,null);
 render().requestDelete(legs[1]);assert.ok(nodes(render().modals).some(n=>n.props?.children==='Delete the entire round trip?'));
 await find(n=>n.type==='button'&&n.props.children==='Delete').props.onClick();assert.equal(writes.at(-1).match.id,42);
 // Actual offline outbox + overlay: returning changes one stored row before projection.
 let storage={};Object.assign(context,{localStorage:{getItem:k=>storage[k],setItem:(k,v)=>storage[k]=v},window:{dispatchEvent(){}},Event:function(){},navigator:{onLine:false}});
 vm.runInContext(source.slice(source.indexOf('const OUTBOX_KEY'),source.indexOf('const idOrd')),context);
 await context.writeThrough({table:'cost_management_expenses',op:'update',match:{id:42},row:{amount:408,return_date:'2027-01-02',return_amount:209}});
 context.baseRows=[outward];const projected=vm.runInContext('overlayExpenses(baseRows)',context);assert.equal(projected.length,1);assert.equal(expenseLegs(projected[0]).reduce((s,l)=>s+l.amount,0),408);
 babel.babelTransform(source,'app.jsx',false,[],[]);
 console.log('PASS: separate dates/fares, cross-month/year totals, grouped filtered history, legacy entries, edit from either leg, return removal, duplicate clicks, failed save, offline update and delete targeting');
})().catch(e=>{console.error(e);process.exitCode=1;});
