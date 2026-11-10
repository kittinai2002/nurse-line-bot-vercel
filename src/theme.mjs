// Clean, consistent cards inspired by mobile component-library patterns.
export const palette={mint:'#168579',ink:'#20272D',muted:'#66727B',cream:'#FFFFFF',paper:'#FFFFFF',line:'#E6EBEF',peach:'#FFE5D5'};
export const themes={เช้า:{ink:'#946000',bg:'#FFF5D6',icon:'☀️'},บ่าย:{ink:'#16658C',bg:'#E8F5FF',icon:'🌤️'},ดึก:{ink:'#6250A4',bg:'#F0ECFF',icon:'🌙'},หยุด:{ink:'#26755E',bg:'#E7F6EE',icon:'🌿'}};
export const text=(value,extra={})=>({type:'text',text:value,size:'sm',color:palette.ink,wrap:true,...extra});
export const box=(contents,extra={})=>({type:'box',layout:'vertical',contents,...extra});
export const msgAction=(label,value)=>({type:'message',label,text:value});
export function catHeader(title,{subtitle='',cat='🐱',bg='#FFFFFF',ink=palette.ink}={}){
 return box([text(cat+'  เหมียวเตือนเวร',{size:'xs',color:palette.muted}),text(title,{size:'xl',weight:'bold',color:ink,margin:'md'}),...(subtitle?[text(subtitle,{size:'xs',color:palette.muted,margin:'sm'})]:[])],{paddingAll:'20px',backgroundColor:bg});
}
export function footer(actions){
 const toggles=actions.filter(a=>a.type==='postback'&&/:shift:/.test(a.data));
 const rest=actions.filter(a=>!toggles.includes(a));
 const preferred=rest.findIndex(a=>/^(บันทึกเวร|ใช้เวลาชุดนี้|ยืนยัน)/.test(a.label));const primary=preferred>=0?preferred:0;
 const children=[];
 if(toggles.length){
  for(let i=0;i<toggles.length;i+=2)children.push({type:'box',layout:'horizontal',spacing:'sm',contents:toggles.slice(i,i+2).map(action=>{const selected=action.label.startsWith('✓');return {type:'box',layout:'vertical',flex:1,paddingAll:'14px',cornerRadius:'12px',backgroundColor:selected?'#E7F6EE':'#F4F6F8',borderWidth:'1px',borderColor:selected?palette.mint:palette.line,action,contents:[text(action.label,{align:'center',weight:'bold',color:selected?palette.mint:palette.ink})]};})});
 }
 children.push(...rest.map((action,i)=>({type:'button',action,style:i===primary?'primary':'link',color:palette.mint,height:'md',margin:'sm'})));
 return box(children,{paddingAll:'16px',spacing:'sm',backgroundColor:palette.paper});
}
export const frame=contents=>box(contents,{backgroundColor:palette.paper,paddingAll:'0px',spacing:'sm'});
