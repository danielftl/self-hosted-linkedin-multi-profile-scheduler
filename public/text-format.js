const ranges=[['bold',0x1d5d4,0x1d5ee],['italic',0x1d608,0x1d622],['both',0x1d63c,0x1d656]];
function decode(char){
 const cp=char.codePointAt(0);
 for(const [style,upper,lower] of ranges){
  if(cp>=upper&&cp<upper+26)return {base:String.fromCharCode(65+cp-upper),bold:style!=='italic',italic:style!=='bold'};
  if(cp>=lower&&cp<lower+26)return {base:String.fromCharCode(97+cp-lower),bold:style!=='italic',italic:style!=='bold'};
 }
 if(cp>=0x1d7ec&&cp<0x1d7f6)return {base:String.fromCharCode(48+cp-0x1d7ec),bold:true,italic:false};
 return {base:char,bold:false,italic:false};
}
function encode({base,bold,italic}){
 const code=base.charCodeAt(0),row=ranges.find(r=>r[0]===(bold&&italic?'both':bold?'bold':'italic'));
 if(!bold&&!italic)return base;
 if(code>=65&&code<=90)return String.fromCodePoint(row[1]+code-65);
 if(code>=97&&code<=122)return String.fromCodePoint(row[2]+code-97);
 if(code>=48&&code<=57&&bold)return String.fromCodePoint(0x1d7ec+code-48);
 return base;
}
const splitLinks=text=>text.split(/(https?:\/\/[^\s]+)/g);
const isLink=text=>/^https?:\/\//.test(text);
export function styleText(text,{bold=false,italic=false}={}){
 return splitLinks(text).map(part=>isLink(part)?part:[...part].map(char=>{const d=decode(char);return encode({...d,bold:d.bold||bold,italic:d.italic||italic});}).join('')).join('');
}
export function toggleStyle(text,style){
 const parts=splitLinks(text),letters=parts.filter(part=>!isLink(part)).flatMap(part=>[...part].map(decode)).filter(d=>(style==='italic'?/[A-Za-z]/:/[A-Za-z0-9]/).test(d.base));
 const turnOn=!letters.length||!letters.every(d=>d[style]);
 return parts.map(part=>isLink(part)?part:[...part].map(char=>encode({...decode(char),[style]:turnOn})).join('')).join('');
}
export function toggleBullets(text){
 const lines=text.split('\n'),remove=lines.filter(x=>x.trim()).every(x=>/^• /.test(x));
 return lines.map(line=>line.trim()?(remove?line.replace(/^• /,''):'• '+line):line).join('\n');
}
// Read inert clipboard nodes only; no HTML, scripts, styles or attributes reach the page/API.
export function clipboardText(root){
 function walk(node,bold=false,italic=false){
  if(node.nodeType===3)return styleText(node.textContent,{bold,italic});
  if(node.nodeType!==1&&node.nodeType!==11)return '';
  const tag=node.tagName||'';if(['SCRIPT','STYLE','NOSCRIPT'].includes(tag))return '';
  if(tag==='BR')return '\n';
  const weight=node.style?.fontWeight||'';
  bold=bold||['B','STRONG'].includes(tag)||['bold','bolder'].includes(weight)||Number(weight)>=600;
  italic=italic||['I','EM'].includes(tag)||node.style?.fontStyle==='italic';
  const inner=[...node.childNodes].map(child=>walk(child,bold,italic)).join('');
  if(tag==='LI')return '• '+inner+'\n';
  return inner+(['P','DIV'].includes(tag)?'\n':'');
 }
 return walk(root).replace(/\n+$/,'');
}
