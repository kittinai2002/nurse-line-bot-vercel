import {bangkokDate,normalizeMonth,TYPES} from './domain.mjs';
import {palette,themes,text,box,catHeader,frame,msgAction,footer} from './theme.mjs';
const months=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const calendarFrame=contents=>({...frame(contents),borderWidth:'1px',borderColor:palette.line,cornerRadius:'16px',paddingAll:'12px'});
const short={เช้า:'ช',บ่าย:'บ',ดึก:'ด',หยุด:'ห'};
export function calendarModel(month,rows,now=Date.now()){
 month=normalizeMonth(month);const [y,m]=month.split('-').map(Number);
 const first=(new Date(Date.UTC(y,m-1,1)).getUTCDay()+6)%7; // Monday first.
 const count=new Date(Date.UTC(y,m,0)).getUTCDate();const cells=[];const today=bangkokDate(now);
 for(let i=0;i<Math.ceil((first+count)/7)*7;i++){
  const day=i-first+1;if(day<1||day>count){cells.push(null);continue;}
  const date=`${month}-${String(day).padStart(2,'0')}`;
  const types=rows.filter(r=>r.date===date).map(r=>r.type).sort((a,b)=>[...TYPES,'หยุด'].indexOf(a)-[...TYPES,'หยุด'].indexOf(b));
  cells.push({day,date,types,today:date===today});
 }
 const adjacent=n=>{const d=new Date(Date.UTC(y,m-1+n,1));const v=d.toISOString().slice(0,7);return v<'2020-01'||v>'2100-12'?null:v;};
 return {month,label:`${months[m-1]} ${y+543}`,cells,previous:adjacent(-1),next:adjacent(1),today};
}
function cell(c){
 if(!c)return box([text(' ',{size:'sm'})],{flex:1,paddingTop:'8px',paddingBottom:'8px'});
 const theme=c.types.length===1?themes[c.types[0]]:null;
 return box([
  text(String(c.day),{size:'14px',weight:'bold',align:'center',color:c.today?palette.mint:palette.ink}),
  text(c.types.length?c.types.map(t=>short[t]).join(' '):'·',{size:'10px',weight:'bold',align:'center',color:theme?.ink||palette.muted,margin:'xs'})
 ],{flex:1,paddingTop:'8px',paddingBottom:'8px',paddingStart:'1px',paddingEnd:'1px',backgroundColor:theme?.bg||(c.types.length?'#EAF0E9':'#F6F6EF'),cornerRadius:'9px',borderWidth:'1px',borderColor:c.today?palette.mint:'#F0F2E9',action:msgAction(`วันที่ ${c.day}`,`ลงเวร ${c.date}`)});
}
export function calendarMessage(month,rows,now=Date.now(),{notice}={}){
 const model=calendarModel(month,rows,now);const weeks=[];
 for(let i=0;i<model.cells.length;i+=7)weeks.push({type:'box',layout:'horizontal',spacing:'3px',contents:model.cells.slice(i,i+7).map(cell)});
 const nav=[...(model.previous?[msgAction('‹ เดือนก่อน','ตารางเวร '+model.previous)]:[]),msgAction('เดือนนี้','ตารางเวรของฉัน'),...(model.next?[msgAction('เดือนถัดไป ›','ตารางเวร '+model.next)]:[])];
 const entries=model.cells.filter(c=>c?.types.length);const work=entries.filter(c=>!c.types.includes('หยุด')).length;const off=entries.length-work;
 return {type:'flex',altText:`🐱 ปฏิทินเวร ${model.label} · ลงเวร ${work} วัน · หยุด ${off} วัน · แตะวันที่เพื่อลงหรือแก้เวร`,contents:{type:'bubble',size:'giga',
  header:catHeader(model.label,{subtitle:notice||'แตะวันที่ → เลือกเวร → บันทึก',cat:'😺'}),
  body:box([calendarFrame([
   {type:'box',layout:'horizontal',contents:[text('●',{color:'#B4CEBD',align:'center'}),text('ตารางของฉัน',{size:'xxs',color:palette.muted,align:'center',flex:4}),text('●',{color:'#B4CEBD',align:'center'})]},
   {type:'box',layout:'horizontal',margin:'sm',spacing:'3px',contents:['จ','อ','พ','พฤ','ศ','ส','อา'].map((d,i)=>text(d,{size:'11px',weight:'bold',align:'center',flex:1,color:i>=5?'#B88170':palette.muted}))},
   ...weeks,
   text('ช เช้า   บ บ่าย   ด ดึก   ห หยุด',{size:'xxs',color:palette.muted,align:'center',margin:'md'}),
   text('· ยังไม่ลงเวร   กรอบเขียว = วันนี้',{size:'xxs',color:palette.muted,align:'center'})
  ]),text(`ลงเวร ${work} วัน  ·  หยุด ${off} วัน`,{size:'xs',align:'center',margin:'md',color:palette.mint}),
  text('วันที่แสดงคือวันที่เริ่มเวร · แตะวันเพื่อดูหรือแก้ไข',{size:'xxs',align:'center',color:palette.muted,margin:'sm'}),
  {type:'box',layout:'horizontal',margin:'md',contents:nav.map(action=>({type:'button',action,style:'link',color:palette.mint,height:'sm',flex:1}))}
  ],{paddingAll:'12px',backgroundColor:palette.cream}),
  footer:footer([msgAction('ลงหลายวันพร้อมกัน','ลงหลายวัน '+model.month),msgAction('เมนูหลัก','เมนู')])
 }};
}
