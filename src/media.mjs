import path from 'node:path';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
export { validateUpload, newMediaId, MAX_UPLOAD_BYTES } from './media-validation.mjs';
export async function saveMedia(dir,id,bytes) {
  if(!/^[0-9a-f-]{36}$/.test(id))throw Error('Invalid media ID');
  await mkdir(dir,{recursive:true,mode:0o700});
  const filename=path.join(dir,id);
  await writeFile(filename,bytes,{flag:'wx',mode:0o600});
  return filename;
}
export async function readMedia(dir,id) {
  if(!/^[0-9a-f-]{36}$/.test(id))throw Error('Invalid media ID');
  return readFile(path.join(dir,id));
}
export async function deleteMedia(dir,id) {
  if(!/^[0-9a-f-]{36}$/.test(id))throw Error('Invalid media ID');
  await unlink(path.join(dir,id)).catch(e=>{if(e.code!=='ENOENT')throw e;});
}
