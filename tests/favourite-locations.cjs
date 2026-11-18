const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const babel=require(require.resolve('playwright').replace(/index.js$/,'lib/transform/babelBundle.js'));
const src=fs.readFileSync(path.join(__dirname,'../js/app.jsx'),'utf8');
const areas=[{id:'a',name:'East',lat:35,lng:139},{id:'b',name:'West',lat:36,lng:139},{id:'c',name:'No coordinates',lat:null,lng:null}];
const pins=[{areaId:'a',shop:'Mart',category:'Food',label:'East branch',lat:35,lng:139}];
const ctx={distanceMeters:(a,b)=>Math.hypot(a.lat-b.lat,a.lng-b.lng)*111000};
vm.createContext(ctx);
vm.runInContext(src.slice(src.indexOf('// Only explicit assignments'),src.indexOf('function FrequentTransactionsPanel')),ctx);
const item=(key,place)=>({key,count:2,lastDate:'2026-11-18',record:{shop:'Mart',category:'Food',place_name:place}});
const east=item('east','East branch'),west=item('west','West'),unknown=item('unknown','');
assert.equal(ctx.favouriteAreaFor(east,areas,pins,{}).id,'a');
assert.equal(ctx.favouriteAreaFor(unknown,areas,pins,{}),null,'shop name alone never establishes location');
assert.equal(ctx.favouriteAreaFor(east,areas,pins,{east:''}),null,'explicit unassigned overrides inference');
assert.equal(ctx.favouriteAreaFor(east,areas,pins,{east:'deleted'}),null,'retired areas never inferred anew');
assert.equal(ctx.favouriteAreaFor(east,[...areas,{id:'d',name:'East branch'}],pins,{}),null,'ambiguous label stays unassigned');
assert.equal(ctx.favouriteAreaDistance(areas[2],[],{lat:0,lng:0}),Infinity,'null coordinates are not zero');
const settings={assignments:{},hubs:{a:'Home',b:'Work'}},base={hub:'',area:'',nearby:false,radius:1000};
assert.equal(ctx.filterFavouriteLocations([east,west,unknown],areas,pins,settings,{...base,hub:'Home'},null)[0].key,'east');
assert.equal(ctx.filterFavouriteLocations([east,west,unknown],areas,pins,settings,{...base,area:'__none'},null)[0].key,'unknown');
assert.equal(ctx.filterFavouriteLocations([west,east,unknown],areas,pins,settings,{...base,nearby:true},{lat:35,lng:139}).length,1);
assert.equal(ctx.filterFavouriteLocations([west,east],areas,pins,settings,base,{lat:35,lng:139})[0].key,'east');
// Exercise geolocation controls without writing any live records.
let state=[],cursor=0,success,failure,cleanup,storage=new Map(),writes=0;
Object.assign(ctx,{console,expenseRecord:r=>r,hasReturnJourney:()=>false,regionOf:()=> 'JPY',expenseShopLabel:r=>r.shop,fmt:String,ymdToday:()=> '2026-11-19',Modal:()=>null,
navigator:{geolocation:{getCurrentPosition(ok,bad){success=ok;failure=bad;}}},
localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
require:()=>({jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}),
useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],v=>state[i]=typeof v==='function'?v(state[i]):v];},
useRef(v){const i=cursor++;return state[i]||(state[i]={current:v});},useMemo:fn=>fn(),useEffect:fn=>{cleanup=fn();},
useTheme:()=>({theme:{},inputStyle:{},currency:'JPY',favouriteAreas:areas,stopPins:pins}),
useExpenseMutations:()=>({modals:null,insertExpense:()=>{writes++;}})});
vm.runInContext(babel.babelTransform(src.slice(src.indexOf('// Frequent transaction shortcuts'),src.indexOf('function SmartEntryView')),'panel.jsx',false,[],[]).code,ctx);
const render=()=>{cursor=0;return ctx.FrequentTransactionsPanel({userId:'test',allExpenses:[{id:1,shop:'Mart',category:'Food',place_name:'East branch',amount:100,date:'2026-11-18'}]});};
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const button=text=>{const n=nodes(render()).find(n=>n.type==='button'&&n.props.children===text);assert.ok(n,text);return n;};
button('Near me').props.onClick();failure({code:1});
assert.ok(JSON.stringify(render()).includes('Could not get your location'));
button('Near me').props.onClick();success({coords:{latitude:35,longitude:139,accuracy:900}});
assert.ok(JSON.stringify(render()).includes('too approximate'));
button('Near me').props.onClick();const stale=success;button('All locations').props.onClick();stale({coords:{latitude:35,longitude:139,accuracy:10}});
assert.ok(!nodes(render()).some(n=>n.props?.['aria-label']==='Nearby radius'),'late GPS callback ignored');
button('Near me').props.onClick();success({coords:{latitude:35,longitude:139,accuracy:10}});
assert.ok(nodes(render()).some(n=>n.props?.['aria-label']==='Nearby radius'));
button('Organise hubs').props.onClick();
const input=nodes(render()).find(n=>n.props?.['aria-label']==='Hub for East');input.props.onChange({target:{value:'Home'}});
button('Save hub').props.onClick();
assert.equal(JSON.parse(storage.get('cm_favourites_v1:test:JPY:locations')).hubs.a,'Home');
assert.equal(writes,0,'filtering and grouping never create expenses');
console.log('PASS: exact/ambiguous/manual assignments, null coordinates, hub/area/nearby filters, nearest ordering, GPS denial/accuracy/stale callbacks, persisted hubs and no automatic expense writes');
