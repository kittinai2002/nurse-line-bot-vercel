export const TYPES = ['เช้า', 'บ่าย', 'ดึก'];
export const DEFAULT_TIMES = {เช้า:['08:00','16:00'],บ่าย:['16:00','00:00'],ดึก:['00:00','08:00']};
const ALIASES = {ช:'เช้า',บ:'บ่าย',ด:'ดึก',เช้า:'เช้า',บ่าย:'บ่าย',ดึก:'ดึก',ห:'หยุด',หยุด:'หยุด',off:'หยุด'};
export const DEFAULT_CONFIG = () => ({times:structuredClone(DEFAULT_TIMES), lead:60, confirmed:false, enabled:false});
export function bangkokDate(now=Date.now()) { return new Date(now+7*3600000).toISOString().slice(0,10); }
export function normalizeMonth(value) {
  const m=/^(\d{4})-(\d{2})$/.exec(value || '');
  if(!m) throw Error('ระบุเดือนเป็น YYYY-MM เช่น 2026-11 หรือ 2569-11');
  let year=Number(m[1]); if(year>=2400) year-=543;
  const month=Number(m[2]);
  if(year<2020||year>2100||month<1||month>12) throw Error('เดือนหรือปีไม่ถูกต้อง');
  return `${year}-${m[2]}`;
}
export function nextMonth(now=Date.now()) {
  const [y,m]=bangkokDate(now).split('-').map(Number);
  return `${m===12?y+1:y}-${String(m===12?1:m+1).padStart(2,'0')}`;
}
export function validDate(date) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d=new Date(date+'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0,10)===date;
}
export function validTime(t) {return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);}
export function shiftRange(date, type, config) {
  if(!validDate(date)||!TYPES.includes(type)) throw Error('วันที่หรือเวรไม่ถูกต้อง');
  const [startTime,endTime]=config.times[type];
  if(!validTime(startTime)||!validTime(endTime)||startTime===endTime) throw Error('เวลาเริ่มและเวลาจบต้องถูกต้องและไม่ตรงกัน');
  const start=Date.parse(`${date}T${startTime}:00+07:00`);
  let end=Date.parse(`${date}T${endTime}:00+07:00`);
  if(end<=start) end+=86400000;
  return {start,end};
}
export function parseSchedule(text) {
  const lines=text.trim().split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const header=/^เพิ่มเวร\s+(\d{4}-\d{2})$/.exec(lines.shift()||'');
  if(!header) throw Error('เริ่มข้อความด้วย เพิ่มเวร YYYY-MM แล้วขึ้นบรรทัดใหม่');
  const month=normalizeMonth(header[1]);
  if(!lines.length||lines.length>31) throw Error('ใส่ตาราง 1–31 วันต่อข้อความ');
  const result=[];const seen=new Set();
  for(const line of lines) {
    const m=/^(\d{1,2})\s+(.+)$/.exec(line);
    if(!m) throw Error(`อ่านบรรทัดนี้ไม่ได้: ${line.slice(0,40)}`);
    const date=`${month}-${m[1].padStart(2,'0')}`;
    if(!validDate(date)||seen.has(date)) throw Error(`วันที่ไม่ถูกต้องหรือซ้ำ: ${m[1]}`);
    seen.add(date);
    const parts=m[2].split(/[\s+,/]+/).map(x=>ALIASES[x.toLowerCase()]);
    if(parts.some(x=>!x)) throw Error(`วันที่ ${m[1]} ใช้ ช บ ด หรือ ห เท่านั้น`);
    if(new Set(parts).size!==parts.length || (parts.includes('หยุด') && parts.length!==1)) throw Error(`เวรวันที่ ${m[1]} ซ้ำหรือรวมวันหยุดกับเวร`);
    result.push({date,types:parts.includes('หยุด')?[]:parts});
  }
  return result.sort((a,b)=>a.date.localeCompare(b.date));
}
export function assertNoOverlap(rows, config) {
  const ranges=rows.filter(r=>r.type!=='หยุด').map(r=>({...r,...shiftRange(r.date,r.type,config)})).sort((a,b)=>a.start-b.start);
  for(let i=1;i<ranges.length;i++) if(ranges[i].start<ranges[i-1].end) throw Error(`เวรทับซ้อนกัน: ${ranges[i-1].date} ${ranges[i-1].type} กับ ${ranges[i].date} ${ranges[i].type}`);
}
export function thaiDate(date) {
  const [y,m,d]=date.split('-').map(Number);
  return `${d}/${m}/${y+543}`;
}
export function timeDescription(type, config) {
  const [a,b]=config.times[type];
  return `${type} ${a}–${b}${b<a?' (จบวันถัดไป)':''}`;
}
export function reminderText(row, config) {
  return `🔔 เตือนขึ้นเวร${row.type}\nวันที่เริ่ม ${thaiDate(row.date)}\n${timeDescription(row.type,config)}\nเตือนล่วงหน้า ${config.lead} นาที\nขอให้เป็นเวรที่ราบรื่นนะครับ 💚`;
}
export function remindersDue(rows, config, now, graceMs=10*60000) {
  if(!config.enabled||!config.confirmed) return [];
  return rows.filter(r=>r.type!=='หยุด').map(r=>{
    const range=shiftRange(r.date,r.type,config);const due=range.start-config.lead*60000;
    return {...r,...range,due,expires:Math.min(due+graceMs,range.start),key:`${r.date}|${r.type}|${range.start}`};
  }).filter(r=>r.due<=now&&now<r.expires);
}
