import {palette,themes,text,box,catHeader,frame,footer} from './theme.mjs';
function line(value) {
 const shift=/^(เช้า|บ่าย|ดึก) (\d{2}:\d{2}–\d{2}:\d{2})(.*)$/.exec(value);
 if(shift){const t=themes[shift[1]];return box([text(`${t.icon} เวร${shift[1]}`,{size:'xs',weight:'bold',color:t.ink}),text(shift[2],{size:'xl',weight:'bold',color:t.ink,margin:'sm'}),...(shift[3]?[text(shift[3].trim(),{size:'xs',color:t.ink,margin:'sm'})]:[])],{backgroundColor:t.bg,cornerRadius:'14px',paddingAll:'14px',margin:'sm'});}
 if(value==='🌿 วันหยุด')return box([text('😽 พักผ่อนให้เต็มที่นะ',{weight:'bold',color:themes.หยุด.ink}),text(value,{size:'sm',margin:'sm',color:themes.หยุด.ink})],{backgroundColor:themes.หยุด.bg,cornerRadius:'14px',paddingAll:'16px'});
 const row=/^(\d{1,2}): (.+)$/.exec(value);
 if(row)return {type:'box',layout:'horizontal',spacing:'md',paddingAll:'10px',backgroundColor:'#F0F5EB',cornerRadius:'9px',contents:[text(row[1],{weight:'bold',flex:1}),text(row[2],{flex:4})]};
 const accent=/^(แจ้งเตือน|เวลาเวร|เตือนล่วงหน้า)/.test(value);
 return text(value,{margin:'sm',...(accent?{weight:'bold',color:palette.mint}:{})});
}
export function decorateMessage(message) {
 if(message.type!=='text'||message.text.startsWith('📝 คัดลอกตัวอย่าง'))return message;
 const all=message.text.split('\n'),title=all.shift()||'เหมียวเตือนเวร';const lines=all.filter(v=>v.trim());
 const reminder=/^🔔 เตือนขึ้นเวร(เช้า|บ่าย|ดึก)$/.exec(title);const theme=reminder?themes[reminder[1]]:{ink:palette.ink,bg:palette.paper};
 const choices=message.quickReply?.items||[];
 const chunks=[];for(let i=0;i<Math.max(lines.length,1);i+=7)chunks.push(lines.slice(i,i+7));
 const cat=reminder?.[1]==='ดึก'?'😸':lines.includes('🌿 วันหยุด')?'😽':'🐱';
 const bubbles=chunks.map((rows,index)=>({type:'bubble',size:'mega',
  header:catHeader(title,{bg:theme.bg,ink:theme.ink,cat,subtitle:chunks.length>1?`หน้า ${index+1} / ${chunks.length}`:''}),
  body:box([frame(rows.length?rows.map(line):[text('เลือกปุ่มด้านล่างได้เลยนะ')])],{paddingAll:'20px',backgroundColor:palette.paper}),
  ...(index===chunks.length-1&&choices.length?{footer:footer(choices.map(i=>i.action))}:{}),styles:{footer:{separator:true,separatorColor:palette.line}}
 }));
 const result={type:'flex',altText:message.text.slice(0,400),contents:bubbles.length===1?bubbles[0]:{type:'carousel',contents:bubbles}};
 if(bubbles.length>12||bubbles.some(b=>Buffer.byteLength(JSON.stringify(b),'utf8')>30000)||Buffer.byteLength(JSON.stringify(result.contents),'utf8')>50000)return message;
 return result;
}
