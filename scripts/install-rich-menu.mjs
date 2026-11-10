// Optional: upload a matching THREE-EQUAL-COLUMN PNG/JPEG rich-menu image.
// Never supply credentials as command arguments. Set runtime environment variables.
import {readFile} from 'node:fs/promises';
const token=process.env.LINE_CHANNEL_ACCESS_TOKEN;
const file=process.argv[2];
if(!token||!file)throw Error('Set LINE_CHANNEL_ACCESS_TOKEN and run npm run rich-menu -- path/to/2500x843.png');
const image=await readFile(file);
if(image.length>1024*1024)throw Error('Image must be at most 1 MB');
let width,height,contentType;
if(image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
  width=image.readUInt32BE(16);height=image.readUInt32BE(20);contentType='image/png';
}else throw Error('This installer accepts PNG only. Use a 2500 × 843 PNG with three equal columns.');
if(width!==2500||height!==843)throw Error('Image must be 2500 × 843 pixels');
const api=async(path,body,method='POST')=>{
  const r=await fetch('https://api.line.me/v2/bot/'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  if(!r.ok)throw Error(`LINE request failed: HTTP ${r.status}`);return r.status===204?{}:r.json();
};
const menu={size:{width,height},selected:true,name:'Nurse shift menu',chatBarText:'ตารางเวรของฉัน',areas:[
  {bounds:{x:0,y:0,width:833,height},action:{type:'message',text:'เวรวันนี้'}},
  {bounds:{x:833,y:0,width:834,height},action:{type:'message',text:'ตารางเวรของฉัน'}},
  {bounds:{x:1667,y:0,width:833,height},action:{type:'message',text:'เพิ่มเวรในเดือนถัดไป'}}
]};
const {richMenuId}=await api('richmenu',menu);
try {
  const r=await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':contentType},body:image});
  if(!r.ok)throw Error(`Image upload failed: HTTP ${r.status}`);
  await api(`user/all/richmenu/${richMenuId}`);
  console.log('Rich menu installed. The previous rich-menu resource was not deleted.');
}catch(e){console.error('A menu resource was created but installation did not finish. Review the OA before retrying.');throw e;}
