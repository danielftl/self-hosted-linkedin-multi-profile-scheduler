export const IMAGE_TYPES=new Map([['image/png','png'],['image/jpeg','jpg'],['image/gif','gif']]);
export const DOCUMENT_TYPES=new Map([['application/pdf','pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document','docx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation','pptx'],
  ['application/msword','doc'],['application/vnd.ms-powerpoint','ppt']]);
export const VIDEO_TYPES=new Map([['video/mp4','mp4'],['video/quicktime','mov']]);
export const MEDIA_TYPES=new Map([...IMAGE_TYPES,...DOCUMENT_TYPES,...VIDEO_TYPES]);
export const MAX_UPLOAD_BYTES=25*1024*1024;
export const IMAGE_MAX_BYTES=20*1024*1024;
export function validateUpload({filename,mime,buffer}) {
  if(!(buffer instanceof Uint8Array))throw Error('Invalid file');
  if(!filename||typeof filename!=='string'||filename.length>180)throw Error('Invalid filename');
  const safeName=filename.split(/[\\/]/).pop();
  const ext=safeName.split('.').pop().toLowerCase();
  const expected=MEDIA_TYPES.get(mime);
  if(!expected||(ext!==expected&&!(mime==='image/jpeg'&&ext==='jpeg')))throw Error('Unsupported file type');
  if(buffer.length===0||buffer.length>MAX_UPLOAD_BYTES||(IMAGE_TYPES.has(mime)&&buffer.length>IMAGE_MAX_BYTES))
    throw Error('File size not supported');
  const starts=bytes=>bytes.every((b,i)=>buffer[i]===b);
  if(mime==='image/png'&&!starts([137,80,78,71,13,10,26,10]))throw Error('Invalid PNG');
  if(mime==='image/jpeg'&&!starts([255,216,255]))throw Error('Invalid JPEG');
  if(mime==='image/gif'&&!["GIF87a","GIF89a"].includes(new TextDecoder().decode(buffer.subarray(0,6))))throw Error('Invalid GIF');
  if(mime==='application/pdf'&&!starts([37,80,68,70,45]))throw Error('Invalid PDF');
  if((ext==='docx'||ext==='pptx')&&!starts([80,75,3,4]))throw Error('Invalid Office file');
  if((ext==='doc'||ext==='ppt')&&!starts([208,207,17,224,161,177,26,225]))throw Error('Invalid Office file');
  if(VIDEO_TYPES.has(mime)&&!([102,116,121,112].every((b,i)=>buffer[i+4]===b)))throw Error('Invalid video');
  return {kind:IMAGE_TYPES.has(mime)?'image':VIDEO_TYPES.has(mime)?'video':'document',filename:safeName,mime,size:buffer.length};
}
export function newMediaId(){return crypto.randomUUID();}
